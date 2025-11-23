
import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { chatWithVideo } from '../services/geminiService';

interface ChatInterfaceProps {
  videoFile: File;
  apiKey: string;
  fileUri?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ videoFile, apiKey, fileUri }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

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

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const responseText = await chatWithVideo(history, input, videoFile, apiKey, fileUri);
      
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: "错误：无法连接到智能核心。",
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] relative group">
      {/* Sci-Fi Border */}
      <div className="absolute inset-0 bg-[#0A0A1F]/80 backdrop-blur-xl border border-[#00F0FF]/20 clip-path-corner"></div>
      
      {/* Header */}
      <div className="relative z-10 p-4 border-b border-[#00F0FF]/10 flex items-center justify-between bg-[#00F0FF]/5">
        <h3 className="font-mono font-bold text-[#00F0FF] flex items-center gap-2 uppercase text-sm tracking-wider">
          <span className="w-2 h-2 bg-[#00F0FF] rounded-full animate-pulse"></span>
          AI 助教
        </h3>
        <span className="text-[10px] text-[#00F0FF]/50 font-mono">状态: 在线</span>
      </div>
      
      {/* Messages Area */}
      <div className="relative z-10 flex-1 overflow-y-auto p-4 space-y-4 font-mono text-sm scrollbar-thin scrollbar-thumb-[#00F0FF]/20 scrollbar-track-transparent">
        {messages.length === 0 && (
          <div className="text-center text-[#00F0FF]/40 mt-20">
            <p className="mb-2 uppercase tracking-widest text-xs">等待指令...</p>
            <p className="text-xs italic">"这个视频的核心论点是什么？"</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-4 py-3 border ${
              msg.role === 'user' 
                ? 'bg-[#00F0FF]/10 border-[#00F0FF]/30 text-[#00F0FF] rounded-tl-lg rounded-bl-lg rounded-tr-lg' 
                : 'bg-black/40 border-white/10 text-slate-300 rounded-tr-lg rounded-br-lg rounded-tl-lg'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-black/40 border border-white/10 px-4 py-3 text-xs text-[#00F0FF] animate-pulse rounded-tr-lg rounded-br-lg rounded-tl-lg">
              思考中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="relative z-10 p-4 border-t border-[#00F0FF]/10 bg-[#00F0FF]/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="向 AI 提问..."
            className="flex-1 px-4 py-2 bg-black/50 border border-[#00F0FF]/20 text-[#00F0FF] placeholder-[#00F0FF]/30 focus:border-[#00F0FF] focus:ring-1 focus:ring-[#00F0FF] outline-none text-sm font-mono transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-[#00F0FF] hover:bg-white text-black font-bold px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
