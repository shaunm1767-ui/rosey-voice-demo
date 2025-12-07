import React from 'react';

interface VoiceVisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1
}

export const VoiceVisualizer: React.FC<VoiceVisualizerProps> = ({ isActive, volume }) => {
  const baseSize = 100;
  const scale = isActive ? 1 + volume * 1.5 : 1;
  
  return (
    <div className="relative flex items-center justify-center h-48 w-48">
      {/* Outer Glow */}
      <div 
        className={`absolute rounded-full bg-rose-200 opacity-50 transition-all duration-75 ease-out`}
        style={{
          width: `${baseSize * 1.5}px`,
          height: `${baseSize * 1.5}px`,
          transform: `scale(${isActive ? 1 + volume : 0.8})`,
        }}
      />
      
      {/* Core */}
      <div 
        className={`relative z-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-100 ease-linear ${isActive ? 'bg-rose-500' : 'bg-gray-400'}`}
        style={{
          width: `${baseSize}px`,
          height: `${baseSize}px`,
          transform: `scale(${scale})`,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
    </div>
  );
};