import { GoogleGenAI, Type } from "@google/genai";
import { useAppStore } from "../store/useAppStore";
import { CopywritingOption, AnalysisStage, RenderingPreservation, ValidationResult, TextReplacement, BoxStructure } from "../types";

// [SECURITY CHECK] Ensure this code ONLY runs in a browser (Client-Side)
if (typeof window === 'undefined') {
    throw new Error("🚨 CRITICAL SECURITY ERROR: This service is CLIENT-SIDE ONLY. Do not deploy to a server.");
}

// [CRITICAL] API Client Factory - Enforces usage of the specific User Key
const getClient = () => {
  const userKeyFromStore = useAppStore.getState().apiKey;
  
  if (!userKeyFromStore || typeof userKeyFromStore !== 'string' || userKeyFromStore.trim() === '') {
      console.error("⛔ [Gemini Service] No API Key found in store.");
      throw new Error("[AUTH_ERROR] API Key가 입력되지 않았습니다. 로그인 상태를 확인해주세요.");
  }

  if (!userKeyFromStore.startsWith("AIza")) {
      console.error("⛔ [Gemini Service] Invalid API Key format.");
      throw new Error("[AUTH_ERROR] 유효하지 않은 API Key 형식입니다.");
  }
  
  return new GoogleGenAI({ apiKey: userKeyFromStore });
};

// Error Handler
const handleGeminiError = (error: any) => {
    const msg = (error.message || JSON.stringify(error)).toString();
    console.error("Gemini API Error Detail:", error);

    // AUTH Errors
    if (msg.includes("expired")) {
         throw new Error("🚨 [키 만료] API Key가 만료되었습니다. 새 키를 발급받아 입력해주세요.");
    }

    if (msg.includes("403") || msg.includes("API key") || msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED")) {
        throw new Error("🚨 [권한 거부] API Key 권한이 없거나 결제 계정이 연결되지 않았습니다. (Google Cloud Console 확인 필요)");
    }
    
    // Quota Errors
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
         throw new Error("⚠️ [할당량 초과] 단시간에 너무 많은 요청을 보냈습니다. 1분 뒤 다시 시도해주세요.");
    }
    
    // Server/Model Errors
    if (msg.includes("503") || msg.includes("Overloaded") || msg.includes("Internal")) {
        // 503 is handled by retry logic, but if it leaks here:
        throw new Error("⚠️ 구글 서버 과부하 상태입니다. 잠시 후 다시 시도해주세요.");
    }

    // Model Not Found (Common with Pro/Preview models)
    if (msg.includes("404") || msg.includes("not found")) {
        throw new Error("⚠️ [모델 미지원] 현재 API Key로는 해당 AI 모델(Gemini 3)을 사용할 수 없습니다.");
    }
    
    // Safety Errors
    if (msg.includes("SAFETY") || msg.includes("blocked")) {
        throw new Error("⚠️ [안전 차단] 생성된 이미지가 안전 정책(성인/폭력 등)에 의해 차단되었습니다.");
    }
    
    // Fallback
    throw new Error(`오류 발생: ${msg.substring(0, 100)}...`);
};

// --- CLIENT-SIDE OPTIMIZATION ---
// Resize image to max 1024px to reduce payload and server load
const optimizeImageForAPI = (base64Str: string, maxDimension: number = 1024): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64Str.startsWith('data:') ? base64Str : `data:image/jpeg;base64,${base64Str}`;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height *= maxDimension / width));
                    width = maxDimension;
                } else {
                    width = Math.round((width *= maxDimension / height));
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64Str); // Fallback to original
                return;
            }
            
            ctx.drawImage(img, 0, 0, width, height);
            // Compress to JPEG 0.8 quality
            const optimized = canvas.toDataURL('image/jpeg', 0.8);
            const clean = optimized.replace(/^data:image\/[a-z]+;base64,/, "");
            console.log(`📉 Image Optimized: ${img.width}x${img.height} -> ${width}x${height}`);
            resolve(clean);
        };
        img.onerror = (e) => {
            console.warn("Image optimization failed, using original", e);
            resolve(cleanBase64(base64Str));
        };
    });
};

// --- RETRY WRAPPER (Text) ---
const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> => {
    let lastError: any;
    
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            const msg = (error.message || "").toString();
            
            if (msg.includes("AUTH_ERROR") || msg.includes("키 만료") || msg.includes("권한") || msg.includes("SAFETY")) {
                throw error;
            }

            console.warn(`Text Gen Attempt ${i + 1} failed. Retrying in ${delayMs}ms...`, msg);
            await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1))); 
        }
    }
    throw lastError;
};

