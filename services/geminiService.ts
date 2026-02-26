
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

    // Threshold 20MB
    if (file.size > 20 * 1024 * 1024) {
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
      2. "keyTakeaways": 5-8个知识点。
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
      2. keyTakeaways: 5个核心要点(point, detail 20字)。
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
      keyTakeaways: { 
        type: Type.ARRAY, 
        items: { 
          type: Type.OBJECT, 
          properties: {
            point: { type: Type.STRING },
            detail: { type: Type.STRING }
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
      keyTakeaways: Array.isArray(rawParsed.keyTakeaways) 
        ? rawParsed.keyTakeaways.map((k: any) => ({
            point: k.point || "要点",
            detail: k.detail || "-"
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
      model: 'gemini-3.1-pro-preview',
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
    return `Error: ${e.message}`;
  }
};

export const generateSoraPrompts = async (
  videoFile: File,
  apiKey: string,
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

    const prompt = `
      你现在是一名顶级的电影导演和 AI 视频提示词专家。请基于视频内容，生成 **1个** 极其详细、结构化且专业的 Sora 视频生成提示词。
      
      要求：
      1. **严禁重复**，严禁废话。内容必须高度凝练、专业且具有极强的视觉指导性。
      2. **结构化呈现**：必须包含以下模块：
         - [规格参数]：如 9:16, 10s, 4K, 写实质感。
         - [风格设定]：如 高端商务、手持跟拍、电影级光影。
         - [主角设定]：外貌、衣着、神态、核心气质。
         - [场景设定]：环境细节、背景元素、氛围感。
         - [分镜头脚本]：按时间轴（如 0-3s, 3-7s, 7-10s）详细描述动作、运镜和画面变化。
         - [口播内容]：视频中的核心金句。
         - [负面限制]：严禁出现的元素。
      3. 语言必须全部使用中文。
      4. 返回 JSON 对象，包含 "title" (简短标题) 和 "fullPrompt" (上述所有模块整合后的完整结构化文本)。
    `;

    const response = await ai.models.generateContent({
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
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            fullPrompt: { type: Type.STRING }
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response");
    const parsed = JSON.parse(text);
    // Return as array of 1 to maintain compatibility with UI
    return [parsed];
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
      model: 'gemini-3.1-pro-preview',
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
  isReplacementMode: boolean = false
) => {
  const ai = new GoogleGenAI({ apiKey });
  try {
    const systemInstruction = isReplacementMode 
      ? `你是一个专业的文案/提示词优化专家。当前上下文：\n${context}\n\n用户希望你修改现有的内容。
      
      规则：
      1. 如果用户要求修改内容，必须返回 JSON 格式。
      2. 如果是多个选项（如文案列表），请以 JSON 数组格式返回，例如：["新文案1", "新文案2"]。
      3. 如果是单个文案，也请以 JSON 数组格式返回：["新文案内容"]。
      4. 如果是 Sora 提示词，请以 JSON 对象格式返回，例如：{"title": "标题", "fullPrompt": "内容"}。
      5. 如果用户只是在聊天或提问，请正常回答，不要返回 JSON。
      6. 在返回 JSON 时，不要包含任何多余的解释或聊天。`
      : `你是一个专业的 AI 助手。当前上下文：\n${context}\n\n请基于此上下文回答用户问题。回答请简洁专业，使用中文。`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: {
        parts: [
          { text: systemInstruction },
          ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
          { text: message }
        ]
      }
    });
    return response.text || "无回复";
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
};
