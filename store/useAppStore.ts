
import { create } from 'zustand';
import { WorkItem, ThumbnailData, CopywritingOption } from '../types';
import { v4 as uuidv4 } from 'uuid'; 

// Simple ID generator helper
const generateId = () => Math.random().toString(36).substring(2, 9);

// ❗ 중요: Google Apps Script 배포 후 "웹 앱 URL"을 아래에 붙여넣으세요.
export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwDcp9VTqFXKpBjDHL2JJ-FHV8SwVoFHAw-r-vTxxy45r-JgrlKbh7Lr4e5uGu4OeE/exec"; 

// Helper: Fetch with Timeout & Privacy headers
const fetchWithTimeout = async (url: string, timeout = 1500) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { 
            signal: controller.signal,
            referrerPolicy: 'no-referrer', // 모바일 개인정보 보호 차단 우회 시도
            credentials: 'omit'
        });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
};

// Helper: IP & Location Fetcher (Robust Multi-Provider: 5 Layers)
const getClientInfo = async (): Promise<string> => {
    // 1. ipwho.is (안정적, 무료, SSL 지원)
    try {
        const response = await fetchWithTimeout('https://ipwho.is/');
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                return `${data.ip} (${data.city}, ${data.country})`;
            }
        }
    } catch (e) { }

    // 2. db-ip.com
    try {
        const response = await fetchWithTimeout('https://api.db-ip.com/v2/free/self');
        if (response.ok) {
            const data = await response.json();
            if (data.ipAddress && data.city) return `${data.ipAddress} (${data.city}, ${data.countryName})`;
        }
    } catch (e) { }

    // 3. freeipapi.com
    try {
        const response = await fetchWithTimeout('https://freeipapi.com/api/json');
        if (response.ok) {
            const data = await response.json();
            if (data.ipAddress && data.cityName) return `${data.ipAddress} (${data.cityName}, ${data.countryName})`;
        }
    } catch (e) { }

    // 4. ipinfo.io
    try {
        const response = await fetchWithTimeout('https://ipinfo.io/json');
        if (response.ok) {
            const data = await response.json();
            if (data.ip && data.city) return `${data.ip} (${data.city}, ${data.country})`;
            if (data.ip) return data.ip;
        }
    } catch (e) { }

    // 5. ipapi.co
    try {
        const response = await fetchWithTimeout('https://ipapi.co/json/');
        if (response.ok) {
            const data = await response.json();
            if (!data.error) {
                const ip = data.ip || "Unknown";
                const city = data.city || "";
                const country = data.country_name || "";
                if (city) return `${ip} (${city}, ${country})`;
                return ip;
            }
        }
    } catch (e) { }

    // Final Fallback
    try {
        const r2 = await fetchWithTimeout('https://api.ipify.org?format=json', 2000);
        const d2 = await r2.json();
        return `${d2.ip || "Unknown"} (위치 추적 불가)`;
    } catch (e2) {
        return "Unknown IP (모바일/보안 차단됨)";
    }
};

// Helper: Readable User Agent Parser
const getReadableUserAgent = () => {
    const ua = window.navigator.userAgent;
    let os = "기타 OS";
    if (ua.includes("Windows")) os = "Windows";
    else if (ua.includes("Mac") && !ua.includes("iPhone")) os = "Mac";
    else if (ua.includes("Linux") && !ua.includes("Android")) os = "Linux";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";

    let browser = "기타 브라우저";
    if (ua.includes("Chrome")) browser = "Chrome";
    else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Edg")) browser = "Edge";
    else if (ua.includes("Whale")) browser = "Naver Whale";
    else if (ua.includes("SamsungBrowser")) browser = "Samsung Internet";

    return `${os} / ${browser} [${ua}]`;
};

interface StoreState {
  // Authentication
  isAuthenticated: boolean;
  userName: string | null;
  apiKey: string | null; 
  sessionToken: string | null; 
  isLoggingIn: boolean;
  
  setApiKey: (key: string) => void;
  login: (name: string, code: string) => Promise<{ success: boolean; message?: string }>;
  checkSession: () => Promise<boolean>; 
  logout: () => void; 
  serverLogout: () => Promise<void>; 
  restoreSession: () => Promise<void>; 
  logUsage: () => Promise<void>; 

  // Thumbnail State
  thumbnail: ThumbnailData;
  isThumbnailSkipped: boolean;
  setThumbnailImage: (img: string) => void;
  updateThumbnail: (updates: Partial<ThumbnailData>) => void;
  skipThumbnail: () => void;
  resetThumbnail: () => void;

  // Context
  referenceImage: string | null;
  isReferenceSkipped: boolean;
  setReferenceImage: (img: string | null) => void;
  skipReference: () => void;

  // Batch Workflow State
  items: WorkItem[];
  marketName: string;
  globalError: string | null;
  
  // Anti-Duplication State
  usedCaptions: string[];
  addUsedCaptions: (newCaptions: string[]) => void;
  startNewProject: () => void;

