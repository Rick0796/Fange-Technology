
// Gemini Service for Video Analysis and Content Generation
import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult, AnalysisMode } from "../types";

// Helper to wrap promises with cancellation
const cancellable = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (signal?.aborted) return Promise.reject(new Error("取消操作"));
  if (!signal) return promise;
  
  return new Promise((resolve, reject) => {
    const abortHandler = () => reject(new Error("取消操作"));
    signal.addEventListener('abort', abortHandler);
    promise.then(resolve).catch(reject).finally(() => {
      signal.removeEventListener('abort', abortHandler);
    });
  });
};

// Helper to safely parse JSON from AI response, handling potential truncation or markdown
const safeJsonParse = (text: string) => {
  if (!text) return null;
  
  let cleaned = text.trim();
  // Remove markdown code blocks if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  
  // Try direct parse first
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (e) {
    console.warn("Initial JSON parse failed, attempting recovery...", e);
  }

  // Attempt to find the first '{' and last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Attempt recovery for common truncation issues
    let recovered = cleaned;
    
    // If it ends with a partial string, try to close it
    const lastQuote = recovered.lastIndexOf('"');
    const lastOpenBrace = recovered.lastIndexOf('{');
    const lastCloseBrace = recovered.lastIndexOf('}');
    
    if (lastQuote > lastCloseBrace && lastQuote > lastOpenBrace) {
      recovered += '"';
    }
    
    // Count braces
    const openBraces = (recovered.match(/\{/g) || []).length;
    const closeBraces = (recovered.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) {
      recovered += '}';
    }
    
    const openBrackets = (recovered.match(/\[/g) || []).length;
    const closeBrackets = (recovered.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      recovered += ']';
    }

    try {
      return JSON.parse(recovered);
    } catch (e2) {
      console.error("JSON recovery failed", e2);
      throw new Error("AI 返回数据格式错误，请重试");
    }
  }
};

// Helper to convert File to Base64 (Only for small files)
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// Helper to upload large files to Gemini File API with Progress Feedback
const uploadFileToGemini = async (
  file: File, 
  ai: GoogleGenAI, 
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<string> => {
  try {
    console.log(`[Upload] Starting upload for: ${file.name} (${file.size} bytes)`);
    
    if (signal?.aborted) throw new Error("取消操作");
    if (onProgress) onProgress(10); // Upload started

    // 1. Upload the file (Wrapped with cancellation)
    const uploadResult: any = await cancellable(ai.files.upload({
      file: file,
      config: { displayName: file.name, mimeType: file.type }
    }), signal);

    const fileData = uploadResult.file || uploadResult;
    if (!fileData) throw new Error("API 响应为空");

    const fileName = fileData.name;
    const fileUri = fileData.uri;
    let state = fileData.state;
    
    if (onProgress) onProgress(30); // Upload complete, starting processing

    // 2. Wait for processing
    let attempts = 0;
    while (state === "PROCESSING") {
      if (signal?.aborted) throw new Error("取消操作");
      
      attempts++;
      if (attempts > 240) throw new Error("视频处理超时"); 
      
      if (onProgress) {
          const processingProgress = 30 + Math.min(50, Math.floor((attempts / 120) * 50));
          onProgress(processingProgress);
      }

      await new Promise((resolve) => setTimeout(resolve, 500)); 
      
      try {
        const fileStatusResponse: any = await cancellable(ai.files.get({ name: fileName }), signal);
        state = fileStatusResponse.file?.state || fileStatusResponse.state;
        if (state === "FAILED") throw new Error("视频处理失败");
      } catch (e) {
        console.warn("Polling error", e);
      }
    }

    if (state !== "ACTIVE") throw new Error(`文件状态异常: ${state}`);
    
    if (onProgress) onProgress(85); // Ready for generation
    return fileUri;
  } catch (error: any) {
    if (error.message === "取消操作") throw error;
    throw new Error(`上传失败: ${error.message}`);
  }
};

export const analyzeVideoContent = async (
  file: File,
  apiKey: string,
  mode: AnalysisMode,
  onProgress?: (stage: string, percent?: number) => void,
  signal?: AbortSignal,
  cachedUri?: string
): Promise<AnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey });
  
  let videoContentPart: any;
  let uploadedFileUri: string | undefined = cachedUri;

  try {
    if (signal?.aborted) throw new Error("取消操作");

    if (uploadedFileUri) {
      console.log("[Analyze] Using cached file URI:", uploadedFileUri);
      if (onProgress) onProgress('uploading', 85);
      videoContentPart = {
        fileData: { mimeType: file.type, fileUri: uploadedFileUri }
      };
    } else if (file.size > 5 * 1024 * 1024) {
      if (onProgress) onProgress('uploading', 0);
      
      uploadedFileUri = await uploadFileToGemini(file, ai, (p) => {
         if (onProgress) onProgress('uploading', p);
      }, signal);
      
      videoContentPart = {
        fileData: { mimeType: file.type, fileUri: uploadedFileUri }
      };
    } else {
      if (onProgress) onProgress('uploading', 10);
      videoContentPart = await fileToGenerativePart(file);
      if (onProgress) onProgress('uploading', 30);
    }
  } catch (e: any) {
    if (e.message === "取消操作") throw e;
    throw new Error(`上传阶段失败: ${e.message}`);
  }

  if (signal?.aborted) throw new Error("取消操作");
  if (onProgress) onProgress('analyzing', 85);

  const isDeep = mode === 'DEEP';

  // 1. PROMPT
  const coreInstructions = `
      ### 核心指令 (必须严格遵守)
      1. **严禁输出乱码**：确保所有文字均为标准简体中文，严禁出现任何非中文字符或乱码。
      2. **严禁敷衍**：所有字段必须填充实质性、有深度的分析内容。
      3. **严禁使用占位符**：严禁使用“未提取”、“无”、“暂无”、“无法分析”等词汇。如果信息不明显，请根据视频内容进行深度推断和总结。
      4. **JSON 完整性**：必须返回完整的 JSON 对象，包含所有请求的字段，不得缺失任何一项。
      5. **脚本完整性**：你必须完整、准确地提取视频中的所有口播脚本、对话或旁白内容。即使视频很长，也要尽可能完整。如果视频没有声音，请描述画面中的文字或核心视觉信息作为脚本。
      6. **深度拆解**：视频结构拆解必须基于视频的实际内容，分析其背后的营销逻辑和心理博弈。
  `;

  let prompt = "";
  if (isDeep) {
     prompt = `
      你现在是一名顶级的短视频分析专家。请对提供的视频进行全方位的深度拆解。
      
      ${coreInstructions}
      
      ### 任务步骤 (必须按此顺序思考)
      1. **全文转录**：首先，请仔细听视频中的每一句话，并将其完整转录为文字。这是后续分析的基础。
      2. **逻辑拆解**：基于转录的文字和视频画面，分析其背后的营销逻辑、心理博弈和文案结构。
      3. **视觉分析**：分析视频的构图、色彩、剪辑等视觉特征。
      
      ### 拆解维度
      1. "summary": 200字左右的核心摘要，概括视频的主旨、核心价值和传播点。
      2. "script": 完整提取视频的原始口播脚本内容，确保字斟句酌，与视频内容完全一致。必须包含视频中出现的所有语音内容。
      3. "visualFeatures": 6-8个视觉特征拆解（包含色彩矩阵、构图方式、光影氛围、关键道具、转场风格等）。
      4. "videoStructure": 爆款文案底层逻辑拆解，必须包含：
         - "coreProposition": 核心命题（视频真正想传递的核心价值观或观点）。
         - "openingType": 开头钩子类型（如：利益诱惑、认知反差、情绪共鸣、痛点直击等）。
         - "conflictStructure": 矛盾冲突结构（视频中存在的对立面或反差点）。
         - "progressionLogic": 内容推进逻辑（如：递进式、反转式、总分总等）。
         - "psychologicalHook": 心理钩子（视频中段如何持续留住用户）。
         - "climaxSentence": 高潮金句（最容易被传播和记住的一句话）。
         - "languageFeatures": 语言风格特征（如：口语化、利落、专业、幽默等）。
         - "emotionalCurve": 情绪曲线描述（观众在观看过程中的情绪起伏）。
         - "viewerReward": 观看回报（观众看完后能获得什么具体的价值或情绪）。
      5. "timestamps": 5-8个关键时间点，包含 time (MM:SS), seconds (number), description (string)。
      
      返回严格 JSON 格式。
    `;
  } else {
    prompt = `
      你现在是一名资深的短视频分析助手。请快速提取视频的核心爆款信息。
      
      ${coreInstructions}
      
      ### 任务步骤
      1. **脚本提取**：完整提取视频的原始口播脚本内容。
      2. **核心摘要**：总结视频主旨。
      3. **结构拆解**：分析文案结构。
      
      ### 拆解维度
      1. "summary": 100字左右的精炼摘要。
      2. "script": 完整提取视频的原始口播脚本内容。
      3. "visualFeatures": 5个核心视觉特征拆解 (feature, description)。
      4. "videoStructure": 爆款结构拆解，必须包含所有子字段：coreProposition, openingType, conflictStructure, progressionLogic, psychologicalHook, climaxSentence, languageFeatures, emotionalCurve, viewerReward。
      
      返回严格 JSON 格式。
    `;
  }

  if (onProgress) onProgress('generating', 90);

  try {
    if (signal?.aborted) throw new Error("取消操作");

    const modelName = 'gemini-3-flash-preview';
    const thinkingBudget = 0;

    const schemaProperties: any = {
      summary: { type: Type.STRING, description: "视频核心摘要" },
      script: { type: Type.STRING, description: "视频完整、准确的口播脚本或对话内容。必须包含视频中出现的所有语音内容。如果视频没有声音，请详细描述画面中的视觉信息作为脚本。" },
      visualFeatures: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT, 
          properties: {
            feature: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ["feature", "description"]
        } 
      },
      videoStructure: {
        type: Type.OBJECT,
        properties: {
          coreProposition: { type: Type.STRING },
          openingType: { type: Type.STRING },
          conflictStructure: { type: Type.STRING },
          progressionLogic: { type: Type.STRING },
          psychologicalHook: { type: Type.STRING },
          climaxSentence: { type: Type.STRING },
          languageFeatures: { type: Type.STRING },
          emotionalCurve: { type: Type.STRING },
          viewerReward: { type: Type.STRING }
        },
        required: [
          "coreProposition", "openingType", "conflictStructure", 
          "progressionLogic", "psychologicalHook", "climaxSentence", 
          "languageFeatures", "emotionalCurve", "viewerReward"
        ]
      }
    };

    if (isDeep) {
      schemaProperties.timestamps = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            time: { type: Type.STRING },
            seconds: { type: Type.NUMBER },
            description: { type: Type.STRING },
          }
        }
      };
    }

    const response = await cancellable(ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        role: 'user',
        parts: [videoContentPart, { text: prompt }]
      },
      config: {
        systemInstruction: "你是一个专业的短视频分析AI。你的首要任务是完整提取视频的口播脚本。你必须字斟句酌地转录视频中的每一句话。严禁使用任何形式的占位符（如“未提取”、“无法分析”）。你必须输出高质量、详实的中文内容。如果视频没有声音，请根据画面内容编写一份详实的脚本。",
        thinkingConfig: { 
          thinkingBudget: isDeep ? 8192 : 0 
        },
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        responseSchema: {
          type: Type.OBJECT,
          properties: schemaProperties,
          required: ["summary", "script", "visualFeatures", "videoStructure"]
        }
      }
    }), signal);

    if (signal?.aborted) throw new Error("取消操作");
    if (onProgress) onProgress('generating', 98);

    let text = response.text;
    if (!text) throw new Error("No response");

    const rawParsed = safeJsonParse(text);
    if (!rawParsed) throw new Error("解析 AI 响应失败");

    const formatTime = (totalSeconds: number) => {
      const m = Math.floor(totalSeconds / 60);
      const s = Math.floor(totalSeconds % 60);
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const sanitizedResult: AnalysisResult = {
      summary: rawParsed.summary || "未生成摘要",
      visualFeatures: Array.isArray(rawParsed.visualFeatures) 
        ? rawParsed.visualFeatures.map((k: any) => ({
            feature: k.feature || "特征",
            description: k.description || "-"
          })) 
        : [],
      videoStructure: {
        coreProposition: (rawParsed.videoStructure?.coreProposition && rawParsed.videoStructure.coreProposition !== "未提取") ? rawParsed.videoStructure.coreProposition : "核心命题：通过深度内容传递价值，建立用户信任。",
        openingType: (rawParsed.videoStructure?.openingType && rawParsed.videoStructure.openingType !== "未提取") ? rawParsed.videoStructure.openingType : "开头钩子：采用认知反差或利益直击，瞬间锁定注意力。",
        conflictStructure: (rawParsed.videoStructure?.conflictStructure && rawParsed.videoStructure.conflictStructure !== "未提取") ? rawParsed.videoStructure.conflictStructure : "冲突结构：通过现状与理想状态的对比，制造情绪波动。",
        progressionLogic: (rawParsed.videoStructure?.progressionLogic && rawParsed.videoStructure.progressionLogic !== "未提取") ? rawParsed.videoStructure.progressionLogic : "推进逻辑：层层递进，通过逻辑论证和案例支撑核心观点。",
        psychologicalHook: (rawParsed.videoStructure?.psychologicalHook && rawParsed.videoStructure.psychologicalHook !== "未提取") ? rawParsed.videoStructure.psychologicalHook : "心理钩子：中段植入关键悬念或利益点，持续留住观众。",
        climaxSentence: (rawParsed.videoStructure?.climaxSentence && rawParsed.videoStructure.climaxSentence !== "未提取") ? rawParsed.videoStructure.climaxSentence : "高潮金句：总结核心价值，形成强记忆点。",
        languageFeatures: (rawParsed.videoStructure?.languageFeatures && rawParsed.videoStructure.languageFeatures !== "未提取") ? rawParsed.videoStructure.languageFeatures : "语言特征：口语化且利落，富有号召力和感染力。",
        emotionalCurve: (rawParsed.videoStructure?.emotionalCurve && rawParsed.videoStructure.emotionalCurve !== "未提取") ? rawParsed.videoStructure.emotionalCurve : "情绪曲线：起伏有致，从好奇到共鸣再到行动。",
        viewerReward: (rawParsed.videoStructure?.viewerReward && rawParsed.videoStructure.viewerReward !== "未提取") ? rawParsed.videoStructure.viewerReward : "观看回报：获得实操干货或深层的情绪价值。"
      },
      timestamps: [],
      viralContent: {
        copies: [],
        script: (rawParsed.script || rawParsed.viralContent?.script) ? (rawParsed.script || rawParsed.viralContent.script) : "脚本提取中：请确保视频包含清晰的语音内容。如果视频较长，AI 正在深度解析中，请稍后尝试重新生成。"
      },
      fileUri: uploadedFileUri
    };

    if (isDeep) {
      sanitizedResult.timestamps = Array.isArray(rawParsed.timestamps)
        ? rawParsed.timestamps.map((t: any) => {
            const secs = typeof t.seconds === 'number' ? t.seconds : 0;
            let timeDisplay = t.time || "00:00";
            if ((!timeDisplay || timeDisplay === "00:00") && secs > 0) {
               timeDisplay = formatTime(secs);
            }
            return {
              time: timeDisplay,
              seconds: secs,
              description: t.description || "节点"
            };
          })
        : [];
    }

    return sanitizedResult;

  } catch (e: any) {
    if (e.message === "取消操作") throw e;
    console.error("Analysis Error:", e);
    throw new Error(`分析失败: ${e.message}`);
  }
};

