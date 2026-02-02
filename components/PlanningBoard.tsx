import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';

// Utility for saving files
const saveAs = (blob: Blob | string, name: string) => {
  const link = document.createElement('a');
  if (typeof blob === 'string') {
    link.href = blob;
  } else {
    link.href = URL.createObjectURL(blob);
  }
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof blob !== 'string') {
    URL.revokeObjectURL(link.href);
  }
};

export const PlanningBoard: React.FC = () => {
  const { plan, status } = useAppStore();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!plan) return null;

  return (
    <div id="planning-board" className="max-w-3xl mx-auto animate-fade-in-up pb-20 relative">
      <div className="flex justify-between items-end mb-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <span className="bg-slate-800 text-white w-8 h-8 flex items-center justify-center rounded-full text-sm">2</span>
                한국어 상세페이지 완성본
            </h2>
            <p className="text-sm text-slate-500 mt-1 ml-10">
                AI가 중국어를 지우고 한국어로 카피라이팅을 입혔습니다.
            </p>
        </div>
      </div>

      {/* The "Long Page" Container */}
      <div className="bg-white shadow-2xl overflow-hidden border border-slate-200">
        
        {/* Header */}
        <div className="bg-slate-900 p-4 text-center text-white flex justify-between items-center">
            <div>
              <p className="text-yellow-400 font-bold tracking-wider text-[10px] uppercase mb-0.5">
                 FINISHED DETAIL PAGE
              </p>
              <h3 className="text-lg font-bold">
                 {plan.title}
              </h3>
            </div>
            {status !== 'planning' && plan.sections && plan.sections.length > 0 && (
                 <button 
                   onClick={() => alert("브라우저 인쇄(Ctrl+P) 기능을 이용해 PDF로 저장하거나, 각 이미지를 다운로드하세요.")}
                   className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded transition-colors"
                 >
                   전체 저장 가이드
                 </button>
            )}
        </div>

        {/* Stitched Images Area - No Gap, Flex Column */}
        <div className="bg-slate-50 flex flex-col items-center w-full">
          
          {plan.sections?.map((section, idx) => {
            // Prefer generated image (translated), fallback to original
            const displayImage = section.generatedImage || section.originalImage;
            const isGenerated = !!section.generatedImage && section.generatedImage !== section.originalImage;

            return (
            <div key={section.id} className="relative w-full max-w-[800px] group leading-[0]">
               
               {/* Display Image */}
               {displayImage ? (
                   <img 
                       src={displayImage} 
                       alt={`Section ${idx + 1}`} 
                       className="w-full h-auto block" // 'block' is crucial to remove descender space
                       style={{ display: 'block', verticalAlign: 'bottom' }} 
                       onClick={() => setPreviewImage(displayImage)}
                   />
               ) : (
                   <div className="w-full h-64 bg-slate-200 animate-pulse flex items-center justify-center">
                       <span className="text-slate-400 font-bold">이미지 번역 중...</span>
                   </div>
               )}

               {/* Indicators & Tools (Hidden by default, show on hover) */}
               <div className="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2 z-10">
                   {isGenerated && (
                       <span className="text-[10px] bg-green-500 text-white px-2 py-1 rounded shadow">
                           번역 완료
                       </span>
                   )}
                   <button 
                       onClick={(e) => {
                           e.stopPropagation();
                           if(displayImage) saveAs(displayImage, `translated_section_${idx+1}.png`);
                       }}
                       className="bg-white text-slate-800 p-2 rounded shadow-lg hover:bg-slate-100 border border-slate-200"
                       title="이미지 다운로드"
                   >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                       </svg>
                   </button>
               </div>
               
               {/* Original View Toggle (Optional feature for user to check) */}
               {isGenerated && (
                   <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm cursor-help" title="원본 이미지 비교">
                            원본 비교 (Hover)
                        </div>
                        {/* Simple tooltip implementation or toggle could go here, for now just a label */}
                   </div>
               )}

            </div>
            );
          })}

          {status === 'planning' && (
            <div className="w-full max-w-[800px] bg-slate-100 h-96 animate-pulse flex flex-col items-center justify-center text-slate-400 border-t border-slate-200">
               <div className="w-12 h-12 border-4 border-slate-400 border-t-transparent rounded-full animate-spin mb-4"></div>
               <p className="font-medium">다음 섹션 번역 및 합성 중...</p>
               <p className="text-xs mt-2 opacity-70">AI가 중국어를 지우고 있습니다</p>
            </div>
          )}

          {status !== 'planning' && (!plan.sections || plan.sections.length === 0) && (
            <div className="p-20 text-center text-slate-400">
              생성된 페이지가 없습니다.
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="bg-slate-100 p-4 text-center text-slate-400 text-xs border-t border-slate-200">
            Powered by V3 Image Editing
        </div>
      </div>
      
      {/* Full Screen Preview */}
      {previewImage && (
        <div 
            className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 cursor-zoom-out animate-fade-in"
            onClick={() => setPreviewImage(null)}
        >
            <div className="relative max-w-7xl max-h-[90vh] w-full flex items-center justify-center">
                <img 
                    src={previewImage} 
                    alt="Full Preview" 
                    className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain"
                />
            </div>
        </div>
      )}
    </div>
  );
};