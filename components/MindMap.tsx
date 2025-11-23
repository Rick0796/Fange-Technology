
import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    mermaid: any;
  }
}

interface MindMapProps {
  chart: string;
}

const MindMap: React.FC<MindMapProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [hasError, setHasError] = useState(false);
  const [isGeneratingPng, setIsGeneratingPng] = useState(false);

  useEffect(() => {
    if (containerRef.current && window.mermaid) {
      setHasError(false);
      window.mermaid.initialize({ 
        startOnLoad: true,
        theme: 'dark',
        securityLevel: 'loose',
        fontFamily: 'Inter',
        themeVariables: {
            primaryColor: '#00D4FF',
            primaryTextColor: '#fff',
            primaryBorderColor: '#00D4FF',
            lineColor: '#8B5CF6',
            secondaryColor: '#1e293b',
            tertiaryColor: '#0f172a'
        }
      });
      
      const renderId = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      try {
          // Attempt to render
          window.mermaid.render(renderId, chart).then((result: any) => {
             if(containerRef.current) {
                containerRef.current.innerHTML = result.svg;
                // Add width/height 100% to svg for responsiveness
                const svg = containerRef.current.querySelector('svg');
                if(svg) {
                    svg.style.width = '100%';
                    svg.style.height = '100%';
                    svg.style.maxWidth = '100%';
                }
                setSvgContent(containerRef.current.innerHTML);
             }
          }).catch((e: any) => {
            console.error("Mermaid render error:", e);
            setHasError(true);
            if(containerRef.current) {
              containerRef.current.innerHTML = "<div class='text-red-400 text-sm p-4 text-center'>无法渲染思维导图<br/><span class='text-xs opacity-60'>结构可能过于复杂或包含不支持的字符</span></div>";
            }
          });
      } catch(e) {
          console.error("Mermaid sync error", e);
          setHasError(true);
      }
    }
  }, [chart]);

  const handleDownload = async () => {
     if (!containerRef.current) return;
     const svgElement = containerRef.current.querySelector('svg');
     if (!svgElement) return;

     setIsGeneratingPng(true);

     try {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgElement);
        
        const svgBlob = new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'});
        const url = URL.createObjectURL(svgBlob);
        
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Scale up resolution (2x) for better clarity
            const box = svgElement.viewBox.baseVal;
            const width = box.width || svgElement.getBoundingClientRect().width || 800;
            const height = box.height || svgElement.getBoundingClientRect().height || 600;
            const pixelScale = 2; 

            canvas.width = width * pixelScale;
            canvas.height = height * pixelScale;
            
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#0F0F23'; 
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Trigger Download
                const link = document.createElement('a');
                link.download = `mindmap-${Date.now()}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
            URL.revokeObjectURL(url);
            setIsGeneratingPng(false);
        };
        img.onerror = () => {
            alert("图片生成失败，请尝试截图保存。");
            setIsGeneratingPng(false);
        }
        img.src = url;
     } catch (e) {
         console.error("PNG Conversion failed", e);
         setIsGeneratingPng(false);
     }
  };

  const toggleModal = () => {
    if (hasError || !svgContent) return;
    setIsModalOpen(!isModalOpen);
    setScale(1);
  };

  const handleZoomIn = (e: React.MouseEvent) => { e.stopPropagation(); setScale(prev => Math.min(prev + 0.2, 3)); };
  const handleZoomOut = (e: React.MouseEvent) => { e.stopPropagation(); setScale(prev => Math.max(prev - 0.2, 0.5)); };

  return (
    <>
        {/* Inline Preview */}
        <div className="relative group">
            <div className="w-full overflow-x-auto p-6 glass-panel rounded-xl shadow-lg border border-white/10">
                <div ref={containerRef} className="flex justify-center min-w-[500px]" />
            </div>
            {/* Click hint overlay (Only if no error) */}
            {!hasError && svgContent && (
              <div 
                  onClick={toggleModal}
                  className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors cursor-pointer flex items-center justify-center group"
              >
                  <div className="opacity-0 group-hover:opacity-100 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-sm transition-opacity transform translate-y-2 group-hover:translate-y-0">
                      点击放大查看
                  </div>
              </div>
            )}
        </div>

        {/* Fullscreen Modal */}
        {isModalOpen && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-md animate-fade-in" onClick={toggleModal}>
                {/* Controls */}
                <div className="absolute top-4 right-4 flex gap-2 z-[201]" onClick={e => e.stopPropagation()}>
                    <button onClick={handleDownload} disabled={isGeneratingPng} className="px-4 py-2 bg-[#00D4FF]/10 hover:bg-[#00D4FF]/20 text-[#00D4FF] rounded-lg transition-colors border border-[#00D4FF]/30 flex items-center gap-2 text-sm">
                         {isGeneratingPng ? (
                             <>
                               <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                               保存中...
                             </>
                         ) : (
                             <>
                               <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                               保存图片
                             </>
                         )}
                    </button>
                    <div className="w-px bg-white/10 mx-1"></div>
                    <button onClick={handleZoomOut} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                    </button>
                    <button onClick={handleZoomIn} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors">
                         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </button>
                    <button onClick={toggleModal} className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition-colors ml-2">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Scalable Content - Render SVG Directly */}
                <div 
                    className="w-full h-full overflow-auto flex items-center justify-center p-10 cursor-move"
                    onClick={(e) => e.stopPropagation()} 
                >
                    <div 
                        style={{ 
                            transform: `scale(${scale})`, 
                            transition: 'transform 0.1s ease-out',
                            width: '80%', // Initial size relative to screen
                            minWidth: '600px'
                        }}
                        className="origin-center shadow-2xl rounded-lg bg-[#0F0F23] p-4 border border-white/10"
                        dangerouslySetInnerHTML={{__html: svgContent}}
                    />
                </div>
            </div>
        )}
    </>
  );
};

export default MindMap;
