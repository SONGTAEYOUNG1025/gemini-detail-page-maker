import React, { useRef, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { analyzeForThumbnail, generateThumbnailImage } from '../services/geminiService';

export const ThumbnailMaker: React.FC = () => {
    const { 
        thumbnail, setThumbnailImage, updateThumbnail, skipThumbnail, resetThumbnail,
        setGlobalError, logUsage, logout, checkSession // checkSession added
    } = useAppStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    // Paste Event Handler
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            // Processing 중에는 붙여넣기 방지
            if (thumbnail.status === 'analyzing' || thumbnail.status === 'generating') return;

            const items = e.clipboardData?.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    if (blob) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const result = ev.target?.result as string;
                            setThumbnailImage(result);
                            processThumbnail(result);
                        };
                        reader.readAsDataURL(blob);
                        return; // 첫 번째 이미지만 처리
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [thumbnail.status]); // status 의존성 추가

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        readAndProcessFile(file);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
            readAndProcessFile(file);
        }
    };

    const readAndProcessFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const result = ev.target?.result as string;
            setThumbnailImage(result);
            processThumbnail(result);
        };
        reader.readAsDataURL(file);
    };

    const processThumbnail = async (imageSrc: string) => {
        // [Security] 세션 유효성 검사
        const isSessionValid = await checkSession();
        if (!isSessionValid) return; // 유효하지 않으면 중단 (checkSession 내부에서 로그아웃됨)

        updateThumbnail({ status: 'analyzing', error: undefined });
        try {
            // Step 1: Analyze
            const analysis = await analyzeForThumbnail(imageSrc);
            updateThumbnail({ 
                status: 'generating', 
                analysisReport: analysis.detectionReport, 
                seoTip: analysis.seoTip,
                generationPrompt: analysis.generationPrompt 
            });

            // Step 2: Generate
            if (analysis.generationPrompt) {
                const genImage = await generateThumbnailImage(imageSrc, analysis.generationPrompt);
                updateThumbnail({ status: 'complete', generatedImage: genImage });
                await logUsage();
            } else {
                throw new Error("프롬프트 생성 실패");
            }
        } catch (e: any) {
            const msg = e.message || e.toString();
            if (msg.includes("[AUTH_ERROR]")) {
                alert("🚨 API Key 인증에 실패했습니다.\n\n유효하지 않은 키이거나 만료된 키입니다.\n로그인 화면으로 돌아갑니다.");
                logout();
                return;
            }
            updateThumbnail({ status: 'error', error: msg });
            setGlobalError(msg);
        }
    };

    const handleFlip = () => {
        if (!thumbnail.generatedImage) return;
        
        const img = new Image();
        img.src = thumbnail.generatedImage;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            // 좌우 반전 로직
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
            
            const flippedData = canvas.toDataURL('image/png');
            updateThumbnail({ generatedImage: flippedData });
        };
    };

    const handleDownload = () => {
        if (!thumbnail.generatedImage) return;
        const link = document.createElement('a');
        link.href = thumbnail.generatedImage;
        link.download = `SEO_thumbnail_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="max-w-6xl mx-auto animate-fade-in-up pb-20">
            <div className="text-center mb-10">
                <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">Step 0</span>
                <h2 className="text-3xl font-bold text-slate-800 mt-4">AI 썸네일 메이커 (Gemini 3 Pro)</h2>
                <p className="text-slate-500 mt-2">
                    지저분한 배경, 중국어, 사람 손을 제거하고 <strong className="text-indigo-600">네이버 SEO 최적화 썸네일</strong>을 만듭니다.
                </p>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col lg:flex-row min-h-[500px]">
                
                {/* Left: Input & Analysis */}
                <div className="lg:w-1/2 p-8 border-b lg:border-b-0 lg:border-r border-slate-100 bg-slate-50/50 flex flex-col">
                    
                    {!thumbnail.originalImage ? (
                         <div 
                            className={`flex-1 border-4 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all p-10 text-center focus:outline-none focus:ring-2 focus:ring-indigo-200 ${isDragging ? 'border-indigo-500 bg-indigo-50 scale-[0.99]' : 'border-slate-300 hover:bg-white hover:border-indigo-400'}`}
                            tabIndex={0}
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                         >
                            <div className="text-6xl mb-4 opacity-50">📸</div>
                            <h3 className="text-xl font-bold text-slate-700 mb-2">썸네일 만들 사진 업로드</h3>
                            <p className="text-slate-400 text-sm">여기에 사진을 드래그하거나<br/>클릭 후 붙여넣기(Ctrl+V) 하세요</p>
                            
                            <div className="mt-4 flex flex-col gap-2 items-center">
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="mt-4 bg-slate-800 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-slate-700 transition"
                                >
                                    파일 직접 선택하기
                                </button>
                            </div>
                         </div>
                    ) : (
                        <div className="flex flex-col h-full">
                            <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white mb-6 group">
                                <img src={thumbnail.originalImage} className="w-full max-h-[300px] object-contain" alt="Original" />
                                <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">원본</div>
                                <button onClick={resetThumbnail} className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full hover:bg-red-100 text-red-500 shadow-sm">✕</button>
                            </div>

                            {/* Analysis Console */}
                            <div className="flex-1 bg-slate-900 rounded-xl p-5 text-left font-mono text-sm overflow-y-auto max-h-[250px] shadow-inner text-slate-300">
                                <div className="flex items-center gap-2 mb-3 border-b border-slate-700 pb-2">
                                    <span className="text-green-400">●</span> 
                                    <span className="font-bold text-white">AI Director Console</span>
                                </div>
                                
                                {thumbnail.status === 'analyzing' && (
                                    <div className="animate-pulse space-y-2">
                                        <p>{'>'} 이미지 분석 및 SEO 전략 수립 중...</p>
                                    </div>
                                )}
                                
                                {thumbnail.status === 'generating' && (
                                    <div className="animate-pulse space-y-2">
                                        <p className="text-blue-300">{'>'} 맞춤형 배경 생성 중...</p>
                                    </div>
                                )}

                                {thumbnail.status === 'complete' && (
                                    <div className="space-y-4 animate-fade-in">
                                        <div>
                                            <p className="text-green-400 font-bold mb-1">{'>'} 썸네일 생성 완료!</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                </div>

                {/* Right: Result */}
                <div className="lg:w-1/2 p-8 bg-white flex flex-col items-center justify-center relative">
                    
                    {thumbnail.status === 'idle' && !thumbnail.originalImage && (
                        <div className="text-center text-slate-400">
                            <p>사진을 드래그하거나 선택하면<br/>AI가 썸네일을 제작합니다.</p>
                        </div>
                    )}

                    {(thumbnail.status === 'analyzing' || thumbnail.status === 'generating') && (
                        <div className="text-center">
                            <div className="w-20 h-20 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
                            <h3 className="text-xl font-bold text-slate-800 animate-pulse">
                                {thumbnail.status === 'analyzing' ? '이미지 분석 중...' : '썸네일 생성 중...'}
                            </h3>
                            <p className="text-slate-500 mt-2 text-sm">최대 20초 정도 소요됩니다.</p>
                        </div>
                    )}

                    {thumbnail.status === 'complete' && thumbnail.generatedImage && (
                        <div className="w-full flex flex-col items-center animate-fade-in-up">
                            <div className="relative w-full aspect-square max-w-[450px] shadow-2xl rounded-xl overflow-hidden border border-slate-100 group">
                                <img src={thumbnail.generatedImage} className="w-full h-full object-contain bg-white" alt="Generated Thumbnail" />
                                <div className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold shadow-lg">
                                    SEO 최적화 완료
                                </div>
                            </div>
                            
                            <div className="flex gap-3 mt-8 flex-wrap justify-center">
                                <button 
                                    onClick={handleDownload}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg flex items-center gap-2 transform transition hover:-translate-y-1"
                                >
                                    <span>💾 다운로드</span>
                                </button>
                                <button 
                                    onClick={handleFlip}
                                    className="bg-white border border-slate-300 text-slate-700 px-5 py-3 rounded-xl font-bold hover:bg-slate-50 shadow-sm transition"
                                >
                                    ↔️ 좌우 반전
                                </button>
                                <button 
                                    onClick={skipThumbnail}
                                    className="bg-white border border-slate-300 text-slate-600 px-6 py-3 rounded-xl font-bold hover:bg-slate-50"
                                >
                                    다음 단계로 →
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>

            {/* Skip Link */}
            {!thumbnail.originalImage && (
                 <div className="text-center mt-8">
                    <button onClick={skipThumbnail} className="text-slate-400 underline hover:text-slate-600 text-sm">
                        썸네일 제작 건너뛰기
                    </button>
                 </div>
            )}
        </div>
    );
};