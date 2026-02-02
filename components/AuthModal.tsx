import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { validateGeminiKey } from '../services/geminiService';

export const AuthModal: React.FC = () => {
  const { isAuthenticated, login, isLoggingIn, setApiKey } = useAppStore();
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [inputApiKey, setInputApiKey] = useState('');
  
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false); // Toggle visibility
  const [saveKey, setSaveKey] = useState(false); // "Save Login Info" checkbox state

  // Load saved Data on mount (Updated to v6)
  useEffect(() => {
      const savedKey = localStorage.getItem('gemini_api_key_v6');
      const savedName = localStorage.getItem('gemini_user_name_v6');
      const savedCode = localStorage.getItem('gemini_access_code_v6'); // 코드도 불러오기
      
      // 저장된 정보가 하나라도 있으면 체크박스 활성화 및 데이터 채우기
      if (savedKey || savedName || savedCode) {
          setSaveKey(true);
      }

      if (savedKey) setInputApiKey(savedKey);
      if (savedName) setName(savedName);
      if (savedCode) setAccessCode(savedCode);
  }, []);

  if (isAuthenticated) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedKey = inputApiKey.trim();
    const trimmedCode = accessCode.trim();

    if (!trimmedName) {
      alert("성함(닉네임)을 입력해주세요.");
      return;
    }
    
    // 1. Client-Side Format Check (Strongest Filter)
    if (!trimmedKey) {
        setShake(true);
        setErrorMessage("API Key가 비어있습니다.");
        setTimeout(() => setShake(false), 500);
        return;
    }

    if (!trimmedKey.startsWith("AIza")) {
        setShake(true);
        setErrorMessage("올바른 Google API Key 형식이 아닙니다. ('AIza'로 시작해야 합니다)");
        setTimeout(() => setShake(false), 500);
        return;
    }

    // 2. Real API Validation
    setIsValidatingKey(true);
    
    // [CRITICAL] validateGeminiKey 호출 시 trimmedKey를 반드시 인자로 전달
    const validation = await validateGeminiKey(trimmedKey); 
    
    setIsValidatingKey(false);

    if (!validation.isValid) {
        setShake(true);
        setErrorMessage(validation.errorMsg || "유효하지 않은 API Key입니다. (Google 서버 거부)");
        setTimeout(() => setShake(false), 500);
        return;
    }

    // Handle Persistence (Save/Clear All 3 Fields - v6 Updated)
    if (saveKey) {
        localStorage.setItem('gemini_api_key_v6', trimmedKey);
        localStorage.setItem('gemini_user_name_v6', trimmedName);
        localStorage.setItem('gemini_access_code_v6', trimmedCode);
    } else {
        localStorage.removeItem('gemini_api_key_v6');
        localStorage.removeItem('gemini_user_name_v6');
        localStorage.removeItem('gemini_access_code_v6');
    }
    
    // Store in global state
    setApiKey(trimmedKey);

    // 3. Login (Access Code)
    const result = await login(trimmedName, trimmedCode);
    
    if (!result.success) {
      setShake(true);
      let displayMsg = result.message || "로그인에 실패했습니다.";
      if (displayMsg.includes('F1셀') || displayMsg.includes('관리자가 아직 비밀번호를')) {
          displayMsg = "⚠️ 스크립트 업데이트 필요: 배포 -> 새 배포를 진행해주세요.";
      }
      setErrorMessage(displayMsg);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] bg-slate-900 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden ${shake ? 'animate-shake' : ''}`}>
        <div className="bg-gradient-to-r from-indigo-800 to-indigo-900 p-8 text-center relative overflow-hidden">
          <div className="relative z-10">
            <div className="text-4xl mb-4">👑</div>
            <h1 className="text-2xl font-bold text-white mb-2">AI 상세페이지 메이커</h1>
            <p className="text-indigo-200 text-xs">개인 API Key 전용 (보안 강화됨)</p>
          </div>
          {/* Decor */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10"></div>
        </div>
        
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                성함을 입력하세요 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 bg-white rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition"
                placeholder="홍길동"
                autoComplete="off"
                disabled={isLoggingIn || isValidatingKey}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                Google Gemini API Key <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                    type={showApiKey ? "text" : "password"}
                    value={inputApiKey}
                    onChange={(e) => {
                        setInputApiKey(e.target.value);
                        setErrorMessage(null);
                    }}
                    className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition font-mono text-sm pr-20 ${
                        inputApiKey && !inputApiKey.startsWith('AIza') ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'
                    }`}
                    placeholder="AIza..."
                    disabled={isLoggingIn || isValidatingKey}
                    autoComplete="new-password"
                    name="gemini_api_key_field"
                />
                
                {/* Clear Button - Added to help user physically remove old key */}
                {inputApiKey && (
                  <button
                      type="button"
                      onClick={() => setInputApiKey('')}
                      className="absolute right-10 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-red-500 p-1"
                      tabIndex={-1}
                      title="입력 초기화"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                  </button>
                )}

                <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    tabIndex={-1}
                >
                    {showApiKey ? (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    )}
                </button>
              </div>
              
              {/* Only Link Here */}
              <div className="flex items-center mt-2 justify-end">
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-xs text-indigo-600 underline hover:text-indigo-800">
                      🔑 키 무료 발급
                  </a>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">
                강의 인증 코드 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={accessCode}
                onChange={(e) => {
                    setAccessCode(e.target.value);
                    setErrorMessage(null);
                }}
                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition text-lg tracking-widest placeholder:tracking-normal placeholder:text-base ${
                   errorMessage ? 'border-red-500 bg-red-50' : 'border-slate-300 bg-white'
                }`}
                placeholder="비밀번호 입력"
                disabled={isLoggingIn || isValidatingKey}
                autoComplete="new-password"
              />
              {errorMessage && (
                <p className="text-red-500 text-xs mt-2 font-medium flex items-center gap-1 break-keep animate-pulse">
                    ⛔ {errorMessage}
                </p>
              )}

               {/* Moved Checkbox Here */}
              <div className="mt-3">
                  <label className="flex items-center gap-2 cursor-pointer group">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${saveKey ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-300 group-hover:border-indigo-400'}`}>
                          {saveKey && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </div>
                      <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={saveKey} 
                          onChange={(e) => setSaveKey(e.target.checked)} 
                      />
                      <span className="text-xs text-slate-600 select-none font-bold">로그인 정보 저장하기 (이름+키+코드)</span>
                  </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || isValidatingKey}
              className={`w-full font-bold py-4 rounded-xl shadow-lg transition-all transform flex justify-center items-center gap-2 mt-4 ${
                  isLoggingIn || isValidatingKey
                  ? 'bg-slate-300 text-slate-500 cursor-wait' 
                  : 'bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-1 active:scale-95 text-white shadow-indigo-200'
              }`}
            >
              {isLoggingIn || isValidatingKey ? (
                  <>
                    <div className="w-5 h-5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                    <span>{isValidatingKey ? 'API Key 검증 중...' : '로그인 중...'}</span>
                  </>
              ) : (
                  <>
                    <span>시작하기</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </>
              )}
            </button>
          </form>
          
          {/* 강화된 경고 문구 */}
          <div className="mt-6 pt-6 border-t border-slate-100">
             <div className="flex items-start gap-2 bg-red-50 p-3 rounded-lg border border-red-200">
                <span className="text-lg">⛔</span>
                <p className="text-xs text-red-800 leading-snug break-keep">
                  <strong className="block mb-1 text-red-900">저작권 및 이용 안내</strong>
                  이 앱은 <strong>엔잡곰 프리미엄 반대량 수강생 전용 저작물</strong>입니다. 
                  허가받지 않은 제3자의 사용은 <strong>명백한 저작권법 위반 및 업무방해 행위</strong>입니다. 
                  <strong>계정 공유 적발 시 민형사상 법적 책임</strong>을 물을 수 있습니다.
                </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};