
import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { chatWithVideo, chatWithContext } from '../services/geminiService';

interface ChatInterfaceProps {
  apiKey: string;
  videoFile?: File;
  fileUri?: string;
  analysisSummary?: string;
  context?: string;
  initialMessage?: string;
  placeholder?: string;
  title?: string;
  height?: string;
  isReplacementMode?: boolean;
  onUpdate?: (data: any) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  videoFile, 
  apiKey, 
  fileUri, 
  analysisSummary, 
  context,
  initialMessage,
  placeholder = "向 AI 提问...",
  title = "AI 助手",
  height = "600px",
  isReplacementMode = false,
  onUpdate
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  // Initial message
  useEffect(() => {
    if (messages.length === 0) {
      let text = initialMessage;
      if (!text && analysisSummary) {
        text = `你好！我已经分析完视频了。摘要如下：\n\n${analysisSummary}\n\n你可以问我关于视频的任何问题。`;
      }
      
      if (text) {
        const initialMsg: ChatMessage = {
          id: 'initial',
          role: 'model',
          text: text,
          timestamp: Date.now()
        };
        setMessages([initialMsg]);
      }
    }
  }, [analysisSummary, initialMessage]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      let responseText = "";
      
      if (context) {
        responseText = await chatWithContext(context, history, input, apiKey, isReplacementMode, controller.signal);
        clearTimeout(timeoutId);
        
        // If in replacement mode, try to parse and update
        if (isReplacementMode && onUpdate) {
          try {
            // Try to find JSON in the response (looking for code blocks first)
            const jsonBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
            const rawJsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]|\{\s*[\s\S]*\s*\}|\[\s*"[\s\S]*"\s*\]/);
            
            const jsonString = jsonBlockMatch ? jsonBlockMatch[1] : (rawJsonMatch ? rawJsonMatch[0] : null);
            
            if (jsonString) {
              try {
                const parsed = JSON.parse(jsonString);
                onUpdate(parsed);
                
                // If we found JSON, we might want to clean up the response text for the chat bubble
                // but keep any actual conversational text the AI provided.
                if (jsonBlockMatch) {
                  responseText = responseText.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
                } else if (rawJsonMatch) {
                  responseText = responseText.replace(rawJsonMatch[0], '').trim();
                }
                
                if (!responseText) {
                  responseText = "已根据您的要求更新内容。";
                }
              } catch (parseError) {
                console.error("JSON Parse Error:", parseError);
              }
            }
          } catch (e) {
            console.error("Failed to process replacement response:", e);
          }
        }
      } else if (videoFile) {
        responseText = await chatWithVideo(history, input, videoFile, apiKey, analysisSummary, fileUri);
      } else {
        responseText = "未提供上下文或视频文件，无法回答。";
      }
      
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error(error);
      const isAbort = error.name === 'AbortError' || error.message === '取消操作';
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: isAbort ? "错误：请求超时或已取消，请重试。" : "错误：无法连接到智能核心。",
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`flex flex-col relative group`} style={{ height }}>
      {/* Sci-Fi Border */}
      <div className="absolute inset-0 bg-[#0A0A1F]/80 backdrop-blur-xl border border-[#00F0FF]/20 clip-path-corner"></div>
      
      {/* Header */}
      <div className="relative z-10 p-3 border-b border-[#00F0FF]/10 flex items-center justify-between bg-[#00F0FF]/5">
        <h3 className="font-mono font-bold text-[#00F0FF] flex items-center gap-2 uppercase text-[10px] tracking-wider">
          <span className="w-1.5 h-1.5 bg-[#00F0FF] rounded-full animate-pulse"></span>
          {title}
        </h3>
        <span className="text-[8px] text-[#00F0FF]/50 font-mono">状态: 在线</span>
      </div>
      
      {/* Messages Area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-3 space-y-3 font-mono text-[11px] scrollbar-thin scrollbar-thumb-[#00F0FF]/20 scrollbar-track-transparent">
        {messages.length === 0 && (
          <div className="text-center text-[#00F0FF]/40 mt-10">
            <p className="mb-1 uppercase tracking-widest text-[10px]">等待指令...</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] px-3 py-2 border ${
              msg.role === 'user' 
                ? 'bg-[#00F0FF]/10 border-[#00F0FF]/30 text-[#00D4FF] rounded-tl-lg rounded-bl-lg rounded-tr-lg' 
                : 'bg-black/40 border-white/10 text-slate-300 rounded-tr-lg rounded-br-lg rounded-tl-lg'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-black/40 border border-white/10 px-3 py-2 text-[10px] text-[#00F0FF] animate-pulse rounded-tr-lg rounded-br-lg rounded-tl-lg">
              思考中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="relative z-10 p-3 border-t border-[#00F0FF]/10 bg-[#00F0FF]/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 bg-black/50 border border-[#00F0FF]/20 text-[#00F0FF] placeholder-[#00F0FF]/30 focus:border-[#00F0FF] focus:ring-1 focus:ring-[#00F0FF] outline-none text-[11px] font-mono transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-[#00F0FF] hover:bg-white text-black font-bold px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
