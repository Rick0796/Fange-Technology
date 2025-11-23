import React, { useRef, useEffect } from 'react';

interface VideoPlayerProps {
  file: File | null;
  seekTo: number | null;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ file, seekTo }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      if (videoRef.current) {
        videoRef.current.src = url;
        videoRef.current.load();
      }
    }
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }
    };
  }, [file]);

  useEffect(() => {
    if (seekTo !== null && videoRef.current) {
      videoRef.current.currentTime = seekTo;
      videoRef.current.play().catch(e => console.log("Auto-play prevented", e));
    }
  }, [seekTo]);

  if (!file) return <div className="bg-black/50 border border-white/10 w-full aspect-video rounded-xl flex items-center justify-center text-slate-400">请选择视频</div>;

  return (
    <video 
      ref={videoRef} 
      className="w-full rounded-xl shadow-2xl bg-black aspect-video border border-white/10" 
      controls 
    />
  );
};

export default VideoPlayer;