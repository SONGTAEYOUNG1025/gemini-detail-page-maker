import React from 'react';
import { useAppStore } from '../store/useAppStore';

export const LoadingOverlay: React.FC = () => {
  const { status, loadingProgress, loadingMessage } = useAppStore();

  // Only show overlay for image analysis. 
  // For planning, we now use a streaming UI on the board itself.
  if (status !== 'analyzing') return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm transition-opacity duration-300">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center border border-slate-200 animate-fade-in-up">
        <div className="mb-6 relative">
          <div className="text-6xl mb-4 animate-bounce">
            🔍
          </div>
          <h2 className="text-2xl font-bold text-slate-800">
            이미지 분석 중...
          </h2>
          <p className="text-slate-500 mt-2 text-sm font-medium animate-pulse">{loadingMessage}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-100 rounded-full h-5 mb-2 overflow-hidden border border-slate-200 shadow-inner">
          <div 
            className="bg-gradient-to-r from-primary-500 to-indigo-600 h-full transition-all duration-300 ease-out relative flex items-center justify-end pr-2"
            style={{ width: `${loadingProgress}%` }}
          >
             <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
          </div>
        </div>
        <div className="flex justify-between text-xs text-slate-400 font-semibold px-1">
          <span>AI Processing</span>
          <span className="text-primary-600">{loadingProgress}%</span>
        </div>
        
        <div className="mt-6 text-xs text-slate-400 bg-slate-50 p-3 rounded-lg border border-slate-100">
            이미지가 많을 경우 최대 30초 정도 소요됩니다.
        </div>
      </div>
    </div>
  );
};