
import React, { useEffect, useState, useRef } from 'react';

interface ProcessingVisualizerProps {
  status: 'UPLOADING' | 'ANALYZING' | 'GENERATING';
  progress: number;
  onCancel?: () => void;
}

const ProcessingVisualizer: React.FC<ProcessingVisualizerProps> = ({ status, progress, onCancel }) => {
  const [logs, setLogs] = useState<string[]>([]);
  // Use a ref for the container, not a dummy end element, to fix scroll jumping
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let interval: any;
    
    const uploadLogs = [
      "正在建立加密传输通道...",
      "视频分片上传中 [Chunk-0A]...",
      "验证数据完整性 CRC-32...",
      "正在同步至 AI 计算节点...",
      "云端存储空间分配完成...",
    ];

    const analyzeLogs = [
      "凡哥科技 AI 引擎已挂载...",
      "正在提取关键帧 (Keyframes)...",
      "音频流分离处理中...",
      "ASR 语音转文字同步进行...",
      "构建语义向量空间...",
      "识别核心知识实体...",
    ];

    const generateLogs = [
      "正在生成知识图谱结构...",
      "正在合成摘要报告...",
      "提取教学关键点...",
      "优化 Mermaid 图表语法...",
      "最终数据封装中...",
    ];

    let currentLogPool: string[] = [];
    if (status === 'UPLOADING') currentLogPool = uploadLogs;
    if (status === 'ANALYZING') currentLogPool = analyzeLogs;
    if (status === 'GENERATING') currentLogPool = generateLogs;

    const addLog = () => {
      const randomLog = currentLogPool[Math.floor(Math.random() * currentLogPool.length)];
      const now = new Date();
      // Only show HH:MM:SS, no milliseconds
      const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
      
      setLogs(prev => [...prev.slice(-6), `[${timeStr}] > ${randomLog}`]);
    };

    interval = setInterval(addLog, 800);
    return () => clearInterval(interval);
  }, [status]);

  // Fix: Use scrollTop on the container instead of scrollIntoView on the window
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      {/* Container: Glass Tech Panel */}
      <div className="relative bg-[#0F0F23]/80 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,212,255,0.1)] flex flex-col">
        
        {/* Decorative Tech Corners */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[#00D4FF] rounded-tl-lg"></div>
        <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#00D4FF] rounded-tr-lg"></div>
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-[#00D4FF] rounded-bl-lg"></div>
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[#00D4FF] rounded-br-lg"></div>

        {/* Scanline Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,212,255,0.02)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none z-0"></div>

        {/* Content Layout: CENTERED */}
        <div className="relative z-10 p-8 flex flex-col items-center justify-center text-center">
          
             {/* Progress Ring */}
             <div className="relative w-48 h-48 mb-8">
                <svg className="w-full h-full transform -rotate-90">
                    <circle cx="96" cy="96" r="80" stroke="rgba(255,255,255,0.1)" strokeWidth="8" fill="transparent" />
                    <circle 
                      cx="96" cy="96" r="80" 
                      stroke="#00D4FF" strokeWidth="8" fill="transparent" strokeLinecap="round"
                      strokeDasharray="502" strokeDashoffset={502 - (502 * progress) / 100} 
                      className="transition-all duration-300 ease-out drop-shadow-[0_0_15px_rgba(0,212,255,0.6)]" 
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-5xl font-bold text-white font-mono tracking-tighter">
                      {Math.round(progress)}<span className="text-2xl text-[#00D4FF]">%</span>
                    </span>
                    <span className="text-sm font-mono text-[#00D4FF] mt-2 animate-pulse">
                        {status === 'UPLOADING' && "上传中"}
                        {status === 'ANALYZING' && "分析中"}
                        {status === 'GENERATING' && "生成中"}
                    </span>
                </div>
                {/* Rotating Inner Ring Decoration */}
                <div className="absolute inset-0 border-2 border-dashed border-[#8B5CF6]/30 rounded-full animate-[spin_10s_linear_infinite]"></div>
             </div>

             {/* Terminal Logs (Centered below) */}
             <div 
                ref={logContainerRef}
                className="w-full max-w-md bg-black/40 rounded-lg border border-white/5 p-4 font-mono text-xs overflow-y-auto overflow-x-hidden h-32 flex flex-col shadow-inner mx-auto text-left scrollbar-thin scrollbar-thumb-slate-700"
             >
                <div className="mt-auto"> {/* Helper to force bottom alignment content-wise initially */}
                    {logs.map((log, i) => (
                    <div key={i} className="mb-1.5 break-all">
                        <span className="text-slate-500 mr-2">{log.split('>')[0]}&gt;</span>
                        <span className={`${i === logs.length - 1 ? 'text-[#00D4FF] font-bold shadow-[0_0_10px_rgba(0,212,255,0.3)]' : 'text-slate-300'}`}>
                            {log.split('>')[1]}
                        </span>
                    </div>
                    ))}
                </div>
             </div>
             
             {/* Data Processing Visualization */}
             <div className="flex gap-2 mt-6 opacity-80 mb-4">
                {[...Array(6)].map((_, i) => (
                  <div 
                    key={i} 
                    className="w-3 h-3 border border-[#00D4FF]/40 rounded-sm bg-[#00D4FF]/10"
                    style={{ 
                      animation: `pulse 0.8s infinite ${i * 0.1}s alternate` 
                    }}
                  >
                    <div 
                        className="w-full h-full bg-[#00D4FF]" 
                        style={{ animation: `ping 1s cubic-bezier(0, 0, 0.2, 1) infinite ${i * 0.2}s` }}
                    ></div>
                  </div>
                ))}
                <div className="flex items-center gap-1 ml-2 text-xs font-mono text-[#00D4FF]/70">
                   <span className="animate-pulse">数据流传输中...</span>
                </div>
             </div>

             {onCancel && (
               <button 
                 onClick={onCancel}
                 className="px-4 py-1.5 rounded-full border border-red-500/30 text-red-400 text-xs hover:bg-red-500/10 transition-colors"
               >
                 取消任务
               </button>
             )}

        </div>
      </div>
      
      <p className="text-center text-slate-500 text-sm mt-6 font-mono">
        请勿关闭浏览器，大型视频分析可能需要 1-2 分钟...
      </p>
    </div>
  );
};

export default ProcessingVisualizer;
