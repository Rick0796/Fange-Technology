
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
  signal?: AbortSignal
): Promise<AnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey });
  
  let videoContentPart: any;
  let uploadedFileUri: string | undefined;

  try {
    if (signal?.aborted) throw new Error("取消操作");

    // Threshold 5MB for better mobile stability
    if (file.size > 5 * 1024 * 1024) {
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
  let prompt = "";
  if (isDeep) {
     prompt = `
      作为专家，请分析视频。返回严格JSON。
      1. "summary": 200字核心摘要。
      2. "visualFeatures": 5-8个视觉特征拆解（包含色彩矩阵、构图方式、光影物理、关键道具等）。
      3. "videoStructure": 爆款文案完整拆解 8 步法，包含：
         - "coreProposition": 核心命题（它真正想表达什么，一句话）。
         - "openingType": 文案开头类型（冲突/利益/恐惧/反常识/代入/断言）。
         - "conflictStructure": 矛盾冲突结构（两端是什么）。
         - "progressionLogic": 推进逻辑（递进/对比/论证/举例/反转）。
         - "psychologicalHook": 心理钩子（中段哪一句吸引注意力）。
         - "climaxSentence": 高潮金句（最强记忆句）。
         - "languageFeatures": 语言结构特征（句长、风格DNA）。
         - "emotionalCurve": 情绪曲线（起承转合的情绪波动）。
         - "viewerReward": 观看回报（观众得到什么）。
      4. "timestamps": 4-6个时间点。
      5. "viralContent": {
         "script": 提取视频的原始脚本内容，确保与视频内容一致。
      }
      简体中文。
    `;
  } else {
    prompt = `
      提取视频核心。仅JSON。
      1. summary: 50字简要摘要。
      2. visualFeatures: 5个视觉特征拆解(feature, description 20字)。
      3. videoStructure: 爆款文案结构拆解（coreProposition, openingType, conflictStructure, progressionLogic, psychologicalHook, climaxSentence, languageFeatures, emotionalCurve, viewerReward）。
      4. viralContent: 爆款文案（无表情）、原始脚本。
      简体中文。
    `;
  }

  if (onProgress) onProgress('generating', 90);

  try {
    if (signal?.aborted) throw new Error("取消操作");

    const modelName = isDeep ? 'gemini-2.5-flash' : 'gemini-flash-lite-latest';
    const thinkingBudget = isDeep ? 8192 : 0;

    const schemaProperties: any = {
      summary: { type: Type.STRING },
      visualFeatures: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT, 
          properties: {
            feature: { type: Type.STRING },
            description: { type: Type.STRING }
          }
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
        }
      },
      viralContent: {
        type: Type.OBJECT,
        properties: {
          script: { type: Type.STRING }
        }
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

    // Wrapped with cancellable
    const response = await cancellable(ai.models.generateContent({
      model: modelName,
      contents: {
        role: 'user',
        parts: [videoContentPart, { text: prompt }]
      },
      config: {
        thinkingConfig: { thinkingBudget: thinkingBudget },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: schemaProperties
        }
      }
    }), signal);

    if (signal?.aborted) throw new Error("取消操作");
    if (onProgress) onProgress('generating', 98);

    let text = response.text;
    if (!text) throw new Error("No response");

    // 1. Safe JSON Parsing
    let rawParsed: any = {};
    try {
      rawParsed = JSON.parse(text);
    } catch (e) {
      const cleanedText = text.replace(/```json/g, '').replace(/```/g, '');
      try {
        rawParsed = JSON.parse(cleanedText);
      } catch (e2) {
        console.error("JSON Parse Failed", e2);
        throw new Error("AI 返回数据格式错误，请重试");
      }
    }

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
      videoStructure: rawParsed.videoStructure || {
        coreProposition: "未提取",
        openingType: "未提取",
        conflictStructure: "未提取",
        progressionLogic: "未提取",
        psychologicalHook: "未提取",
        climaxSentence: "未提取",
        languageFeatures: "未提取",
        emotionalCurve: "未提取",
        viewerReward: "未提取"
      },
      timestamps: [],
      viralContent: {
        copies: [],
        script: rawParsed.viralContent?.script || "未提取脚本"
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
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
            ...(existingFileUri ? [videoPart] : []), 
            ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
            { text: `Answer in Chinese. Context: ${systemInstruction}\nQuestion: ${message}` }
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
      model: 'gemini-2.5-flash',
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
      
      原始脚本：
      ${originalScript}
      
      返回严格 JSON 数组，每个对象包含 "text" 字段。
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }] },
      config: {
        responseMimeType: 'application/json',
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
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { text: systemInstruction },
          ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
          { text: message }
        ]
      }
    }), signal);
    return response.text || "无回复";
  } catch (e: any) {
    return `Error: ${e?.message || e || "未知错误"}`;
  }
};
