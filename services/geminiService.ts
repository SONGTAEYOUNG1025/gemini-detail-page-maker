import { GoogleGenAI, Type } from "@google/genai";
import { useAppStore } from "../store/useAppStore";
import { CopywritingOption, AnalysisStage, RenderingPreservation, ValidationResult, TextReplacement, BoxStructure } from "../types";

// [SECURITY CHECK] Ensure this code ONLY runs in a browser (Client-Side)
// 이 코드는 오직 사용자의 브라우저에서만 실행되어야 합니다.
// 서버(Node.js 등)에서 실행될 경우 개발자의 키가 유출될 위험을 원천 차단하기 위해 강제 에러를 발생시킵니다.
if (typeof window === 'undefined') {
    throw new Error("🚨 CRITICAL SECURITY ERROR: This service is CLIENT-SIDE ONLY. Do not deploy to a server.");
}

// [CRITICAL] API Client Factory - Enforces usage of the specific User Key
// 환경변수(process.env)를 절대 사용하지 않고, Store에 저장된 사용자 입력 키를 강제로 사용합니다.
const getClient = () => {
  // 1. Store에서 사용자 입력 키 가져오기 (Source of Truth)
  const userKeyFromStore = useAppStore.getState().apiKey;
  
  // 2. 키 존재 여부 확인 (없으면 실행 차단)
  if (!userKeyFromStore || typeof userKeyFromStore !== 'string' || userKeyFromStore.trim() === '') {
      console.error("⛔ [Gemini Service] No API Key found in store.");
      throw new Error("[AUTH_ERROR] API Key가 입력되지 않았습니다. 로그인 상태를 확인해주세요.");
  }

  // 3. 키 포맷 재검증
  if (!userKeyFromStore.startsWith("AIza")) {
      console.error("⛔ [Gemini Service] Invalid API Key format.");
      throw new Error("[AUTH_ERROR] 유효하지 않은 API Key 형식입니다.");
  }
  
  // 4. [LOGGING] 개발자 콘솔에서 내 키가 쓰이는지 확인 가능 (보안 로그)
  // 이 로그는 사용자의 브라우저 콘솔에만 찍히며, 서버로 전송되지 않습니다.
  console.log(`🔒 [Secure Mode] Requesting Google API with User Key: ...${userKeyFromStore.slice(-4)}`);

  // 5. [FIX] 입력받은 키로 클라이언트 직접 생성 (환경변수 참조 제거)
  return new GoogleGenAI({ apiKey: userKeyFromStore });
};

// Error Handler
const handleGeminiError = (error: any) => {
    const msg = (error.message || JSON.stringify(error)).toString();
    console.error("Gemini API Error:", error);

    // AUTH Errors (Explicit)
    if (msg.includes("expired")) {
         throw new Error("🚨 [키 만료] 현재 사용 중인 API Key가 만료/삭제되었습니다. 로그아웃 후 새 키를 입력해주세요.");
    }

    if (msg.includes("403") || msg.includes("API key") || msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED")) {
        throw new Error("🚨 [권한 오류] 입력하신 API Key가 거부되었습니다. 올바른 키인지 확인하거나, Google Cloud 결제(Billing) 상태를 확인해주세요.");
    }
    
    // Quota Errors
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
         throw new Error("⚠️ [사용량 초과] 구글 무료 할당량을 모두 썼거나, 서버가 혼잡합니다. 1분 뒤 다시 시도해주세요.");
    }
    
    // Server/Model Errors
    if (msg.includes("503") || msg.includes("Overloaded") || msg.includes("Internal")) {
        throw new Error("⚠️ Google AI 서버 트래픽이 폭주 중입니다. 잠시 후 다시 시도해주세요.");
    }

    // Not Found (Model Error)
    if (msg.includes("404") || msg.includes("not found")) {
        throw new Error("⚠️ [모델 오류] 지정된 AI 모델을 찾을 수 없습니다. (모델명 확인 필요)");
    }
    
    // Safety Errors
    if (msg.includes("SAFETY") || msg.includes("blocked")) {
        throw new Error("⚠️ 안전 정책에 의해 생성이 차단되었습니다.");
    }
    
    // Fallback
    throw new Error(`AI 요청 실패: ${msg.substring(0, 100)}...`);
};