  // Actions
  addItem: (originalImage: string) => void;
  updateItem: (id: string, updates: Partial<WorkItem>) => void;
  updateMultipleItems: (ids: string[], updates: Partial<WorkItem>) => void; 
  removeItem: (id: string) => void;
  clearAllItems: () => void;
  
  setMarketName: (name: string) => void;
  setGlobalError: (msg: string | null) => void;
  
  // Specific Item Actions
  setItemOptions: (id: string, options: CopywritingOption[]) => void;
  setItemSelectedOption: (id: string, option: CopywritingOption) => void;
  updateItemOptionText: (id: string, index: number, newText: string) => void;
}

export const useAppStore = create<StoreState>((set, get) => ({
  // Auth Defaults
  isAuthenticated: false,
  userName: null,
  apiKey: null,
  sessionToken: null,
  isLoggingIn: false,

  setApiKey: (key) => set({ apiKey: key }),

  login: async (name, code) => {
      const trimmedName = name.trim(); 
      const trimmedCode = code.trim();
      
      const currentApiKey = get().apiKey;
      const keyTail = currentApiKey && currentApiKey.length > 4 
          ? currentApiKey.slice(-4) 
          : '????';

      if (!GOOGLE_SCRIPT_URL) {
          return { success: false, message: "시스템 설정 오류: 서버 주소가 없습니다." };
      }

      set({ isLoggingIn: true });
      const userInfoString = await getClientInfo();
      const readableUA = getReadableUserAgent();
      const newSessionToken = uuidv4();

      try {
          const response = await fetch(GOOGLE_SCRIPT_URL, {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'login', 
                  name: trimmedName, 
                  code: trimmedCode,
                  session_token: newSessionToken,
                  key_tail: keyTail,   
                  user_ip: userInfoString, 
                  user_agent: readableUA   
              }),
              mode: 'cors', 
              headers: { 'Content-Type': 'text/plain;charset=utf-8' }
          });

          if (!response.ok) throw new Error("Network response was not ok");
          const data = await response.json();

          if (data.result === 'success') {
              sessionStorage.setItem('gemini_session_token', newSessionToken);
              sessionStorage.setItem('gemini_user_name', trimmedName);

              set({ 
                  isAuthenticated: true, 
                  userName: trimmedName, 
                  sessionToken: newSessionToken, 
                  isLoggingIn: false 
              });
              return { success: true };
          } else {
              set({ isLoggingIn: false });
              return { success: false, message: data.message || "로그인 실패" };
          }
      } catch (error) {
          set({ isLoggingIn: false });
          return { success: false, message: "서버 연결 실패" };
      }
  },

  checkSession: async () => {
      const { userName, sessionToken, logout } = get();
      if (!userName || !sessionToken || !GOOGLE_SCRIPT_URL) return true; 

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
          const response = await fetch(GOOGLE_SCRIPT_URL, {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'check_session', 
                  name: userName, 
                  session_token: sessionToken 
              }),
              mode: 'cors', 
              credentials: 'omit',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              redirect: 'follow',
              signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
               return true; 
          }

          const data = await response.json();

          if (data.result === 'mismatch') {
              alert("🔒 다른 기기(혹은 브라우저)에서 로그인이 감지되어 접속이 종료됩니다.");
              logout(); 
              return false;
          }
          return true; 

      } catch (error: any) {
          clearTimeout(timeoutId);
          return true;
      }
  },

  serverLogout: async () => {
      const { userName, sessionToken } = get();
      if (!userName || !sessionToken || !GOOGLE_SCRIPT_URL) return;

      try {
          await fetch(GOOGLE_SCRIPT_URL, {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'logout', 
                  name: userName, 
                  session_token: sessionToken 
              }),
              keepalive: true, 
              mode: 'cors',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' }
          });
      } catch (e) {
          console.warn("Server logout signal failed", e);
      }
  },

  logout: () => {
      get().serverLogout();
      // Clear v6 keys (New Version)
      localStorage.removeItem('gemini_api_key_v6');
      localStorage.removeItem('gemini_user_name_v6');
      localStorage.removeItem('gemini_access_code_v6');
      
      // Also clear old v5 keys to ensure clean slate
      localStorage.removeItem('gemini_api_key_v5');

      sessionStorage.removeItem('gemini_session_token');
      sessionStorage.removeItem('gemini_user_name');
      
      set({
          isAuthenticated: false,
          userName: null,
          apiKey: null,
          sessionToken: null,
          items: [],
          referenceImage: null,
          thumbnail: {
            originalImage: null,
            generatedImage: null,
            status: 'idle',
            analysisReport: null,
            seoTip: null,
            generationPrompt: null
          },
          isThumbnailSkipped: false,
          isReferenceSkipped: false,
          usedCaptions: [] // Reset used captions on logout
      });
  },

  restoreSession: async () => {
      const token = sessionStorage.getItem('gemini_session_token');
      const name = sessionStorage.getItem('gemini_user_name');
      // Update to v6 (Force users to re-login if they have v5)
      const apiKey = localStorage.getItem('gemini_api_key_v6');

      if (token && name && apiKey) {
          set({ 
              isAuthenticated: true, 
              userName: name, 
              sessionToken: token,
              apiKey: apiKey
          });

          const isValid = await get().checkSession();
          if (!isValid) {
              get().logout();
          }
      }
  },

  logUsage: async () => {
      const { userName } = get();
      if (!userName || !GOOGLE_SCRIPT_URL) return;

      const now = new Date();
      const kstOffset = 9 * 60 * 60 * 1000;
      const kstDateObj = new Date(now.getTime() + kstOffset);

      const yyyy = kstDateObj.getUTCFullYear();
      const mm = String(kstDateObj.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(kstDateObj.getUTCDate()).padStart(2, '0');
      const hh = String(kstDateObj.getUTCHours()).padStart(2, '0');
      const min = String(kstDateObj.getUTCMinutes()).padStart(2, '0');
      const ss = String(kstDateObj.getUTCSeconds()).padStart(2, '0');

      const kstDateStr = `${yyyy}-${mm}-${dd}`;
      const kstTimestamp = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;

      try {
          await fetch(GOOGLE_SCRIPT_URL, {
              method: 'POST',
              body: JSON.stringify({ 
                  action: 'usage', 
                  name: userName,
                  timestamp: kstTimestamp, 
                  date: kstDateStr
              }),
              mode: 'cors', 
              headers: { 'Content-Type': 'text/plain;charset=utf-8' } 
          });
      } catch (error) {
          console.warn("Usage Log Error (Ignored):", error);
      }
  },

  thumbnail: {
    originalImage: null,
    generatedImage: null,
    status: 'idle',
    analysisReport: null,
    seoTip: null,
    generationPrompt: null
  },
  isThumbnailSkipped: false,

  setThumbnailImage: (img) => set((state) => ({
    thumbnail: { ...state.thumbnail, originalImage: img, status: 'idle', generatedImage: null, analysisReport: null, seoTip: null },
    isThumbnailSkipped: false
  })),

  updateThumbnail: (updates) => set((state) => ({
    thumbnail: { ...state.thumbnail, ...updates }
  })),

  skipThumbnail: () => set({ isThumbnailSkipped: true }),
  
  resetThumbnail: () => set({ 
    thumbnail: { originalImage: null, generatedImage: null, status: 'idle', analysisReport: null, seoTip: null, generationPrompt: null },
    isThumbnailSkipped: false 
  }),

  referenceImage: null,
  isReferenceSkipped: false,
  setReferenceImage: (img) => set({ referenceImage: img, isReferenceSkipped: false }),
  skipReference: () => set({ isReferenceSkipped: true, referenceImage: null }),

  items: [],
  marketName: '',
  globalError: null,
  
  // Anti-Duplication
  usedCaptions: [],
  addUsedCaptions: (newCaptions) => set((state) => ({
      usedCaptions: [...state.usedCaptions, ...newCaptions]
  })),
  startNewProject: () => set({
      items: [],
      usedCaptions: [],
      marketName: '',
      referenceImage: null,
      isReferenceSkipped: false,
      // CRITICAL: Force reset thumbnail state and make isThumbnailSkipped false
      thumbnail: {
        originalImage: null,
        generatedImage: null,
        status: 'idle',
        analysisReport: null,
        seoTip: null,
        generationPrompt: null
      },
      isThumbnailSkipped: false 
  }),

  addItem: (originalImage) => set((state) => {
    const newItem: WorkItem = {
      id: generateId(),
      originalImage,
      generatedImage: null,
      status: 'idle',
      error: null,
      copywritingOptions: [],
      selectedOption: null
    };
    return { items: [...state.items, newItem] };
  }),

  updateItem: (id, updates) => set((state) => ({
    items: state.items.map(item => item.id === id ? { ...item, ...updates } : item)
  })),

  updateMultipleItems: (ids, updates) => set((state) => ({
    items: state.items.map(item => ids.includes(item.id) ? { ...item, ...updates } : item)
  })),

  removeItem: (id) => set((state) => ({
    items: state.items.filter(item => item.id !== id)
  })),

  clearAllItems: () => set({ items: [] }),

  setMarketName: (name) => set({ marketName: name }),
  setGlobalError: (msg) => set({ globalError: msg }),

  setItemOptions: (id, options) => set((state) => ({
    items: state.items.map(item => item.id === id ? { ...item, copywritingOptions: options } : item)
  })),

  setItemSelectedOption: (id, option) => set((state) => ({
    items: state.items.map(item => item.id === id ? { ...item, selectedOption: option } : item)
  })),

  updateItemOptionText: (id, index, newText) => set((state) => ({
    items: state.items.map(item => {
      if (item.id !== id) return item;
      const newOptions = [...item.copywritingOptions];
      
      if (newOptions[index]) {
          newOptions[index] = { ...newOptions[index], text: newText };
      }
      
      let newSelected = item.selectedOption;
      if (item.selectedOption && item.selectedOption.index === newOptions[index]?.index) {
          newSelected = newOptions[index];
      }
      return { ...item, copywritingOptions: newOptions, selectedOption: newSelected };
    })
  }))
}));