// --- VALIDATION ---
export const validateGeminiKey = async (userInputKey: string): Promise<{ isValid: boolean; errorMsg?: string }> => {
    if (!userInputKey || !userInputKey.startsWith("AIza") || userInputKey.length < 30) {
        return { isValid: false, errorMsg: "API Key 형식이 올바르지 않습니다. (AIza로 시작해야 함)" };
    }
    
    try {
        const ai = new GoogleGenAI({ apiKey: userInputKey });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: 'ping' }] }
        });
        
        if (response?.text) {
             return { isValid: true };
        } else {
             return { isValid: false, errorMsg: "응답 없음" };
        }
    } catch (e: any) {
        console.error("Validation Failed:", e);
        const rawMsg = (e.message || JSON.stringify(e)).toLowerCase();
        let friendlyMsg = "유효하지 않은 API Key입니다.";
        
        if (rawMsg.includes("expired")) friendlyMsg = "🚨 만료된 키입니다.";
        else if (rawMsg.includes("key_invalid")) friendlyMsg = "🚨 존재하지 않는 키입니다.";
        else if (rawMsg.includes("permission_denied")) friendlyMsg = "🚨 권한이 없는 키입니다.";
        else if (rawMsg.includes("not found")) friendlyMsg = "⚠️ 모델 접근 불가 (Gemini 3 Flash)";
        
        return { isValid: false, errorMsg: friendlyMsg };
    }
};

// Helpers
const cleanBase64 = (str: string) => {
    if (!str) return "";
    let base64 = str.trim();
    base64 = base64.replace(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+)?;base64,/, '');
    if (base64 === 'data:,' || base64.length < 100) return ""; 
    return base64;
};

const cleanJson = (text: string) => {
  let clean = text.trim();
  clean = clean.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '');
  return clean.trim();
};

// --- CORE IMAGE GENERATION (With Intelligent Retry & Callback) ---
// Features: Exponential Backoff, Fallback Models, Status Callback
const generateImage = async (
    mimeType: string, 
    cleanData: string, 
    prompt: string, 
    imageConfig: any = {},
    onStatusUpdate?: (msg: string) => void
): Promise<string> => {
    const ai = getClient();
    
    // Models to try in order
    const modelsToTry = [
        'gemini-3.1-flash-image-preview', // Priority 1: High Quality (New)
        'gemini-2.5-flash-image'          // Priority 2: General/Fast
    ];

    // Retry Delays: 5s, 10s, 20s, 40s, 60s
    const retryDelays = [5000, 10000, 20000, 40000, 60000];

    let lastError: any = null;

    for (const modelName of modelsToTry) {
        
        // Retry Loop for 503/429 errors
        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
            try {
                if (onStatusUpdate) {
                    if (attempt === 0) onStatusUpdate(`🎨 모델(${modelName.includes('3.1') ? '3.1 Flash' : (modelName.includes('pro') ? 'Pro' : 'Fast')})로 이미지 생성 시작...`);
                    else onStatusUpdate(`⏳ 구글 서버 대기 중... ${retryDelays[attempt-1]/1000}초 후 재시도 (${attempt}/${retryDelays.length})`);
                }

                // If this is a retry, wait before calling
                if (attempt > 0) {
                    await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
                }
                
                // [Optimization] Optimize image size right before call if logic allows, 
                // but we do it outside this loop to avoid re-optimizing. 
                // Assuming cleanData is passed already optimized or raw.

                console.log(`🎨 Attempt ${attempt+1}: Generating image using ${modelName}`);
                
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: {
                        parts: [
                            { inlineData: { mimeType: mimeType, data: cleanData } },
                            { text: prompt }
                        ]
                    },
                    config: {
                        imageConfig: {
                            aspectRatio: imageConfig.aspectRatio || "1:1",
                            ...( (modelName.includes('pro') || modelName.includes('3.1')) ? { imageSize: imageConfig.imageSize || "1K" } : {})
                        }
                    }
                });

                if (response.candidates && response.candidates.length > 0) {
                    for (const part of response.candidates[0].content.parts) {
                        if (part.inlineData && part.inlineData.data) {
                            const mime = part.inlineData.mimeType || 'image/png';
                            return `data:${mime};base64,${part.inlineData.data}`;
                        }
                    }
                }
                throw new Error("Empty image response");

            } catch (e: any) {
                lastError = e;
                const msg = (e.message || "").toLowerCase();
                
                // Critical Errors -> Break Model Loop (Try next model or fail)
                if (msg.includes("auth") || msg.includes("key") || msg.includes("permission") || msg.includes("safety") || msg.includes("blocked")) {
                    throw e; // Don't retry these errors
                }

                // Retryable Errors (503, 429, Overloaded)
                if (msg.includes("503") || msg.includes("overloaded") || msg.includes("quota") || msg.includes("internal") || msg.includes("429")) {
                     console.warn(`⚠️ Attempt ${attempt + 1} failed (${modelName}):`, msg);
                     // Continue to next iteration of retry loop
                     continue;
                }
                
                // If 404 (Model not found), break retry loop and try next model immediately
                if (msg.includes("404") || msg.includes("not found")) {
                    break; 
                }

                // Unknown error -> Break retry loop
                break;
            }
        }
        // If we exhausted retries for this model, try the next model
    }

    // If all failed
    throw lastError || new Error("모든 이미지 생성 모델 시도 실패 (구글 서버 혼잡)");
};