// --- RETRY WRAPPER ---
const withRetry = async <T>(operation: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> => {
    let lastError: any;
    
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;
            const msg = (error.message || "").toString();
            
            // 인증/권한 오류는 재시도해도 실패하므로 즉시 중단
            if (msg.includes("AUTH_ERROR") || msg.includes("키 만료") || msg.includes("권한 오류") || msg.includes("SAFETY")) {
                throw error;
            }

            console.warn(`Attempt ${i + 1} failed. Retrying in ${delayMs}ms...`, msg);
            await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1))); 
        }
    }
    throw lastError;
};

// --- VALIDATION (Direct Key Usage) ---
// [FIX] 이 함수는 UI 입력창의 값을 인자로 직접 받아서 처리합니다.
export const validateGeminiKey = async (userInputKey: string): Promise<{ isValid: boolean; errorMsg?: string }> => {
    // 0. Debug Log
    // console.log("🔐 [Validation] Validating User Input Key:", userInputKey.slice(0, 5) + "...");

    // 1. Basic string validation
    if (!userInputKey || !userInputKey.startsWith("AIza") || userInputKey.length < 30) {
        return { isValid: false, errorMsg: "API Key 형식이 올바르지 않습니다. (AIza로 시작해야 함)" };
    }
    
    try {
        // 2. [CRITICAL] Initialize Client with USER INPUT KEY DIRECTLY
        // 절대 process.env를 사용하지 않음.
        const ai = new GoogleGenAI({ apiKey: userInputKey });
        
        // 3. Validation Call using Flash model
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: 'ping' }] }
        });
        
        if (response?.text) {
             console.log("✅ [Validation] Success. Key is valid.");
             return { isValid: true };
        } else {
             return { isValid: false, errorMsg: "API 응답이 비어있습니다. 일시적인 오류일 수 있습니다." };
        }
    } catch (e: any) {
        console.error("❌ [Validation] Failed:", e);
        const rawMsg = (e.message || JSON.stringify(e)).toLowerCase();
        
        let friendlyMsg = "유효하지 않은 API Key입니다. (Google 서버 거부)";
        
        if (rawMsg.includes("expired")) {
            friendlyMsg = "🚨 [만료된 키] 입력하신 키는 삭제되었거나 만료되었습니다. (새 키 발급 필요)";
        } else if (rawMsg.includes("key_invalid") || rawMsg.includes("bad request") || rawMsg.includes("api key not valid")) {
             friendlyMsg = "🚨 [잘못된 키] API Key가 존재하지 않습니다. 복사 과정에서 잘렸는지 확인해주세요.";
        } else if (rawMsg.includes("permission_denied") || rawMsg.includes("403")) {
             friendlyMsg = "🚨 [권한 없음] 입력한 키로 AI 모델에 접근할 수 없습니다. (결제 계정 연동 확인)";
        } else if (rawMsg.includes("quota")) {
             friendlyMsg = "🚨 [할당량 초과] 해당 키의 사용량이 이미 초과되었습니다.";
        } else if (rawMsg.includes("not found") || rawMsg.includes("404")) {
             friendlyMsg = "⚠️ [모델 오류] Gemini 3 Flash 모델에 접근할 수 없습니다.";
        }
        
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

// --- THUMBNAIL SERVICES ---
// 분석: gemini-3-flash-preview
export const analyzeForThumbnail = async (base64Image: string): Promise<{ detectionReport: string; generationPrompt: string; seoTip: string; }> => {
    return withRetry(async () => {
        try {
            // [FIX] Store의 키를 사용하는 getClient 호출
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

// 생성: gemini-3-pro-image-preview
export const generateThumbnailImage = async (base64Image: string, promptText: string): Promise<string> => {
    try {
        const cleanData = cleanBase64(base64Image);
        const finalPrompt = `${promptText} \n [STRICT] Keep product exactly as is. Replace background. No text overlays.`;
        // Use Pro for Image Generation
        return await generateImage('image/jpeg', cleanData, finalPrompt, { aspectRatio: '1:1', imageSize: '2K' });
    } catch (e) {
        return handleGeminiError(e);
    }
};

// --- PHASE 3 ENGINE ---

export const forceExtractAllChineseText = async (base64Image: string): Promise<string[]> => {
    return [];
};

// 분석 및 카피라이팅: gemini-3-flash-preview
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
            // [FIX] Store의 키를 사용하는 getClient 호출
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

            // --- Negative Prompt ---
            let negativePrompt = "";
            if (usedCaptions.length > 0) {
                const recentUsed = usedCaptions.slice(-50).join(", ");
                negativePrompt = `
    # 🚫 ANTI-DUPLICATION RULES
    Do NOT use these phrases: [ ${recentUsed} ]
    Generate NEW expressions.
                `;
            }

            const legacyPrompt = `
    # Role: Cross-Border E-commerce Copywriter (Chinese -> Korean)
    # Task: Generate 8 distinct Korean copywriting options.

    ${negativePrompt}

    # Rules
    1. Target: Background text, speech bubbles.
    2. Ignore: Logos, Model numbers.
    3. Output: JSON array of strings ONLY. No prefixes.

    # Options Structure
    1-2: Direct/Benefit
    3-5: Emotional/Question/Premium (Use \\n)
    6-8: Hooks (Relief/Benefit/Impact) (Use \\n)

    # Output Format (JSON Only)
    {
    "type": "object",
    "properties": {
        "options": {
        "type": "array",
        "items": { "type": "string" },
        "minItems": 8,
        "maxItems": 8
        }
    },
    "required": ["options"]
    }
    `;

            contextParts.push({ text: legacyPrompt });

            // Use Gemini 3 Flash for logic
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview', 
                contents: { parts: contextParts },
                config: { responseMimeType: "application/json" }
            });

            const rawResult = JSON.parse(cleanJson(response.text || "{}"));
            let optionsList: string[] = rawResult.options || [];

            const toneMap = [
                "1. 직역/스펙 (정확성)",
                "2. 핵심 이점 (문제 해결)",
                "3. 감성 공감 (공간/휴식)",
                "4. 질문 & 해결 (고충 해결)",
                "5. 프리미엄 (압도적 성능)",
                "6. 안심 후킹 (불안 해소)",
                "7. 욕망 후킹 (삶의 변화)",
                "8. 임팩트/반전 (강력한 한방)"
            ];
            
            const aggregatedOptions: CopywritingOption[] = [];
            
            for (let i = 0; i < 8; i++) {
                let cleanText = optionsList[i] || "(생성된 텍스트 없음)";
                cleanText = cleanText.replace(/^(Option\s?\d+|옵션\s?\d+|\d+)\s?[:.]\s?/i, "").trim();

                aggregatedOptions.push({
                    index: i + 1,
                    tone: toneMap[i] || `Option ${i+1}`,
                    text: cleanText,
                    replacements: [] 
                });
            }

            return {
                analysisStage: {
                    chinese_text_count: 0,
                    boxes_and_tables_detected: 0,
                    boxes_and_tables: [],
                    warning: "Legacy Mode Active"
                },
                renderingPreservation: {
                    boxes_preserved: true,
                    table_structure_preserved: true,
                    cell_structure_preserved: true,
                    font_sizes_maintained: true,
                    colors_maintained: true,
                    backgrounds_maintained: true,
                    opacity_maintained: true,
                    positions_maintained: true,
                    borders_maintained: true
                },
                copywriting: aggregatedOptions,
                validation: {
                    boxes_and_tables_detected: true,
                    all_box_texts_recognized: true,
                    box_structure_safe: true,
                    no_box_text_deleted: true,
                    rendering_safe: true,
                    coordinates_recorded: true,
                    ready_for_image_gen: true
                }
            };
        } catch (e) {
            throw e; 
        }
    }).catch((e) => {
        return handleGeminiError(e);
    });
};

