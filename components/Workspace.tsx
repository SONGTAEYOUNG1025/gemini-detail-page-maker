import React, { useEffect, useState, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { analyzeImageForCopywriting, applyCopywritingToImage, swapFaceInImage, editImagePartially } from '../services/geminiService';
import { WorkItem } from '../types';
import JSZip from 'jszip';

// Local implementation of saveAs to avoid ESM import errors with file-saver
const saveAs = (blob: Blob, name: string) => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

export const Workspace: React.FC = () => {
  const { 
    items, addItem, updateItem, updateMultipleItems, removeItem, clearAllItems,
    referenceImage, setReferenceImage, isReferenceSkipped, skipReference,
    marketName, setMarketName,
    setItemOptions, setItemSelectedOption, updateItemOptionText,
    logUsage, logout, checkSession, // checkSession added
    globalError, setGlobalError,
    // startNewProject removed
    usedCaptions,
    addUsedCaptions
  } = useAppStore();
  
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Download sequence counter
  const downloadSequenceRef = useRef(1);

  // Edit State (Tracked by Item ID and Index)
  const [editingState, setEditingState] = useState<{itemId: string, index: number, value: string} | null>(null);

  // Staging State for Reference Images
  const [stagedRefImages, setStagedRefImages] = useState<string[]>([]);
  const [isStitching, setIsStitching] = useState(false);

  // Local state for immediate button feedback
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  // State for Zip Download
  const [isZipping, setIsZipping] = useState(false);

  // --- Magic Repair State ---
  const [activeEditItem, setActiveEditItem] = useState<string | null>(null); // ID of item being edited
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{x: number, y: number} | null>(null);
  const [currentPos, setCurrentPos] = useState<{x: number, y: number} | null>(null);
  const [finalBox, setFinalBox] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [repairPrompt, setRepairPrompt] = useState("");
  const [isRepairing, setIsRepairing] = useState(false);
  
  // References for Magic Repair
  const imageRefs = useRef<{[key: string]: HTMLImageElement | null}>({});

  // --- Auth Error Handler ---
  const handleServiceError = (e: any, itemId?: string) => {
      const msg = e.message || e.toString();
      if (msg.includes("[AUTH_ERROR]")) {
          alert("🚨 API Key 인증에 실패했습니다.\n\n유효하지 않은 키이거나 만료된 키입니다.\n로그인 화면으로 돌아갑니다.");
          logout();
          return;
      }
      if (itemId) {
          updateItem(itemId, { status: 'error', error: msg });
      } else {
          setGlobalError(msg);
      }
  };

  // --- Helpers ---

  const stitchImages = async (images: string[]): Promise<string> => {
    if (images.length === 0) return "";
    
    // 1. Filter out potentially corrupt strings initially
    const validSrcs = images.filter(src => src && src.length > 100 && !src.includes('data:,'));
    if (validSrcs.length === 0) return "";

    // 2. Robust Image Loading: Load all, ignore failures
    const loadPromises = validSrcs.map(src => {
        return new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => {
                console.warn("Failed to load reference image chunk. Skipping.");
                resolve(null); // Resolve null to skip this image
            };
            img.src = src;
        });
    });

    // 15 second timeout safety
    const timeoutPromise = new Promise<HTMLImageElement[]>((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), 15000)
    );

    let validElements: HTMLImageElement[] = [];
    try {
        const results = await Promise.race([Promise.all(loadPromises), timeoutPromise]) as (HTMLImageElement | null)[];
        validElements = results.filter(img => img !== null) as HTMLImageElement[];
    } catch (e) {
        console.error("Stitching timed out");
        // Don't crash, just try to use what we have or return empty
        return "";
    }

    if (validElements.length === 0) return "";

    // 3. Smart Resizing & Canvas Construction
    // Target width for reference context (1000px is plenty for AI to read text)
    const TARGET_WIDTH = 1000;
    
    // Calculate total height needed
    let totalHeight = 0;
    const itemsToDraw = validElements.map(img => {
        // Calculate height maintaining aspect ratio relative to TARGET_WIDTH
        const scale = TARGET_WIDTH / img.width;
        const drawnHeight = Math.floor(img.height * scale);
        totalHeight += drawnHeight;
        return { img, h: drawnHeight };
    });

    // Hard limit for canvas height to prevent browser crashes (Safety cap: 20000px)
    const MAX_HEIGHT = 20000;
    let finalScale = 1;
    if (totalHeight > MAX_HEIGHT) {
        finalScale = MAX_HEIGHT / totalHeight;
        totalHeight = MAX_HEIGHT;
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_WIDTH;
        canvas.height = totalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Canvas Context Error");

        // White background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        let y = 0;
        for (const item of itemsToDraw) {
            const drawH = Math.floor(item.h * finalScale);
            // Draw image stretched to full width, and scaled height
            ctx.drawImage(item.img, 0, y, TARGET_WIDTH, drawH);
            y += drawH;
        }

        // Export with reduced quality (0.6) for API payload efficiency
        return canvas.toDataURL('image/jpeg', 0.6);
    } catch (e) {
        console.error("Canvas export failed", e);
        return "";
    }
  };

  const handleConfirmReference = async () => {
      if (stagedRefImages.length === 0) return;
      setIsStitching(true);
      try {
          const finalImage = await stitchImages(stagedRefImages);
          
          if (!finalImage || finalImage.length < 100 || finalImage.includes('data:,')) {
              // User request: "If there is no content to learn, just ignore it"
              console.warn("Reference processing resulted in empty/invalid image. Skipping reference step.");
              skipReference(); 
          } else {
              setReferenceImage(finalImage);
          }
          setStagedRefImages([]);
      } catch (e: any) {
          console.error("Reference processing critical failure:", e);
          // Fallback: Skip reference instead of blocking user
          alert("이미지 병합 중 문제가 발생하여 학습 없이 진행합니다.\n(일부 이미지가 손상되었거나 너무 큽니다)");
          skipReference();
          setStagedRefImages([]);
      } finally {
          setIsStitching(false);
      }
  };

  // Add images logic
  const handleAddImages = (newImages: string[]) => {
      // Robust filtering:
      // 1. Must not be empty or null
      // 2. Must not be just 'data:,' or very short junk
      // 3. Should contain base64 marker or be a blob url (we assume data url here mostly)
      const validImages = newImages.filter(img => {
          if (!img) return false;
          if (img.length < 100) return false;
          if (img.includes("data:,") || img === "data:") return false;
          return true;
      });
      
      if (validImages.length === 0) return;

      if (!referenceImage && !isReferenceSkipped) {
          // Step 1: Staging Reference
          setStagedRefImages(prev => [...prev, ...validImages]);
      } else {
          // Step 2: Add to Workspace (Unlimited)
          validImages.forEach(img => addItem(img));
      }
  };

  // Process Files with Robust Natural Sorting
  const processFiles = async (files: FileList | null) => {
      if (!files) return;
      
      // 1. Convert to array and filter images
      const fileArray = Array.from(files).filter(file => file.type.startsWith('image/'));
      if (fileArray.length === 0) return;

      // 2. Natural Sort using Intl.Collator (Standard & Robust)
      // This handles 1.jpg, 2.jpg, 10.jpg correctly
      const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
      fileArray.sort((a, b) => collator.compare(a.name, b.name));

      // 3. Read files sequentially to maintain order
      const readPromises = fileArray.map(file => {
          return new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => resolve(e.target?.result as string);
              reader.readAsDataURL(file);
          });
      });

      try {
        const sortedImages = await Promise.all(readPromises);
        handleAddImages(sortedImages);
      } catch (error) {
        console.error("Error reading files:", error);
      }
  };

  // Global Paste & Drag
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Only handle paste if this component is mounted (which means isThumbnailSkipped is true)
      
      const clipboardItems = e.clipboardData?.items;
      if (!clipboardItems) return;
      for (let i = 0; i < clipboardItems.length; i++) {
        if (clipboardItems[i].type.indexOf('image') !== -1) {
          const blob = clipboardItems[i].getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                if (result) handleAddImages([result]);
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [items.length, referenceImage, isReferenceSkipped]);

  // --- Magic Repair Handlers ---
  const activateMagicRepair = (itemId: string) => {
      setActiveEditItem(itemId);
      setFinalBox(null);
      setRepairPrompt("");
      setIsDrawing(false);
  };
  
  const cancelMagicRepair = () => {
      setActiveEditItem(null);
      setFinalBox(null);
      setRepairPrompt("");
      setIsDrawing(false);
  };

  const handleMouseDown = (e: React.MouseEvent, itemId: string) => {
      if (activeEditItem !== itemId) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setStartPos({ x, y });
      setCurrentPos({ x, y });
      setIsDrawing(true);
      setFinalBox(null); // Clear previous box
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDrawing || !startPos) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCurrentPos({ x, y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
      if (!isDrawing || !startPos || !currentPos) return;
      setIsDrawing(false);
      
      const x = Math.min(startPos.x, currentPos.x);
      const y = Math.min(startPos.y, currentPos.y);
      const w = Math.abs(currentPos.x - startPos.x);
      const h = Math.abs(currentPos.y - startPos.y);

      // Minimum size check (e.g., 10px) to prevent accidental clicks
      if (w > 10 && h > 10) {
          setFinalBox({ x, y, w, h });
      } else {
          setFinalBox(null);
      }
      setStartPos(null);
      setCurrentPos(null);
  };

  const executeMagicRepair = async (item: WorkItem) => {
      if (!finalBox || !repairPrompt.trim() || !item.generatedImage) return;
      
      setIsRepairing(true);
      
      // Calculate Normalized Coordinates (0-1000)
      const imgElement = imageRefs.current[item.id];
      if (!imgElement) return;

      const displayW = imgElement.offsetWidth;
      const displayH = imgElement.offsetHeight;
      
      // Normalized Box (0-1000 scale)
      const normBox = {
          ymin: Math.round((finalBox.y / displayH) * 1000),
          xmin: Math.round((finalBox.x / displayW) * 1000),
          ymax: Math.round(((finalBox.y + finalBox.h) / displayH) * 1000),
          xmax: Math.round(((finalBox.x + finalBox.w) / displayW) * 1000)
      };

      try {
          const newImage = await editImagePartially(item.generatedImage, repairPrompt, normBox);
          updateItem(item.id, { generatedImage: newImage });
          cancelMagicRepair(); // Exit mode on success
          await logUsage();
      } catch (e: any) {
          handleServiceError(e, item.id);
      } finally {
          setIsRepairing(false);
      }
  };

  // --- Batch Actions ---

  // handleResetProject removed

  const analyzeSingleItem = async (item: WorkItem) => {
      // 1. Optimistic UI: Update status IMMEDIATELY to show loader
      updateItem(item.id, { status: 'analyzing', error: null });

      // 2. [Security] Check Session (Background)
      const isSessionValid = await checkSession();
      if (!isSessionValid) return; // If session invalid, user is logged out, no need to revert status

      try {
          // Pass usedCaptions to prevent duplication
          const options = await analyzeImageForCopywriting(item.originalImage, referenceImage, usedCaptions);
          
          // Add new results to anti-duplication memory
          const newTexts = options.map(o => o.text);
          addUsedCaptions(newTexts);

          setItemOptions(item.id, options);
          updateItem(item.id, { status: 'selecting' });
      } catch (e: any) {
          handleServiceError(e, item.id);
      }
  };

  const handleBatchAnalyze = async () => {
      const targets = items.filter(i => i.status === 'idle' || i.status === 'error');
      if (targets.length === 0) return;

      // 1. Optimistic UI: Update ALL targets IMMEDIATELY
      setIsBatchProcessing(true);
      const targetIds = targets.map(t => t.id);
      updateMultipleItems(targetIds, { status: 'analyzing', error: null });

      // 2. [Security] Check Session
      const isSessionValid = await checkSession();
      if (!isSessionValid) {
          setIsBatchProcessing(false);
          return;
      }

      // Sequential execution to prevent rate limiting issues
      for (const item of targets) {
          try {
              // Access fresh state directly to ensure sequential awareness of newly added captions
              const currentUsed = useAppStore.getState().usedCaptions;
              
              const options = await analyzeImageForCopywriting(item.originalImage, referenceImage, currentUsed);
              
              // Add new results immediately so next iteration sees them
              const newTexts = options.map(o => o.text);
              addUsedCaptions(newTexts);

              setItemOptions(item.id, options);
              updateItem(item.id, { status: 'selecting' });
          } catch (e: any) {
              handleServiceError(e, item.id);
          }
      }
      setIsBatchProcessing(false);
  };

  const generateSingleItem = async (item: WorkItem, isRetry: boolean = false) => {
      // 1. Optimistic UI
      updateItem(item.id, { status: 'processing', error: null });

      // 2. [Security] Check Session
      const isSessionValid = await checkSession();
      if (!isSessionValid) return;

      if (!item.selectedOption) return;
      
      try {
          // isRetry=true일 때 geminiService에서 강력한 제거 프롬프트 사용
          const result = await applyCopywritingToImage(item.originalImage, item.selectedOption, isRetry);
          updateItem(item.id, { status: 'complete', generatedImage: result });
          await logUsage();
      } catch (e: any) {
          handleServiceError(e, item.id);
      }
  };

  const handleBatchGenerate = async () => {
      const targets = items.filter(i => i.status === 'selecting' && i.selectedOption);
      if (targets.length === 0) return;
      
      // 1. Optimistic UI: Update ALL targets IMMEDIATELY
      setIsBatchProcessing(true);
      const targetIds = targets.map(t => t.id);
      updateMultipleItems(targetIds, { status: 'processing', error: null });

      // 2. [Security] Check Session
      const isSessionValid = await checkSession();
      if (!isSessionValid) {
          setIsBatchProcessing(false);
          return;
      }

      for (const item of targets) {
          await generateSingleItem(item, false);
      }
      setIsBatchProcessing(false);
  };

  const handleFaceSwap = async (item: WorkItem) => {
      // 1. Optimistic UI
      updateItem(item.id, { status: 'processing', error: null });

      // 2. [Security] Check Session
      const isSessionValid = await checkSession();
      if (!isSessionValid) return;

      if (!item.generatedImage) return;
      
      try {
          const result = await swapFaceInImage(item.generatedImage);
          updateItem(item.id, { status: 'complete', generatedImage: result });
          await logUsage();
      } catch (e: any) {
          handleServiceError(e, item.id);
      }
  };

  // Helper: Process Image (Resize & Watermark) -> Returns Blob
  const processImageToBlob = (imgUrl: string, targetWidth: number): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = imgUrl;
        img.crossOrigin = "Anonymous"; // Handle potential CORS if images are external
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const aspectRatio = img.height / img.width;
            const targetHeight = Math.round(targetWidth * aspectRatio);
            
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            if(!ctx) {
                reject(new Error("Canvas context failed"));
                return;
            }

            // High Quality Resize
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

            // Watermark Logic (Reused)
            if (marketName && marketName.trim()) {
                const fontSize = Math.max(10, targetWidth / 60); 
                ctx.font = `500 ${fontSize}px sans-serif`; 
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; 
                ctx.shadowColor = 'rgba(0, 0, 0, 0.05)'; 
                ctx.shadowBlur = 0; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.save();
                ctx.rotate(-20 * Math.PI / 180); 
                const step = targetWidth * 0.25; 
                for (let x = -targetWidth; x < targetWidth * 2; x += step) {
                    for (let y = -targetHeight; y < targetHeight * 2; y += step) {
                        const shift = (Math.floor(y / step) % 2) * (step / 2);
                        ctx.fillText(marketName, x + shift, y);
                    }
                }
                ctx.restore();
            }

            canvas.toBlob((blob) => {
                if(blob) resolve(blob);
                else reject(new Error("Blob creation failed"));
            }, 'image/png', 1.0); // Maximum quality
        };
        img.onerror = () => reject(new Error("Image load failed"));
      });
  };

  // Handler for Single Download (Legacy support reusing new logic)
  const handleDownload = async (imgUrl: string | null, platformName: string) => {
    if (!imgUrl) return;
    const targetWidth = platformName === 'coupang' ? 780 : 860;
    try {
        const blob = await processImageToBlob(imgUrl, targetWidth);
        saveAs(blob, `${downloadSequenceRef.current}_buking_${marketName || 'img'}_${platformName}.png`);
        downloadSequenceRef.current += 1;
    } catch (e) {
        console.error("Download failed", e);
    }
  };

  // --- Dual Batch ZIP Download ---
  const handleBatchDownload = async (platform: 'smartstore' | 'coupang') => {
    const completeItems = items.filter(i => i.status === 'complete' && i.generatedImage);
    if (completeItems.length === 0) {
        alert("다운로드할 완료된 이미지가 없습니다.");
        return;
    }

    setIsZipping(true);
    const targetWidth = platform === 'smartstore' ? 860 : 780;
    const platformLabel = platform === 'smartstore' ? '스스용' : '쿠팡용';

    try {
        const zip = new JSZip();
        
        // Parallel fetch & process
        const promises = completeItems.map(async (item, index) => {
            const imgData = item.generatedImage!;
            try {
                // Resize & Watermark -> Blob
                const blob = await processImageToBlob(imgData, targetWidth);
                
                // Add to zip (image_01.png)
                const fileName = `image_${String(index + 1).padStart(2, '0')}.png`;
                zip.file(fileName, blob);
            } catch (err) {
                console.warn(`Failed to process image ${index}`, err);
            }
        });

        await Promise.all(promises);

        const content = await zip.generateAsync({ type: "blob" });
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,""); // YYYYMMDD
        saveAs(content, `상세페이지_${platformLabel}_${dateStr}.zip`);

    } catch (e) {
        console.error("Zip failed", e);
        alert("압축 중 오류가 발생했습니다.");
    } finally {
        setIsZipping(false);
    }
  };

  // --- Render Views ---

  // NOTE: Step 0 (ThumbnailMaker) is now handled by App.tsx.
  // We only handle Step 1 (Reference) and Step 2 (Main Workspace) here.
  
  // VIEW 1: Reference Image Upload (Step 1)
  if (!referenceImage && !isReferenceSkipped) {
      return (
        <div key="step-1" className="max-w-4xl mx-auto animate-fade-in-up pb-20">
             <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-slate-800">Step 1. 전체 상세페이지 학습</h2>
                <p className="text-slate-500 mt-2">판매할 제품의 전체적인 맥락을 AI에게 알려주세요.</p>
            </div>
            <div 
                className={`min-h-[40vh] border-4 border-dashed rounded-3xl flex flex-col items-center justify-center bg-white p-8 relative ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-indigo-200'}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files); }}
            >
                {stagedRefImages.length === 0 ? (
                    <>
                        <div className="text-6xl mb-4 text-indigo-200">📚</div>
                        <h3 className="text-xl font-bold text-indigo-900 mb-2">상세페이지 전체 이미지 넣기</h3>
                        <p className="text-indigo-400 mb-6">드래그 또는 붙여넣기 (여러 장 가능, 1.jpg 순서대로 자동 정렬)</p>
                        <div className="flex gap-3">
                            <button onClick={() => fileInputRef.current?.click()} className="bg-indigo-100 text-indigo-800 px-6 py-3 rounded-xl font-bold">파일 찾기</button>
                            <button onClick={skipReference} className="bg-white border border-slate-300 text-slate-500 px-6 py-3 rounded-xl font-bold">건너뛰기</button>
                        </div>
                    </>
                ) : (
                    <div className="w-full flex flex-col items-center gap-6">
                        <div className="flex gap-2 overflow-x-auto w-full p-2 bg-slate-50 rounded-xl justify-center">
                            {stagedRefImages.map((src, i) => (
                                <img key={i} src={src} className="h-40 object-contain rounded border border-slate-200" alt="part"/>
                            ))}
                        </div>
                        <button 
                            onClick={handleConfirmReference} 
                            disabled={isStitching}
                            className={`px-8 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${
                                isStitching 
                                ? 'bg-indigo-400 cursor-wait text-white' 
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                        >
                            {isStitching ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>처리 중...</span>
                                </>
                            ) : '✅ 이 내용으로 학습 완료'}
                        </button>
                    </div>
                )}
                <input type="file" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={(e) => processFiles(e.target.files)} />
            </div>
        </div>
      );
  }

  // VIEW 2: Main Workspace (Batch)
  return (
      <div key="step-2" className="w-full max-w-[1600px] mx-auto animate-fade-in-up pb-32">
          
          {/* Header & Controls */}
          <div className="sticky top-16 z-30 bg-white/95 backdrop-blur shadow-sm border-b border-slate-200 py-4 px-6 mb-8 -mx-4 sm:mx-0 rounded-b-2xl flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-4">
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <span>⚡</span> 작업 리스트 
                      <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-sm">무제한</span>
                  </h2>
                  {referenceImage && (
                      <div className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-bold border border-indigo-100 flex items-center gap-2">
                          <span>📚 학습 완료됨</span>
                          <button onClick={() => setReferenceImage(null)} className="hover:text-red-500">✕</button>
                      </div>
                  )}
              </div>

              <div className="flex gap-3">
                  {/* Reset Project Button Removed */}

                  {/* Dual Batch Download Buttons */}
                  {items.some(i => i.status === 'complete' && i.generatedImage) && (
                      <div className="flex gap-2">
                        <button 
                            onClick={() => handleBatchDownload('smartstore')}
                            disabled={isZipping}
                            className={`px-4 py-2.5 rounded-xl font-bold shadow-lg transition-transform text-sm flex items-center gap-2 ${
                                isZipping 
                                ? 'bg-green-800 text-green-200 cursor-wait' 
                                : 'bg-green-600 hover:bg-green-700 text-white hover:-translate-y-0.5'
                            }`}
                        >
                            {isZipping ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : <span>📥</span>}
                            <span>일괄저장 (스스)</span>
                        </button>
                        <button 
                            onClick={() => handleBatchDownload('coupang')}
                            disabled={isZipping}
                            className={`px-4 py-2.5 rounded-xl font-bold shadow-lg transition-transform text-sm flex items-center gap-2 ${
                                isZipping 
                                ? 'bg-slate-500 text-slate-300 cursor-wait' 
                                : 'bg-slate-600 hover:bg-slate-700 text-white hover:-translate-y-0.5'
                            }`}
                        >
                            {isZipping ? (
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            ) : <span>📥</span>}
                            <span>일괄저장 (쿠팡)</span>
                        </button>
                      </div>
                  )}

                  {/* Global Actions */}
                  {items.some(i => i.status === 'idle') && (
                      <button 
                          onClick={handleBatchAnalyze}
                          disabled={isBatchProcessing}
                          className={`px-5 py-2.5 rounded-xl font-bold shadow-lg transition-transform text-sm flex items-center gap-2 ${
                              isBatchProcessing 
                              ? 'bg-slate-700 text-slate-300 cursor-wait' 
                              : 'bg-slate-800 hover:bg-black text-white hover:-translate-y-0.5'
                          }`}
                      >
                          {isBatchProcessing && items.some(i => i.status === 'analyzing') ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>분석 요청 중...</span>
                              </>
                          ) : (
                              `🔍 순차 분석 시작 (${items.filter(i => i.status === 'idle').length})`
                          )}
                      </button>
                  )}
                  {items.some(i => i.status === 'selecting' && i.selectedOption) && (
                      <button 
                          onClick={handleBatchGenerate}
                          disabled={isBatchProcessing}
                          className={`px-5 py-2.5 rounded-xl font-bold shadow-lg transition-transform text-sm flex items-center gap-2 ${
                              isBatchProcessing
                              ? 'bg-primary-800 text-primary-200 cursor-wait'
                              : 'bg-primary-600 hover:bg-primary-700 text-white hover:-translate-y-0.5'
                          }`}
                      >
                           {isBatchProcessing && items.some(i => i.status === 'processing') ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>생성 요청 중...</span>
                              </>
                          ) : (
                              `✨ 선택 일괄 생성 (${items.filter(i => i.status === 'selecting' && i.selectedOption).length})`
                          )}
                      </button>
                  )}
                  <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 rounded-xl font-bold border-2 text-sm bg-white border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
                  >
                      + 이미지 추가
                  </button>
              </div>
          </div>

          <input type="file" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={(e) => processFiles(e.target.files)} />

          {/* List Area */}
          <div className="space-y-6">
              {items.length === 0 && (
                   <div 
                      className="h-64 border-4 border-dashed border-slate-200 rounded-3xl flex flex-col items-center justify-center text-slate-400 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(e.dataTransfer.files); }}
                   >
                       <div className="text-5xl mb-3 opacity-50">📥</div>
                       <p className="font-bold text-lg">작업할 이미지를 여기에 드래그하거나 클릭하여 추가하세요 (무제한)</p>
                   </div>
              )}

              {items.map((item, idx) => (
                  <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col lg:flex-row min-h-[400px]">
                      
                      {/* Column 1: Original Image & Controls (25%) */}
                      <div className="lg:w-1/4 p-4 border-b lg:border-b-0 lg:border-r border-slate-100 bg-slate-50/50 flex flex-col">
                          <div className="flex justify-between items-center mb-3">
                              <span className="bg-slate-800 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                              <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500 text-xs font-bold px-2 py-1 rounded bg-white border border-slate-200">삭제</button>
                          </div>
                          <div className="flex-1 flex items-center justify-center bg-white rounded-xl border border-slate-200 overflow-hidden p-2 shadow-inner group relative">
                               <img src={item.originalImage} className="max-h-64 object-contain" alt="Original"/>
                               <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs">원본 이미지</div>
                          </div>
                      </div>

                      {/* Column 2: Copywriting Selector (40%) */}
                      <div className="lg:w-2/5 p-4 border-b lg:border-b-0 lg:border-r border-slate-100 flex flex-col">
                          <h4 className="text-sm font-bold text-slate-700 mb-3 flex justify-between items-center">
                              <span>💬 카피라이팅 선택</span>
                              {(item.status === 'selecting' || item.status === 'error') && (
                                  <button 
                                    onClick={() => analyzeSingleItem(item)} 
                                    className="text-xs text-indigo-500 hover:text-indigo-700 underline font-medium"
                                  >
                                    ↺ 다시 분석
                                  </button>
                              )}
                          </h4>
                          
                          <div className="flex-1 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                              {item.status === 'idle' && (
                                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
                                      <p>상단 "순차 분석 시작"을 눌러주세요.</p>
                                  </div>
                              )}
                              {item.status === 'analyzing' && (
                                  <div className="space-y-3">
                                      <div className="flex items-center gap-2 text-indigo-600 text-sm font-bold animate-pulse mb-2">
                                          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                                          AI가 중국어를 분석하고 있습니다...
                                      </div>
                                      {[1,2,3,4].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse"/>)}
                                  </div>
                              )}
                              {item.status === 'error' && (
                                  <div className="p-4 bg-red-50 text-red-600 text-xs rounded-xl">
                                      <p className="font-bold mb-1">오류 발생</p>
                                      {item.error}
                                      <button onClick={() => analyzeSingleItem(item)} className="block mt-2 underline">재시도</button>
                                  </div>
                              )}
                              {(item.status === 'selecting' || item.status === 'processing' || item.status === 'complete') && (
                                  <div className="space-y-2">
                                      {item.copywritingOptions.map((opt, optIdx) => (
                                          <div 
                                            key={optIdx} 
                                            onClick={() => setItemSelectedOption(item.id, opt)}
                                            className={`p-3 rounded-lg border text-sm cursor-pointer transition-all relative group ${item.selectedOption === opt ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-slate-100 hover:bg-slate-50'}`}
                                          >
                                              {editingState?.itemId === item.id && editingState.index === optIdx ? (
                                                  <div onClick={e => e.stopPropagation()}>
                                                      <textarea 
                                                          className="w-full p-2 border rounded text-sm mb-2" 
                                                          value={editingState.value} 
                                                          onChange={e => setEditingState({...editingState, value: e.target.value})}
                                                      />
                                                      <div className="flex justify-end gap-2">
                                                          <button onClick={() => setEditingState(null)} className="text-xs px-2 py-1 bg-slate-200 rounded">취소</button>
                                                          <button onClick={() => { updateItemOptionText(item.id, optIdx, editingState.value); setEditingState(null); }} className="text-xs px-2 py-1 bg-primary-600 text-white rounded">저장</button>
                                                      </div>
                                                  </div>
                                              ) : (
                                                  <>
                                                      <div className="pr-6 text-left">
                                                          {(() => {
                                                              const parts = opt.text.split('\n');
                                                              const title = parts[0];
                                                              const desc = parts.slice(1).join('\n');
                                                              return (
                                                                  <>
                                                                      <div className="font-bold text-slate-900 text-[15px] mb-1 leading-tight">{title}</div>
                                                                      {desc && <div className="font-normal text-slate-500 text-[13px] leading-snug whitespace-pre-wrap">{desc}</div>}
                                                                  </>
                                                              );
                                                          })()}
                                                      </div>
                                                      <button 
                                                          onClick={(e) => { e.stopPropagation(); setEditingState({itemId: item.id, index: optIdx, value: opt.text}); }}
                                                          className={`absolute right-2 top-2 text-slate-300 hover:text-primary-600 ${item.selectedOption === opt ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                                      >
                                                          ✏️
                                                      </button>
                                                  </>
                                              )}
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      </div>

                      {/* Column 3: Result (35%) */}
                      <div className="lg:w-[35%] p-4 bg-slate-50/30 flex flex-col relative">
                          <h4 className="text-sm font-bold text-slate-700 mb-3 flex justify-between">
                              <span>✨ 결과물</span>
                              {item.status === 'complete' && item.generatedImage && (
                                  <div className="flex gap-2">
                                      <button onClick={() => handleDownload(item.generatedImage, 'smartstore')} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-bold hover:bg-green-200">저장(스스)</button>
                                      <button onClick={() => handleDownload(item.generatedImage, 'coupang')} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold hover:bg-blue-200">저장(쿠팡)</button>
                                  </div>
                              )}
                          </h4>

                          <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 min-h-[300px] relative overflow-hidden">
                              {item.status === 'processing' && (
                                  <div className="text-center">
                                      <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                                      <p className="text-sm text-primary-600 font-bold animate-pulse">
                                          AI가 이미지를 생성 중입니다...
                                      </p>
                                  </div>
                              )}
                              
                              {item.status === 'complete' && item.generatedImage ? (
                                  <div className="relative w-full h-full flex items-center justify-center group">
                                      <img 
                                        src={item.generatedImage} 
                                        className="max-h-full max-w-full object-contain select-none" 
                                        alt="Result"
                                        ref={el => { imageRefs.current[item.id] = el; }}
                                        draggable={false}
                                      />
                                      
                                      {/* Magic Repair Overlay */}
                                      {activeEditItem === item.id && (
                                          <div 
                                            className="absolute inset-0 cursor-crosshair z-20"
                                            onMouseDown={(e) => handleMouseDown(e, item.id)}
                                            onMouseMove={handleMouseMove}
                                            onMouseUp={handleMouseUp}
                                            onMouseLeave={() => { setIsDrawing(false); }}
                                          >
                                              {/* Drawing Box */}
                                              {isDrawing && startPos && currentPos && (
                                                  <div 
                                                      className="absolute border-2 border-red-500 bg-red-500/20"
                                                      style={{
                                                          left: Math.min(startPos.x, currentPos.x),
                                                          top: Math.min(startPos.y, currentPos.y),
                                                          width: Math.abs(currentPos.x - startPos.x),
                                                          height: Math.abs(currentPos.y - startPos.y)
                                                      }}
                                                  ></div>
                                              )}
                                              {/* Final Selection Box & Popover */}
                                              {finalBox && (
                                                  <>
                                                    <div 
                                                        className="absolute border-2 border-primary-500 bg-primary-500/10 shadow-lg animate-pulse"
                                                        style={{
                                                            left: finalBox.x,
                                                            top: finalBox.y,
                                                            width: finalBox.w,
                                                            height: finalBox.h
                                                        }}
                                                    ></div>
                                                    {/* Popover Input */}
                                                    <div 
                                                        className="absolute bg-white rounded-xl shadow-2xl p-3 z-30 flex flex-col gap-2 min-w-[280px] border border-slate-200 animate-fade-in-up"
                                                        style={{
                                                            top: Math.min(finalBox.y + finalBox.h + 10, imageRefs.current[item.id]?.offsetHeight ? imageRefs.current[item.id]!.offsetHeight - 120 : 0),
                                                            left: Math.min(finalBox.x, imageRefs.current[item.id]?.offsetWidth ? imageRefs.current[item.id]!.offsetWidth - 280 : 0)
                                                        }}
                                                        onMouseDown={e => e.stopPropagation()} // Prevent drawing restart
                                                    >
                                                        <div className="flex justify-between items-center text-xs font-bold text-slate-700">
                                                            <span>🪄 어떻게 수정할까요?</span>
                                                            <button onClick={cancelMagicRepair} className="text-slate-400 hover:text-slate-600">✕</button>
                                                        </div>
                                                        <input 
                                                            type="text" 
                                                            autoFocus
                                                            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                                                            placeholder="예: 텍스트 삭제, '무선'으로 변경"
                                                            value={repairPrompt}
                                                            onChange={e => setRepairPrompt(e.target.value)}
                                                            onKeyDown={e => e.key === 'Enter' && executeMagicRepair(item)}
                                                        />
                                                        <button 
                                                            onClick={() => executeMagicRepair(item)}
                                                            disabled={isRepairing || !repairPrompt.trim()}
                                                            className={`w-full py-2 rounded-lg text-xs font-bold text-white transition-colors ${isRepairing ? 'bg-slate-400 cursor-wait' : 'bg-primary-600 hover:bg-primary-700'}`}
                                                        >
                                                            {isRepairing ? 'AI 수정 중...' : '수정 실행'}
                                                        </button>
                                                    </div>
                                                  </>
                                              )}
                                              
                                              {/* Instruction Text */}
                                              {!isDrawing && !finalBox && (
                                                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-full text-xs pointer-events-none backdrop-blur-sm">
                                                      수정할 영역을 드래그하세요 🖱️
                                                  </div>
                                              )}
                                          </div>
                                      )}

                                      {/* Normal Overlay Actions (Hidden when editing) */}
                                      {activeEditItem !== item.id && (
                                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-4">
                                              <button 
                                                  onClick={() => generateSingleItem(item, true)} 
                                                  className="w-full bg-white text-slate-800 px-4 py-3 rounded-lg font-bold text-sm hover:bg-slate-100 shadow-lg flex items-center justify-center gap-2"
                                              >
                                                  <span className="text-lg">🔥</span> 강력 재생성 (전체)
                                              </button>

                                              <button 
                                                  onClick={() => handleFaceSwap(item)}
                                                  className="w-full bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-800 shadow-lg mt-2 flex items-center justify-center gap-2"
                                              >
                                                  <span className="text-lg">👱‍♀️</span> 모델 얼굴 변경
                                              </button>
                                              
                                              {/* Magic Fix Button */}
                                              <button 
                                                  onClick={() => activateMagicRepair(item.id)}
                                                  className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 shadow-lg mt-2 flex items-center justify-center gap-2"
                                              >
                                                  <span className="text-lg">🪄</span> 매직 리페어 (부분 수정)
                                              </button>
                                          </div>
                                      )}
                                  </div>
                              ) : (
                                  !item.status.includes('processing') && (
                                      <p className="text-xs text-slate-400">이미지가 여기 표시됩니다.</p>
                                  )
                              )}
                          </div>

                          {/* Watermark Input (Global but shown here for context if needed, currently global) */}
                      </div>
                  </div>
              ))}
          </div>
          
          {/* Global Watermark Settings (Bottom Fixed) */}
          <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
              <div className="max-w-[1600px] mx-auto flex justify-between items-center">
                  <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-slate-700">워터마크 설정:</span>
                      <input 
                          type="text" 
                          placeholder="마켓명 (예: 부업왕마켓)" 
                          value={marketName}
                          onChange={(e) => setMarketName(e.target.value)}
                          className="bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg text-sm w-48 outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <span className="text-xs text-slate-400 hidden sm:inline">저장 시 대각선으로 은은하게 삽입됩니다.</span>
                  </div>
                  <button 
                      onClick={clearAllItems}
                      className="text-xs text-red-400 hover:text-red-600 hover:underline"
                  >
                      전체 초기화
                  </button>
              </div>
          </div>

      </div>
  );
};