// --- EXPORTED FUNCTIONS ---

// 분석: gemini-3-flash-preview
export const analyzeForThumbnail = async (base64Image: string): Promise<{ detectionReport: string; generationPrompt: string; seoTip: string; }> => {
    return withRetry(async () => {
        try {
            const ai = getClient();
            const cleanData = cleanBase64(base64Image);
            
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview', 
                contents: {
                    parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: cleanData } },
                        { text: "Analyze for thumbnail. Output JSON: { detection_report, generation_prompt, seo_tip }" }
                    ]
                },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            detection_report: { type: Type.STRING },
                            generation_prompt: { type: Type.STRING },
                            seo_tip: { type: Type.STRING }
                        }
                    }
                }
            });
            const result = JSON.parse(cleanJson(response.text || "{}"));
            return {
                detectionReport: result.detection_report || "분석 완료",
                generationPrompt: result.generation_prompt || "Background replacement",
                seoTip: result.seo_tip || "Tip"
            };
        } catch (e) {
            throw e; 
        }
    });
};

export const generateThumbnailImage = async (base64Image: string, promptText: string): Promise<string> => {
    try {
        const cleanData = cleanBase64(base64Image);
        // Optimization for Thumbnail
        const optimizedData = await optimizeImageForAPI(cleanData, 1024);
        
        const finalPrompt = `${promptText} \n [STRICT] Keep product exactly as is. Replace background. No text overlays.`;
        return await generateImage('image/jpeg', optimizedData, finalPrompt, { aspectRatio: '1:1', imageSize: '1K' });
    } catch (e) {
        return handleGeminiError(e);
    }
};

export const analyzeAndGenerateCopywriting = async (
    base64Target: string, 
    prextractedTexts: string[],
    base64Reference?: string | null,
    usedCaptions: string[] = [] 
): Promise<{
    analysisStage: AnalysisStage;
    renderingPreservation: RenderingPreservation;
    copywriting: CopywritingOption[];
    validation: ValidationResult;
}> => {
    return withRetry(async () => {
        try {
            const ai = getClient();
            const targetData = cleanBase64(base64Target);
            
            const contextParts: any[] = [];
            if (base64Reference) {
                const refData = cleanBase64(base64Reference);
                if (refData) {
                    contextParts.push({ inlineData: { mimeType: 'image/jpeg', data: refData } });
                    contextParts.push({ text: "CONTEXT: Reference Style." });
                }
            }
            contextParts.push({ inlineData: { mimeType: 'image/jpeg', data: targetData } });

            let negativePrompt = "";
            if (usedCaptions.length > 0) {
                const recentUsed = usedCaptions.slice(-50).join(", ");
                negativePrompt = `Do NOT use these phrases: [ ${recentUsed} ]`;
            }

            const legacyPrompt = `
    # Role: Cross-Border E-commerce Copywriter (Chinese -> Korean)
    # Task: Generate 8 distinct Korean copywriting options.
    ${negativePrompt}
    # Output: JSON array of strings ONLY. No prefixes.
    # Output Format: {"options": ["...", ...]}
    `;

            contextParts.push({ text: legacyPrompt });

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview', 
                contents: { parts: contextParts },
                config: { responseMimeType: "application/json" }
            });

            const rawResult = JSON.parse(cleanJson(response.text || "{}"));
            let optionsList: string[] = rawResult.options || [];

            const toneMap = [
                "1. 직역/스펙", "2. 핵심 이점", "3. 감성 공감", "4. 질문 & 해결",
                "5. 프리미엄", "6. 안심 후킹", "7. 욕망 후킹", "8. 임팩트/반전"
            ];
            
            const aggregatedOptions: CopywritingOption[] = [];
            for (let i = 0; i < 8; i++) {
                let cleanText = optionsList[i] || "";
                cleanText = cleanText.replace(/^(Option\s?\d+|옵션\s?\d+|\d+)\s?[:.]\s?/i, "").trim();
                aggregatedOptions.push({
                    index: i + 1,
                    tone: toneMap[i] || `Option ${i+1}`,
                    text: cleanText,
                    replacements: [] 
                });
            }

            return {
                analysisStage: { chinese_text_count: 0, boxes_and_tables_detected: 0, boxes_and_tables: [], warning: "Legacy Mode" },
                renderingPreservation: { boxes_preserved: true, table_structure_preserved: true, cell_structure_preserved: true, font_sizes_maintained: true, colors_maintained: true, backgrounds_maintained: true, opacity_maintained: true, positions_maintained: true, borders_maintained: true },
                copywriting: aggregatedOptions,
                validation: { boxes_and_tables_detected: true, all_box_texts_recognized: true, box_structure_safe: true, no_box_text_deleted: true, rendering_safe: true, coordinates_recorded: true, ready_for_image_gen: true }
            };
        } catch (e) {
            throw e; 
        }
    }).catch((e) => {
        return handleGeminiError(e);
    });
};