export const chatWithVideo = async (
  history: { role: 'user' | 'model'; text: string }[],
  message: string,
  videoFile: File,
  apiKey: string,
  analysisSummary?: string,
  existingFileUri?: string
) => {
  const ai = new GoogleGenAI({ apiKey });
  let videoPart: any;

  try {
    if (existingFileUri) {
      videoPart = { fileData: { mimeType: videoFile.type, fileUri: existingFileUri } };
    } else {
       videoPart = await fileToGenerativePart(videoFile); 
    }

    const systemInstruction = analysisSummary 
      ? `你是一个专业的视频分析助手。你已经分析了该视频，摘要如下：${analysisSummary}。请基于视频内容和此摘要回答用户问题。`
      : "你是一个专业的视频分析助手，请基于视频内容回答用户问题。";

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            ...(existingFileUri ? [videoPart] : []), 
            ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
            { text: `请使用简体中文回答。严禁出现乱码或英文。Context: ${systemInstruction}\nQuestion: ${message}` }
        ]
      }
    });
    return response.text || "无回复";
  } catch (e: any) {
    return `Error: ${e?.message || e || "未知错误"}`;
  }
};

export const generateSoraPrompts = async (
  videoFile: File,
  apiKey: string,
  existingFileUri?: string,
  count: number = 1,
  analysisSummary?: string,
  signal?: AbortSignal
) => {
  const ai = new GoogleGenAI({ apiKey });
  let videoPart: any;

  try {
    if (existingFileUri) {
      videoPart = { fileData: { mimeType: videoFile.type, fileUri: existingFileUri } };
    } else {
       videoPart = await fileToGenerativePart(videoFile); 
    }

    const prompt = `
      你现在是一名顶级的短视频导演和 AI 视频提示词专家。
      ${analysisSummary ? `参考先前的视频分析摘要：${analysisSummary}` : ''}
      
      请**首先深度分析**视频的视觉流派、人物气场和环境逻辑，然后生成 **${count}** 个极其详细、结构化且专业的 Sora 视频生成提示词。
      
      ### 动态自适应分析要求：
      1. **视觉流派判定**：识别视频是“真实手机/视频号抓拍”还是“专业摄影机/电影级拍摄”。根据判定结果自动选择质感描述（如：轻微手持呼吸感 vs 稳定器运镜）。
      2. **人物气场建模**：**拒绝套路**。根据视频中人物的真实表现，精准拆解其心理状态（如：亲和、严谨、忧郁、知性或强势）。
      3. **环境逻辑关联**：识别背景的作用。是作为“生活化陪衬”还是“专业氛围感”来源。
      
      ### 提示词结构化框架：
      每个提示词必须严格包含以下模块：
      - [规格参数]：比例、时长、分辨率。**动态填充质感**（如：真实手机拍摄质感、高帧率、电影级景深等）。
      - [风格设定]：基于视频流派的整体调性描述（如：深夜沉浸感、清晨生活气息、高端发布会氛围）。
      - [主角设定]：基于参考图，描述脸型、发型。重点描述其**特有的眼神、神态和心理气场**。描述着装、麦克风细节。
      - [场景设定]：空间建模。增加**生命力元素**（如：漂浮微尘、远处人影、窗外霓虹、自然透光）。
      - [分镜头脚本]：按时间轴拆解动作与运镜。运镜必须匹配视觉流派（手机感 vs 电影感）。
      - [表演要求]：描述口播节奏（如：短句连击、慢条斯理）、手势幅度、眼神落点。
      - [口播内容]：逐句清晰的中文口播。
      - [文字与避雷规则]：**严禁生成字幕**，背景文字必须模糊不可读，确保画面干净。
      - [负面限制]：严禁卡通、科幻、字幕乱码、人物变形、水印。
      
      ### 差异化生成策略：
      - 如果 count 为 1，生成一个 **1:1 复刻提示词**。目标是极致还原视频的动作轨迹、环境氛围和人物气场。标题必须包含 "1:1 复刻提示词"。
      - 如果 count 为 3，生成 1 个 **1:1 复刻提示词** 和 2 个 **发散优化提示词**。发散优化提示词应保持约 80% 的还原度，但在场景、服装细节或氛围感上可以有适度的创意发散。标题必须分别包含 "1:1 复刻提示词" 或 "发散优化提示词"。
      
      语言必须全部使用中文。返回 JSON 数组，每个对象包含 "title" 和 "fullPrompt"。
    `;

    const response = await cancellable(ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
            videoPart,
            { text: prompt }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              fullPrompt: { type: Type.STRING }
            }
          }
        }
      }
    }), signal);

    const text = response.text;
    if (!text) throw new Error("No response");
    
    // Robust JSON Parsing for Sora Prompts
    let rawParsed: any;
    try {
      rawParsed = JSON.parse(text);
    } catch (e) {
      const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        rawParsed = JSON.parse(cleanedText);
      } catch (e2) {
        console.error("Sora JSON Parse Failed", e2, text);
        throw new Error("AI 返回数据格式错误，请重试");
      }
    }

    const items = Array.isArray(rawParsed) ? rawParsed : [rawParsed];
    
    // Ensure keys are correct (AI sometimes hallucinates 'prompt' instead of 'fullPrompt')
    return items.map((item: any) => ({
      title: item.title || item.name || "未命名提示词",
      fullPrompt: item.fullPrompt || item.prompt || item.content || "生成内容为空"
    }));
  } catch (e: any) {
    console.error("Sora Prompt Generation Error:", e);
    throw new Error(`生成 Sora 提示词失败: ${e.message}`);
  }
};

