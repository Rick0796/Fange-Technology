
import React, { useState, useEffect, useRef } from 'react';
import { AnalysisResult, AnalysisStatus, KeyTakeaway, HistoryItem, AnalysisMode } from './types';
import { analyzeVideoContent } from './services/geminiService';
import VideoPlayer from './components/VideoPlayer';
import MindMap from './components/MindMap';
import ChatInterface from './components/ChatInterface';
import ProcessingVisualizer from './components/ProcessingVisualizer';
import ParticleBackground from './components/ParticleBackground';

// Toast Notification Component
const Toast: React.FC<{ message: string; type: 'success' | 'error' | 'info'; onClose: () => void }> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: 'bg-green-500/10 border-green-500/50 text-green-400',
    error: 'bg-red-500/10 border-red-500/50 text-red-400',
    info: 'bg-[#00D4FF]/10 border-[#00D4FF]/50 text-[#00D4FF]'
  };

  return (
    <div className={`fixed top-24 right-6 z-[200] px-6 py-3 rounded-xl border backdrop-blur-md shadow-2xl animate-fade-in-up flex items-center gap-3 ${colors[type]}`}>
      {type === 'info' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      {type === 'error' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      {type === 'success' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
      <span className="font-medium">{message}</span>
    </div>
  );
};

// Modal for details
const DetailModal: React.FC<{ item: KeyTakeaway | null; onClose: () => void }> = ({ item, onClose }) => {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-[#1e293b] border border-white/10 max-w-lg w-full rounded-xl p-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <h3 className="text-xl font-bold text-white mb-4 border-b border-white/10 pb-2 text-[#00D4FF]">{item.point}</h3>
        <p className="text-slate-300 leading-relaxed text-sm">
          {item.detail || "暂无详细内容。"}
        </p>
        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-[#00D4FF]/10 text-[#00D4FF] hover:bg-[#00D4FF] hover:text-black rounded text-sm transition-colors">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

// Feature Card Component
const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; desc: string }> = ({ icon, title, desc }) => (
  <div className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-[#00D4FF]/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(0,212,255,0.1)] group">
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#00D4FF]/20 to-[#8B5CF6]/20 flex items-center justify-center mb-4 text-[#00D4FF] group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
    <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
  </div>
);

// Clean Card Component (For Results)
const GlassCard: React.FC<{ children: React.ReactNode; title?: string; className?: string }> = ({ children, title, className = "" }) => (
  <div className={`glass-panel rounded-xl p-6 ${className}`}>
    {title && <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
      <span className="w-1 h-4 bg-[#00D4FF] rounded-full"></span>
      {title}
    </h3>}
    {children}
  </div>
);

const App: React.FC = () => {
  // Safe environment variable access
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return process.env.API_KEY || '';
    } catch (e) {
      return '';
    }
  });
  
  const [status, setStatus] = useState<AnalysisStatus>(AnalysisStatus.IDLE);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Progress State
  const [progress, setProgress] = useState(0);
  const [visualStatus, setVisualStatus] = useState<'UPLOADING' | 'ANALYZING' | 'GENERATING'>('UPLOADING');
  
  // UI State for Background Processing
  const [isBackgroundMode, setIsBackgroundMode] = useState(false);

  // Detail Modal State
  const [selectedTakeaway, setSelectedTakeaway] = useState<KeyTakeaway | null>(null);

  // History & Mode State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('FAST');

  // Notifications
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load History from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('learnsnap_history_v1');
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to load history", e);
    }
    
    // Check API Key on mount and warn if missing
    if (!apiKey) {
      // Small delay to ensure UI is ready
      setTimeout(() => {
        setNotification({ 
          message: "⚠️ 未检测到 API Key，请在 Vercel 环境变量中配置 API_KEY", 
          type: 'info' 
        });
      }, 1000);
    }
  }, []);

  // When task completes, exit background mode automatically to show results
  useEffect(() => {
    if (status === AnalysisStatus.COMPLETED) {
      setIsBackgroundMode(false);
    }
  }, [status]);

  const validateAndSetFile = (f: File) => {
    // If a task is running, don't allow new file immediately unless reset
    if (status === AnalysisStatus.UPLOADING || status === AnalysisStatus.ANALYZING) {
        setNotification({ message: "当前有任务正在进行中，请等待完成或取消。", type: 'error' });
        return;
    }

    if (f.size > 2 * 1024 * 1024 * 1024) {
      setNotification({ message: "文件过大 (Max 2GB)", type: 'error' });
      return;
    }
    // Simple video type check
    if (!f.type.startsWith('video/')) {
      setNotification({ message: "请上传视频文件", type: 'error' });
      return;
    }
    setFile(f);
    setError(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      validateAndSetFile(event.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (status !== AnalysisStatus.IDLE && status !== AnalysisStatus.COMPLETED && status !== AnalysisStatus.ERROR) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleLogoClick = () => {
    // If working, go to background mode (home screen)
    if (status === AnalysisStatus.UPLOADING || status === AnalysisStatus.ANALYZING) {
        setIsBackgroundMode(true);
    } else {
        // Otherwise reset to idle
        reset();
    }
  };

  const startAnalysis = async (mode: AnalysisMode) => {
    if (!file) {
      setNotification({ message: "请先上传视频文件", type: 'error' });
      return;
    }
    
    if (!apiKey) {
      setNotification({ 
        message: "配置错误：未找到 Gemini API Key。请检查 Vercel 环境变量。", 
        type: 'error' 
      });
      return;
    }
    
    // Set Mode
    setAnalysisMode(mode);
    setStatus(AnalysisStatus.UPLOADING);
    setProgress(0);
    setIsBackgroundMode(false); // Ensure we see the visualizer initially
    
    // Setup AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await analyzeVideoContent(
        file, 
        apiKey, 
        mode, 
        (stage, percent) => {
          if (stage === 'uploading') setVisualStatus('UPLOADING');
          if (stage === 'analyzing') setVisualStatus('ANALYZING');
          if (stage === 'generating') setVisualStatus('GENERATING');
          
          if (percent !== undefined) {
             setProgress(percent);
          }
        },
        controller.signal
      );
      
      setResult(data);
      setProgress(100);
      
      // Save to History
      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        fileName: file.name,
        result: data,
        mode: mode
      };
      
      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      localStorage.setItem('learnsnap_history_v1', JSON.stringify(updatedHistory));

      setTimeout(() => setStatus(AnalysisStatus.COMPLETED), 800);
    } catch (e: any) {
      if (e.message === "取消操作") {
          setNotification({ message: "任务已取消", type: 'info' });
          reset();
      } else {
          setError(e.message);
          setStatus(AnalysisStatus.ERROR);
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const cancelAnalysis = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          // The error handler in startAnalysis will catch the abort and call reset + notification
      }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setResult(item.result);
    setFile(null); 
    setAnalysisMode(item.mode);
    setStatus(AnalysisStatus.COMPLETED);
    setShowHistory(false);
    setIsBackgroundMode(false);
  };

  const clearHistory = () => {
    if(confirm("确定要清空所有历史记录吗？")) {
      setHistory([]);
      localStorage.removeItem('learnsnap_history_v1');
    }
  }

  const reset = () => {
    setStatus(AnalysisStatus.IDLE);
    setFile(null);
    setResult(null);
    setProgress(0);
    setIsBackgroundMode(false);
    abortControllerRef.current = null;
  };

  // Determine if we should show the landing page (Idle or Backgrounded)
  const showLanding = status === AnalysisStatus.IDLE || isBackgroundMode;

  return (
    <div className="min-h-screen bg-[#0F0F23] text-white font-inter selection:bg-[#00D4FF] selection:text-black flex flex-col relative overflow-x-hidden">
      
      {/* Background Effect */}
      {status !== AnalysisStatus.COMPLETED && status !== AnalysisStatus.ERROR && <ParticleBackground />}

      {/* Notifications */}
      {notification && (
        <Toast 
            message={notification.message} 
            type={notification.type} 
            onClose={() => setNotification(null)} 
        />
      )}

      {/* History Overlay (Click outside to close) */}
      {showHistory && (
        <div 
            className="fixed inset-0 bg-black/50 z-[90] backdrop-blur-sm transition-opacity animate-fade-in" 
            onClick={() => setShowHistory(false)}
        ></div>
      )}

      {/* History Sidebar */}
      <div className={`fixed inset-y-0 right-0 w-80 bg-[#0F0F23]/95 backdrop-blur-xl border-l border-white/10 shadow-2xl transform transition-transform duration-300 z-[100] ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
         <div className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                 <svg className="w-5 h-5 text-[#00D4FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                 历史记录
               </h3>
               <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-white">
                 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin">
               {history.length === 0 ? (
                 <div className="text-center text-slate-500 mt-10 text-sm">暂无历史记录</div>
               ) : (
                 history.map(item => (
                   <div key={item.id} onClick={() => loadHistoryItem(item)} className="p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-[#00D4FF]/30 cursor-pointer group transition-all">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[10px] text-slate-500 font-mono">{item.date}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${item.mode === 'DEEP' ? 'border-purple-500/30 text-purple-400' : 'border-[#00D4FF]/30 text-[#00D4FF]'}`}>
                          {item.mode === 'DEEP' ? '深度' : '极速'}
                        </span>
                      </div>
                      <div className="text-sm text-slate-200 font-medium truncate group-hover:text-white">{item.fileName}</div>
                   </div>
                 ))
               )}
            </div>

            {history.length > 0 && (
              <button onClick={clearHistory} className="mt-4 w-full py-2 text-xs text-red-400 hover:text-red-300 border border-red-500/20 hover:bg-red-500/10 rounded transition-colors">
                清空记录
              </button>
            )}
         </div>
      </div>

      {/* Header */}
      <header className="fixed w-full top-0 z-50 border-b border-white/5 bg-[#0F0F23]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={handleLogoClick}>
             <span className="font-bold text-2xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[#00D4FF] to-[#8B5CF6]">
               凡哥科技
             </span>
          </div>
          <div className="flex items-center gap-4">
            {/* Show "Back to Workbench" button if task is running in background */}
            {isBackgroundMode && (status === AnalysisStatus.UPLOADING || status === AnalysisStatus.ANALYZING) && (
               <button 
                  onClick={() => setIsBackgroundMode(false)}
                  className="px-4 py-2 rounded-full bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/30 hover:bg-[#00D4FF]/20 flex items-center gap-2 text-sm animate-pulse transition-all"
               >
                  <span className="w-2 h-2 rounded-full bg-[#00D4FF]"></span>
                  回到工作台
               </button>
            )}

            <button 
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 hover:bg-white/5 transition-all text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              历史记录
            </button>
            <button className="px-6 py-2 rounded-full border border-[#8B5CF6]/50 text-[#8B5CF6] hover:bg-[#8B5CF6]/10 hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all text-sm font-medium">
              登录
            </button>
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div className="h-20"></div>

      <main className="flex-grow flex flex-col relative z-10 min-h-[calc(100vh-160px)]">
        
        {/* === LANDING PAGE (Shown when IDLE or BACKGROUNDED) === */}
        {showLanding && (
          <div className="flex-grow flex flex-col justify-center max-w-7xl mx-auto w-full px-6 py-12">
            
            {/* Hero Section */}
            <div className="text-center mb-16 animate-fade-in">
              <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
                视频内容<br/>
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#00D4FF] to-[#8B5CF6]">一键转为可视化笔记</span>
              </h1>
              <p className="text-slate-400 text-lg md:text-xl max-w-3xl mx-auto whitespace-nowrap overflow-hidden text-ellipsis">
                上传长视频，自动生成图文摘要、思维导图与精华片段。
              </p>
            </div>

            {/* Upload & Mode Selection Section */}
            <div className="max-w-3xl mx-auto w-full mb-20 animate-fade-in-up">
               {isBackgroundMode && (status === AnalysisStatus.UPLOADING || status === AnalysisStatus.ANALYZING) ? (
                 /* Background Mode Active Card */
                 <div 
                   className="relative flex flex-col items-center justify-center w-full h-64 rounded-3xl border border-[#00D4FF]/50 bg-[#00D4FF]/5 transition-all shadow-[0_0_30px_rgba(0,212,255,0.1)] group"
                 >
                    <div className="w-16 h-16 rounded-full bg-[#00D4FF]/20 flex items-center justify-center mb-4 text-[#00D4FF] animate-bounce">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                    </div>
                    <p className="text-[#00D4FF] font-bold text-lg mb-2">任务正在后台运行中...</p>
                    
                    <div className="flex gap-4 mt-4">
                        <button 
                            onClick={() => setIsBackgroundMode(false)}
                            className="px-6 py-2 bg-[#00D4FF]/10 hover:bg-[#00D4FF]/20 text-[#00D4FF] rounded-full border border-[#00D4FF]/30 transition-colors"
                        >
                            查看进度
                        </button>
                        <button 
                            onClick={cancelAnalysis}
                            className="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-full border border-red-500/30 transition-colors"
                        >
                            取消任务
                        </button>
                    </div>
                 </div>
               ) : (
                 /* Normal Upload Card */
                 <label 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`
                    relative flex flex-col items-center justify-center w-full h-64 
                    rounded-3xl border-2 border-dashed transition-all cursor-pointer group overflow-hidden mb-8
                    ${isDragging ? 'border-[#00D4FF] bg-[#00D4FF]/10 scale-[1.02]' : ''}
                    ${file 
                      ? 'border-[#00D4FF] bg-[#00D4FF]/5 shadow-[0_0_30px_rgba(0,212,255,0.1)]' 
                      : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-[#00D4FF]/50 hover:shadow-[0_0_20px_rgba(0,212,255,0.1)]'
                    }
                 `}>
                    <div className="absolute inset-0 bg-gradient-to-br from-[#00D4FF]/5 to-[#8B5CF6]/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    
                    <div className="flex flex-col items-center justify-center pt-5 pb-6 relative z-10 pointer-events-none">
                       {file ? (
                         <>
                           <div className="w-16 h-16 rounded-full bg-[#00D4FF]/20 flex items-center justify-center mb-4 text-[#00D4FF]">
                              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                           </div>
                           <p className="text-white font-medium text-lg">{file.name}</p>
                           <p className="text-slate-400 text-sm mt-2">请在下方选择一种分析模式</p>
                         </>
                       ) : (
                         <>
                           <div className={`w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 text-slate-400 group-hover:text-[#00D4FF] group-hover:scale-110 transition-all ${isDragging ? 'scale-110 text-[#00D4FF] bg-[#00D4FF]/20' : ''}`}>
                              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                           </div>
                           <p className="mb-2 text-lg text-white font-medium">{isDragging ? '释放以添加视频' : '拖放视频文件到这里'}</p>
                           <p className="text-sm text-slate-400">支持 MP4, MOV, AVI 格式，最大 2GB</p>
                         </>
                       )}
                    </div>
                    <input type="file" className="hidden" accept="video/*" onChange={handleFileChange} />
                 </label>
               )}
               
               {file && !isBackgroundMode && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up">
                   {/* Fast Mode Button */}
                   <button 
                     onClick={() => startAnalysis('FAST')}
                     className="relative overflow-hidden group p-6 rounded-2xl border border-[#00D4FF]/30 bg-[#00D4FF]/5 hover:bg-[#00D4FF]/10 hover:border-[#00D4FF] transition-all text-left"
                   >
                     <div className="absolute inset-0 bg-gradient-to-r from-[#00D4FF]/0 to-[#00D4FF]/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                     <div className="flex items-center gap-4 mb-2">
                       <div className="w-10 h-10 rounded-full bg-[#00D4FF]/20 flex items-center justify-center text-[#00D4FF]">
                         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                       </div>
                       <h3 className="text-xl font-bold text-white">快速分析</h3>
                     </div>
                     <p className="text-slate-400 text-sm">极速生成核心摘要，不包含时间轴与图谱，专注于最快速度。</p>
                   </button>

                   {/* Deep Mode Button */}
                   <button 
                     onClick={() => startAnalysis('DEEP')}
                     className="relative overflow-hidden group p-6 rounded-2xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/5 hover:bg-[#8B5CF6]/10 hover:border-[#8B5CF6] transition-all text-left"
                   >
                     <div className="absolute inset-0 bg-gradient-to-r from-[#8B5CF6]/0 to-[#8B5CF6]/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                     <div className="flex items-center gap-4 mb-2">
                       <div className="w-10 h-10 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center text-[#8B5CF6]">
                         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                       </div>
                       <h3 className="text-xl font-bold text-white">深度分析</h3>
                     </div>
                     <p className="text-slate-400 text-sm">启用 AI 深度思考，生成包含思维导图和时间轴的完整报告。</p>
                   </button>
                 </div>
               )}
            </div>

            {/* Feature Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in-up delay-100">
               <FeatureCard 
                 icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                 title="自动提取核心要点"
                 desc="基于 Gemini 2.5 多模态大模型，精准识别视频中的关键信息，去除冗余废话。"
               />
               <FeatureCard 
                 icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
                 title="生成图文摘要"
                 desc="将长达数小时的视频内容浓缩为几百字的精华摘要，配合思维导图一目了然。"
               />
               <FeatureCard 
                 icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                 title="智能对话问答"
                 desc="遇到不懂的内容？直接向 AI 助教提问，它会根据视频内容给出最准确的解答。"
               />
            </div>

          </div>
        )}

        {/* === PROCESSING STATE (Only shown if NOT backgrounded) === */}
        {!isBackgroundMode && (status === AnalysisStatus.UPLOADING || status === AnalysisStatus.ANALYZING) && (
          <div className="flex-grow flex items-center justify-center py-10 w-full animate-fade-in">
             <ProcessingVisualizer status={visualStatus} progress={progress} onCancel={cancelAnalysis} />
          </div>
        )}

        {/* === ERROR STATE === */}
        {status === AnalysisStatus.ERROR && (
           <div className="flex-grow flex items-center justify-center">
             <div className="text-center p-8 glass-panel rounded-xl border-red-500/50 max-w-md">
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 text-red-500">
                   <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div className="text-red-400 text-xl font-bold mb-2">分析遇到错误</div>
                <div className="text-slate-400 mb-6 text-sm">{error}</div>
                <button onClick={reset} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">重试</button>
             </div>
           </div>
        )}

        {/* === RESULTS PAGE === */}
        {status === AnalysisStatus.COMPLETED && result && (
          <div className="max-w-7xl mx-auto px-6 py-8 w-full animate-fade-in pb-20">
             
             {/* Top Info */}
             <div className="flex justify-between items-center mb-8">
                <div>
                   <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                     {file ? file.name : (history.find(h => h.result === result)?.fileName || "历史记录")}
                     <span className="px-2 py-0.5 rounded text-[10px] bg-[#00D4FF]/10 text-[#00D4FF] border border-[#00D4FF]/20 uppercase">智能分析完成</span>
                   </h2>
                   <div className="flex gap-2 text-xs text-slate-400">
                     <span>{new Date().toLocaleDateString()}</span>
                     <span>•</span>
                     <span>凡哥科技 AI 引擎 ({analysisMode === 'DEEP' ? '深度模式' : '极速模式'})</span>
                   </div>
                </div>
                <button onClick={reset} className="text-sm text-slate-400 hover:text-white flex items-center gap-1 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  开始新任务
                </button>
             </div>

             <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* Left Column: Player & Chat */}
                <div className="lg:col-span-7 space-y-6">
                   <div className="rounded-xl overflow-hidden shadow-2xl bg-black border border-white/10">
                      <VideoPlayer file={file} seekTo={seekTo} />
                   </div>
                   
                   {/* TIMELINE (DEEP MODE ONLY) */}
                   {analysisMode === 'DEEP' && result.timestamps && result.timestamps.length > 0 && (
                     <GlassCard title="时间轴节点">
                        <div className="flex flex-wrap gap-2">
                           {result.timestamps.map((ts, i) => (
                             <button 
                               key={i} 
                               onClick={() => setSeekTo(ts.seconds)}
                               className="px-3 py-1.5 bg-white/5 hover:bg-[#00D4FF]/20 border border-white/10 hover:border-[#00D4FF]/50 rounded-lg text-xs transition-all text-slate-300 hover:text-white flex items-center gap-2"
                             >
                                <span className="font-mono text-[#00D4FF]">{ts.time}</span>
                                <span>{ts.description}</span>
                             </button>
                           ))}
                        </div>
                     </GlassCard>
                   )}

                   {/* CHAT (DEEP MODE ONLY) */}
                   {analysisMode === 'DEEP' && (
                     <div className="h-[500px] rounded-xl overflow-hidden border border-white/10">
                        {file ? (
                          <ChatInterface videoFile={file!} apiKey={apiKey} fileUri={result.fileUri} />
                        ) : (
                          <div className="w-full h-full bg-[#0A0A1F] flex items-center justify-center text-slate-500 text-sm flex-col gap-2">
                             <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                             <span>历史记录模式下暂不支持 AI 对话</span>
                          </div>
                        )}
                     </div>
                   )}
                </div>

                {/* Right Column: Knowledge */}
                <div className="lg:col-span-5 space-y-6">
                   
                   <GlassCard title="核心摘要">
                      <p className="text-slate-300 text-sm leading-7 text-justify">{result.summary}</p>
                   </GlassCard>

                   {/* MINDMAP (DEEP MODE ONLY) */}
                   {analysisMode === 'DEEP' && (
                     <GlassCard title="知识图谱">
                        <MindMap chart={result.mindMapMermaid} />
                     </GlassCard>
                   )}

                   <GlassCard title="重点内容 (点击查看详情)">
                      <div className="space-y-3">
                         {result.keyTakeaways.map((item, i) => (
                           <div 
                             key={i} 
                             onClick={() => setSelectedTakeaway(item)}
                             className="p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-[#00D4FF]/30 cursor-pointer transition-all group"
                           >
                              <div className="flex items-start gap-3">
                                 <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D4FF]/10 text-[#00D4FF] flex items-center justify-center text-xs font-bold mt-0.5">{i+1}</span>
                                 <div>
                                   <p className="text-sm font-medium text-slate-200 group-hover:text-white">{item.point}</p>
                                   <p className="text-xs text-slate-500 mt-1 truncate group-hover:text-slate-400">点击查看详细解析...</p>
                                 </div>
                              </div>
                           </div>
                         ))}
                      </div>
                   </GlassCard>

                   <div className="p-6 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20">
                      <h3 className="text-indigo-400 font-bold mb-3 text-sm flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        行动建议
                      </h3>
                      <ul className="space-y-2">
                         {result.actionItems.map((action, i) => (
                           <li key={i} className="text-xs text-slate-300 flex gap-2">
                             <span className="text-indigo-500">•</span> {action}
                           </li>
                         ))}
                      </ul>
                   </div>

                </div>
             </div>
          </div>
        )}

        {/* Detail Modal */}
        {selectedTakeaway && (
           <DetailModal item={selectedTakeaway} onClose={() => setSelectedTakeaway(null)} />
        )}

      </main>

      {/* Footer */}
      <footer className="w-full border-t border-white/5 bg-[#0F0F23] py-4 relative z-20 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex flex-col items-center gap-4">
          
          {/* Social Icons (International) */}
          <div className="flex gap-8">
             {/* Facebook */}
             <div className="group cursor-pointer">
               <div className="w-8 h-8 flex items-center justify-center text-slate-600 transition-colors group-hover:text-[#1877F2]">
                 <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.15 5.96C15.21 5.96 16.12 6.04 16.38 6.08V8.7H14.85C13.64 8.7 13.4 9.27 13.4 10.09V12.06H16.34L15.86 14.96H13.4V21.96C18.19 21.21 21.85 17.06 21.85 12.06C21.85 6.53 17.35 2.04 12 2.04Z" />
                 </svg>
               </div>
             </div>

             {/* Instagram */}
             <div className="group cursor-pointer">
               <div className="w-8 h-8 flex items-center justify-center text-slate-600 transition-colors group-hover:text-[#E1306C]">
                 <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M7.8,2H16.2C19.4,2 22,4.6 22,7.8V16.2A5.8,5.8 0 0,1 16.2,22H7.8C4.6,22 2,19.4 2,16.2V7.8A5.8,5.8 0 0,1 7.8,2M7.6,4A3.6,3.6 0 0,0 4,7.6V16.4C4,18.39 5.61,20 7.6,20H16.4A3.6,3.6 0 0,0 20,16.4V7.6C20,5.61 18.39,4 16.4,4H7.6M17.25,5.5A1.25,1.25 0 0,1 18.5,6.75A1.25,1.25 0 0,1 17.25,8A1.25,1.25 0 0,1 16,6.75A1.25,1.25 0 0,1 17.25,5.5M12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9Z" />
                 </svg>
               </div>
             </div>

             {/* Telegram */}
             <div className="group cursor-pointer">
               <div className="w-8 h-8 flex items-center justify-center text-slate-600 transition-colors group-hover:text-[#26A5E4]">
                 <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                   <path d="M9.78,18.65L10.06,14.42L17.74,7.5C18.08,7.19 17.67,7.04 17.22,7.31L7.74,13.3L3.64,12C2.76,11.75 2.75,11.14 3.84,10.7L19.81,4.54C20.54,4.21 21.24,4.72 20.96,5.84L18.24,18.65C18.05,19.56 17.5,19.78 16.74,19.36L12.6,16.3L10.61,18.23C10.38,18.46 10.19,18.65 9.78,18.65Z" />
                 </svg>
               </div>
             </div>
          </div>

          <p className="text-slate-500 text-xs tracking-wider">
             Version 1.0.7-test1 | © 2025 Fange Technology. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