export const analyzeImageForCopywriting = async (base64Image: string, referenceImage?: string | null, usedCaptions: string[] = []) => {
    const result = await analyzeAndGenerateCopywriting(base64Image, [], referenceImage, usedCaptions);
    return result.copywriting;
};

export const applyCopywritingToImage = async (base64Image: string, selectedOption: CopywritingOption, isRetry: boolean = false): Promise<string> => {
    // This is now a wrapper that might be unused if we call generateDetailPageImage directly
    return generateDetailPageImage(base64Image, selectedOption, []);
};

// --- 원본 이미지 비율 자동 계산 함수 ---
const determineAspectRatio = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const ratio = img.width / img.height;
            // Gemini 모델이 지원하는 비율 목록
            const supported = [
                { name: "1:1", val: 1.0 },
                { name: "4:3", val: 4/3 },
                { name: "3:4", val: 3/4 },
                { name: "16:9", val: 16/9 },
                { name: "9:16", val: 9/16 },
                { name: "4:1", val: 4/1 },
                { name: "1:4", val: 1/4 }
            ];
            // 원본과 가장 가까운 비율 찾기
            let closest = supported[0];
            let minDiff = Math.abs(ratio - supported[0].val);
            for (const s of supported) {
                const diff = Math.abs(ratio - s.val);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = s;
                }
            }
            console.log(`📏 원본 비율: ${img.width}x${img.height} (${ratio.toFixed(2)}) -> 적용 비율: ${closest.name}`);
            resolve(closest.name);
        };
        img.onerror = () => resolve("1:1"); // 에러 시 기본값
        img.src = base64Str.startsWith('data:') ? base64Str : `data:image/jpeg;base64,${base64Str}`;
    });
};

// [UPDATED] Detailed Page Generation with Optimization and Status Callback
export const generateDetailPageImage = async (
    base64Image: string, 
    selectedOption: CopywritingOption, 
    recognizedChineseTexts: string[],
    onStatusUpdate?: (msg: string) => void
): Promise<string> => {
    try {
        if (onStatusUpdate) onStatusUpdate("⚡ 이미지 비율 분석 및 최적화 중...");
        
        const cleanData = cleanBase64(base64Image);
        
        // 1. 원본 이미지의 비율을 분석해서 가장 가까운 지원 비율 찾기
        const targetRatio = await determineAspectRatio(cleanData);
        
        // 2. Optimize: Resize to 1024px max before sending
        const optimizedData = await optimizeImageForAPI(cleanData, 1024);
        
        const prompt = `
        Task: E-commerce Localization (Chinese -> Korean).
        User Copy: "${selectedOption.text}"
        Rules: Replace Chinese text with Korean. Keep product integrity. High contrast text.
        `;
        
        // 3. 분석된 원본 비율(targetRatio)을 적용하여 생성 요청
        return await generateImage('image/jpeg', optimizedData, prompt, { aspectRatio: targetRatio }, onStatusUpdate);
    } catch (e) {
        return handleGeminiError(e);
    }
};

export const swapFaceInImage = async (base64Image: string): Promise<string> => {
  try {
      const cleanData = cleanBase64(base64Image);
      // Optimize
      const optimizedData = await optimizeImageForAPI(cleanData, 1024);
      const prompt = `Face Swap: Replace human face with Western/Caucasian model. Keep age/gender same.`;
      return await generateImage('image/jpeg', optimizedData, prompt);
  } catch (e) {
      return handleGeminiError(e);
  }
};

export const editImagePartially = async (base64Image: string, userPrompt: string, box: any): Promise<string> => {
    try {
        const cleanData = cleanBase64(base64Image);
        // For inpainting, we might want to keep original resolution if possible, 
        // but 503 is a bigger issue. Let's optimize slightly less aggressively or keep as is.
        // Let's use 1024 for stability.
        const optimizedData = await optimizeImageForAPI(cleanData, 1024);

        const prompt = `Magic Repair. Region: [${box.ymin}, ${box.xmin}, ${box.ymax}, ${box.xmax}]. Instruction: "${userPrompt}"`;
        return await generateImage('image/jpeg', optimizedData, prompt);
    } catch (e) {
        return handleGeminiError(e);
    }
};