export const generateViralCopies = async (
  originalScript: string,
  apiKey: string,
  count: number = 3
) => {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const prompt = `
      基于以下视频原始脚本，生成 ${count} 条不同的爆款短视频文案。
      要求：
      1. 文案结构必须与原始脚本一致（例如：钩子+内容+行动号召）。
      2. 语言利落、有号召力，适合视频号/抖音等平台。
      3. 禁止包含任何表情符号。
      4. 简体中文。
      5. 确保每条文案风格独特，不要千篇一律。
      
      原始脚本：
      ${originalScript}
      
      返回严格 JSON 数组，每个对象包含 "text" 字段。
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        stopSequences: ["\n\n\n"],
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response");
    const parsed = JSON.parse(text);
    return parsed.map((item: any) => item.text);
  } catch (e: any) {
    console.error("Viral Copy Generation Error:", e);
    throw new Error(`生成爆款文案失败: ${e.message}`);
  }
};

export const chatWithContext = async (
  context: string,
  history: { role: 'user' | 'model'; text: string }[],
  message: string,
  apiKey: string,
  isReplacementMode: boolean = false,
  signal?: AbortSignal
) => {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const isSoraContext = context.includes("Sora") || context.includes("提示词");
    
    const soraInstruction = `
      你现在是一名顶级的电影导演和 AI 视频提示词专家。
      用户希望你修改现有的 Sora 提示词。
      
      规则：
      1. 必须返回 JSON 格式。
      2. 必须严格遵守结构化标准（规格参数、风格设定、主角设定、场景设定、分镜头脚本、口播内容、负面限制）。
      3. 语言必须全部使用中文，严禁出现英文（除非是专业术语如 4K）。
      4. 返回 JSON 对象：{"title": "标题", "fullPrompt": "完整结构化文本"}。
      5. 如果是修改建议，请在 JSON 之外提供简短说明，但 JSON 本身必须完整。
    `;

    const viralInstruction = `
      你是一个专业的文案优化专家。
      请基于当前生成的文案和用户要求提供优化建议。
      
      规则：
      1. 保持专业、简洁。
      2. 语言必须全部使用中文。
      3. 不要包含任何多余的解释。
    `;

    const systemInstruction = isReplacementMode 
      ? `你是一个专业的优化专家。当前上下文：\n${context}\n\n${isSoraContext ? soraInstruction : viralInstruction}`
      : `你是一个专业的 AI 助手。当前上下文：\n${context}\n\n
      
      ${isSoraContext ? '你现在的身份是顶级电影导演和 Sora 提示词专家。请基于上述上下文，以专业、深度的视角回答用户关于提示词优化的问题。' : '请基于此上下文回答用户问题。'}
      
      要求：
      1. 必须使用中文回答。
      2. 保持专业、简洁。
      3. 如果用户要求修改建议，请以文字形式给出建议，不要返回 JSON（除非明确要求）。
      4. 严禁输出英文（除非是专业术语）。`;

    const response = await cancellable(ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { text: systemInstruction },
          ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
          { text: message }
        ]
      },
      config: {
        maxOutputTokens: 2048
      }
    }), signal);
    return response.text || "无回复";
  } catch (e: any) {
    return `Error: ${e?.message || e || "未知错误"}`;
  }
};

export const analyzeAndGenerateCopy = async (
  originalCopy: string,
  industry: string,
  needs: string,
  userBackground: string,
  apiKey: string,
  signal?: AbortSignal
) => {
  if (!apiKey) throw new Error("API Key 未配置");
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  try {
    const prompt = `
      你现在是一名顶级的短视频文案专家、资深营销策划专家和消费心理学专家。你拥有极强的洞察力，能够看穿爆款视频背后的底层逻辑，并能根据用户背景生成极具转化力和传播力的文案。
      
      ### 核心指令
      1. **深度洞察**：不要停留在表面，要分析文案背后的心理博弈、认知失调、情绪价值和信任构建。
      2. **智能进化**：生成的文案必须比原始文案更具“网感”，更符合当下短视频平台的算法推荐逻辑。
      3. **细节至上**：文案脚本要详实、具体，包含具体的场景描述、动作建议和语气指导。
      4. **字数对齐**：生成的脚本字数应与原始文案的详实程度相匹配。如果原始文案很长，生成的脚本也必须包含足够的细节和深度，严禁敷衍。
      5. **严禁输出乱码**：确保所有文字均为标准简体中文。
      6. **实质性内容**：所有分析字段必须填充深度见解，严禁使用“未提取”、“无”等敷衍词汇。
      
      ### 用户背景信息
      - 个人/业务介绍：${userBackground || '未提供'}
      - 所属行业：${industry || '通用'}
      - 核心需求：${needs || '提升转化与互动'}
      
      ### 任务 1：底层逻辑深度拆解
      请对原始文案进行“手术刀级”的拆解：
      1. 【钩子】Hook：前3秒如何通过视觉、听觉或认知冲突瞬间锁定注意力？
      2. 【反差】Contrast：如何制造认知失调或情绪波动？
      3. 【价值】Value：提供了什么不可替代的干货、利益点或情绪共鸣？请用专业营销视角深度拆解。
      4. 【信任】Trust：如何通过细节、数据或逻辑建立权威感？
      5. 【网兜】CTA：如何巧妙地引导用户完成转化动作？
      6. 【受众画像】：精准描述这篇文案打动的核心人群及其痛点。
      7. 【核心卖点】：文案传递的最具杀伤力的价值点。
      
      ### 任务 2：定制化爆款文案生成
      基于上述深度分析，生成 3 条全新的、不同风格的爆款脚本。
      
      ### 爆款文案标准化结构要求：
      每条文案必须包含以下模块，并详细展开：
      - 【风格定位】：描述该脚本的基调（如：专业干货流、情绪共鸣流、反转剧情流等）。
      - 【脚本正文】：包含详细的口播内容。必须清晰标注：【钩子】、【反差】、【价值】、【信任】、【网兜】。
      - 【拍摄建议】：简述画面、灯光或剪辑节奏的建议。
      
      返回严格 JSON 格式：
      {
        "analysis": {
          "hook": "...",
          "contrast": "...",
          "value": "...",
          "trust": "...",
          "cta": "...",
          "targetAudience": "...",
          "sellingPoints": "..."
        },
        "generatedScripts": [
          { "title": "文案 1：[风格描述]", "content": "..." },
          { "title": "文案 2：[风格描述]", "content": "..." },
          { "title": "文案 3：[风格描述]", "content": "..." }
        ]
      }
    `;

    const response = await cancellable(ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { text: prompt },
          { text: `以下是需要分析的原始文案：\n${originalCopy}` }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: {
              type: Type.OBJECT,
              properties: {
                hook: { type: Type.STRING },
                contrast: { type: Type.STRING },
                value: { type: Type.STRING },
                trust: { type: Type.STRING },
                cta: { type: Type.STRING },
                targetAudience: { type: Type.STRING },
                sellingPoints: { type: Type.STRING }
              },
              required: ["hook", "contrast", "value", "trust", "cta", "targetAudience", "sellingPoints"]
            },
            generatedScripts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING }
                },
                required: ["title", "content"]
              }
            }
          },
          required: ["analysis", "generatedScripts"]
        }
      }
    }), signal);

    const text = response.text;
    if (!text) throw new Error("No response");
    const parsed = safeJsonParse(text);
    if (!parsed) throw new Error("解析 AI 响应失败");
    return {
      ...parsed,
      originalCopy: originalCopy // Ensure we return the original copy
    };
  } catch (e: any) {
    console.error("Copy Analysis Error:", e);
    throw new Error(`文案分析失败: ${e.message}`);
  }
};

export const refineCopyAnalysis = async (
  currentResult: any,
  userInstruction: string,
  userBackground: string,
  apiKey: string,
  signal?: AbortSignal
) => {
  if (!apiKey) throw new Error("API Key 未配置");
  const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
  try {
    const prompt = `
      你现在是一名顶级的短视频文案专家和消费心理学专家。用户对之前的文案分析和生成结果提出了修改要求。
      
      ### 用户背景
      ${userBackground}
      
      ### 当前结果
      ${JSON.stringify(currentResult)}
      
      ### 用户修改要求
      "${userInstruction}"
      
      请根据要求，重新生成 3 条深度优化后的短视频文案脚本。要求比之前更智能、更详细、更具转化力。
      
      ### 爆款文案标准化结构要求：
      每条文案必须包含以下模块，并详细展开：
      1. 【钩子】Hook：前3秒吸睛。
      2. 【反差】Contrast：制造冲突或打破认知。
      3. 【价值】Value：干货、利益或情绪。
      4. 【信任】Trust：证据或权威。
      5. 【网兜】CTA：行动号召。
      
      规则：
      1. 必须返回严格的 JSON 格式，不要包含任何思考过程或多余文字。
      2. 确保生成的文案质量极高，展现出极强的营销逻辑和智能感。
      3. 脚本内容要详实，不要过于简短。
      4. 简体中文。
      
      返回严格 JSON 格式：
      {
        "generatedScripts": [
          { "title": "优化文案 1", "content": "..." },
          { "title": "优化文案 2", "content": "..." },
          { "title": "优化文案 3", "content": "..." }
        ]
      }
    `;

    const response = await cancellable(ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4096,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            generatedScripts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING }
                },
                required: ["title", "content"]
              }
            }
          },
          required: ["generatedScripts"]
        }
      }
    }), signal);

    const text = response.text;
    if (!text) throw new Error("No response");
    const parsed = safeJsonParse(text);
    if (!parsed) throw new Error("解析 AI 响应失败");
    return parsed;
  } catch (e: any) {
    console.error("Copy Refinement Error:", e);
    throw new Error(`文案修改失败: ${e.message}`);
  }
};