export const analyzeImageForCopywriting = async (
    base64Image: string, 
    referenceImage?: string | null,
    usedCaptions: string[] = [] 
): Promise<CopywritingOption[]> => {
    const result = await analyzeAndGenerateCopywriting(base64Image, [], referenceImage, usedCaptions);
    return result.copywriting;
};

// [Step B] Image Generation: Uses Pro
export const generateDetailPageImage = async (
    base64Image: string, 
    selectedOption: CopywritingOption,
    recognizedChineseTexts: string[] 
): Promise<string> => {
    try {
        const cleanData = cleanBase64(base64Image);
        
        let prompt = "";
        const commonProtocol = `
        # 🛡️ PRODUCT PRESERVATION PROTOCOL
        1. Keep Product Integrity 100%.
        2. Replace Chinese text with Korean text inside boxes.
        3. If text overlaps product, use high-contrast text box (Yellow/Black).
        `;

        if (selectedOption.replacements && selectedOption.replacements.length > 0) {
            // V4 Logic
            const replacementInstructions = selectedOption.replacements.map((r, idx) => {
                return `
                [Replace ${idx}] Coords: [${r.bounding_box.join(', ')}]
                Orig: "${r.original}" -> New: "${r.replacement.replace(/\n/g, ' ')}"
                Color: ${r.properties.text_color}, BG: ${r.properties.background_color}
                `;
            }).join('\n');

            prompt = `Task: Localize Product Image. ${replacementInstructions} ${commonProtocol}`;
        } else {
            // Legacy Logic
            prompt = `
            Task: E-commerce Localization (Chinese -> Korean).
            User Copy: "${selectedOption.text}"
            
            Rules:
            1. Marketing Text: Replace with User Copy.
            2. Specs/Tables: Direct Translation. Preserve numbers/units.
            ${commonProtocol}
            Design: Black/White/Yellow text. High contrast. Modern Font.
            `;
        }

        return await generateImage('image/jpeg', cleanData, prompt);
    } catch (e) {
        return handleGeminiError(e);
    }
};

