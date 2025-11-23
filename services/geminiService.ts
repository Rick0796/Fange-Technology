
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
      3. "mindMapMermaid": 生成 Mermaid.js 'graph TD' 代码。
         IMPORTANT: 
         - 节点ID必须是纯字母数字(A, B, C1, C2)。
         - 节点标签文本中禁止包含括号()、中括号[]、引号""，请替换为普通空格或逗号。
         - 保持结构简单清晰。
      4. "timestamps": 4-6个时间点。
      5. "actionItems": 3个行动建议。
      简体中文。
    `;
  } else {
    prompt = `
      提取视频核心。仅JSON。
      1. summary: 50字简要摘要。
      2. keyTakeaways: 5个核心要点(point, detail 20字)。
      3. actionItems: 2个建议。
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
      actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
    };

    if (isDeep) {
      schemaProperties.mindMapMermaid = { type: Type.STRING };
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
      mindMapMermaid: "", 
      timestamps: [],
      actionItems: Array.isArray(rawParsed.actionItems)
        ? rawParsed.actionItems.map((s: any) => String(s))
        : [],
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

      let m = rawParsed.mindMapMermaid || "";
      if (m) {
         m = m.replace(/```mermaid/g, '').replace(/```/g, '').trim();
         if (!m.startsWith('graph')) {
           m = `graph TD\n${m}`;
         }
         sanitizedResult.mindMapMermaid = m;
      } else {
         sanitizedResult.mindMapMermaid = "graph TD; A[解析完成] --> B[暂无结构];";
      }
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
            ...(existingFileUri ? [videoPart] : []), 
            ...history.map(h => ({ text: `${h.role === 'user' ? 'User' : 'Model'}: ${h.text}` })),
            { text: `Answer in Chinese. Question: ${message}` }
        ]
      }
    });
    return response.text || "无回复";
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
};