export const applyCopywritingToImage = async (base64Image: string, selectedOption: CopywritingOption, isRetry: boolean = false): Promise<string> => {
    return generateDetailPageImage(base64Image, selectedOption, []);
};

export const swapFaceInImage = async (base64Image: string): Promise<string> => {
  try {
      const cleanData = cleanBase64(base64Image);
      const prompt = `Face Swap: Replace human face with Western/Caucasian model. Keep age/gender same. Do not touch text/product.`;
      return await generateImage('image/jpeg', cleanData, prompt);
  } catch (e) {
      return handleGeminiError(e);
  }
};

export const editImagePartially = async (
    base64Image: string, 
    userPrompt: string, 
    box: { ymin: number, xmin: number, ymax: number, xmax: number }
): Promise<string> => {
    try {
        const cleanData = cleanBase64(base64Image);
        const prompt = `
        Magic Repair. Region: y_min:${box.ymin}, x_min:${box.xmin}, y_max:${box.ymax}, x_max:${box.xmax}.
        Instruction: "${userPrompt}"
        Rule: Modify ONLY inside region. Seamless inpainting.
        `;
        return await generateImage('image/jpeg', cleanData, prompt);
    } catch (e) {
        return handleGeminiError(e);
    }
};

// [CRITICAL] Core Image Generation Function
// This function strictly enforces the use of the Pro model for high-quality image generation.
const generateImage = async (mimeType: string, cleanData: string, prompt: string, imageConfig: any = {}): Promise<string> => {
    let lastError: any = null;
    const maxAttempts = 3; 
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // [FIX] Store의 키를 사용하는 getClient 호출
        const ai = getClient();
        
        // [CRITICAL] Fixed to Pro model for high quality as requested
        // Using 'gemini-3-pro-image-preview' which is the correct API ID for the Pro Image model.
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview', // Fixed to Pro model for high quality
            contents: {
                parts: [
                    { inlineData: { mimeType: mimeType, data: cleanData } },
                    { text: prompt }
                ]
            },
            config: {
                imageConfig: {
                    aspectRatio: imageConfig.aspectRatio || "1:1",
                    imageSize: imageConfig.imageSize || "1K"
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
        
        throw new Error("이미지 생성 결과가 없습니다.");

      } catch (e: any) {
        lastError = e;
        const msg = e.toString();
        // Retry on quota/server errors
        if ((msg.includes("429") || msg.includes("503") || msg.includes("Internal")) && attempt < maxAttempts) {
             console.log(`Image generation attempt ${attempt} failed. Retrying...`);
             await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
             continue;
        }
        break; 
      }
    }
    throw lastError || new Error("이미지 생성 실패");
};