import React, { useEffect, useState } from 'react';
import { Workspace } from './components/Workspace';
import { ThumbnailMaker } from './components/ThumbnailMaker';
import { useAppStore } from './store/useAppStore';
import { AuthModal } from './components/AuthModal';

const App: React.FC = () => {
  // Fix: use globalError instead of error to match store definition
  const { 
    globalError, 
    setGlobalError, 
    isAuthenticated, 
    userName, 
    logout, 
    apiKey, 
    restoreSession,
    serverLogout,
    isThumbnailSkipped // 상태 구독 추가 (화면 전환 트리거)
  } = useAppStore();

  const [isCloudRun, setIsCloudRun] = useState(false);

  useEffect(() => {
    // [COST SAFETY CHECK]
    // 만약 이 앱이 Cloud Run(*.run.app)이나 App Engine(*.appspot.com)에서 실행되면
    // 즉시 경고를 띄우고 작동을 멈춥니다. 이는 개발자의 서버 비용 발생을 막기 위함입니다.
    const hostname = window.location.hostname;
    if (hostname.includes('run.app') || hostname.includes('appspot.com')) {
        setIsCloudRun(true);
    }

    // 1. Try to restore session from sessionStorage on load
    restoreSession();

    // 2. Ensure server is notified on close/refresh to prevent false conflict counts
    const handleUnload = () => {
       useAppStore.getState().serverLogout();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [restoreSession]);

  // Determine error type for UI Logic
  const isAuthError = globalError && (
      globalError.includes("키 만료") || 
      globalError.includes("권한 오류") || 
      globalError.includes("API Key") ||
      globalError.includes("AUTH_ERROR")
  );

  // [SAFETY LOCK] Cloud Run 감지 시 앱 차단 화면 렌더링
  if (isCloudRun) {
      return (
          <div className="min-h-screen bg-red-900 text-white flex flex-col items-center justify-center p-8 text-center">
              <div className="text-6xl mb-4">💸</div>
              <h1 className="text-4xl font-bold mb-4">긴급: 배포 환경 경고</h1>
              <div className="bg-red-800 p-6 rounded-xl max-w-2xl border-2 border-red-400">
                  <p className="text-xl font-bold mb-4">
                      현재 Cloud Run(서버 방식)에서 실행되고 있습니다.
                  </p>
                  <p className="mb-4 leading-relaxed opacity-90">
                      이 방식은 <strong>서버 비용(Instance Cost)</strong>이 발생합니다.<br/>
                      비용을 0원으로 만드려면 즉시 이 서비스를 삭제하고,<br/>
                      <strong>Vercel, Netlify, GitHub Pages</strong> 같은 정적 호스팅(Static Hosting)을 이용하세요.
                  </p>
                  <p className="text-sm bg-black/30 p-2 rounded">
                      (이 안전 장치는 개발자님의 지갑을 보호하기 위해 작동합니다)
                  </p>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20 relative">
      
      {/* Authentication Modal */}
      <AuthModal />

      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm h-16">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 h-full">
          <div className="flex justify-between items-center h-full">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👑</span>
              <span className="font-bold text-xl tracking-tight text-slate-900">
                부업왕 부킹 <span className="text-primary-600">AI 변환기</span>
                <span className="ml-2 text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200 align-middle">v4.2 Safe</span>
              </span>
            </div>
            
            {/* Right Side: Status Indicator */}
            <div className="flex items-center gap-4">
              {isAuthenticated && (
                <div className="flex items-center gap-3 animate-fade-in">
                   <div className="hidden md:flex flex-col items-end mr-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Google Gemini Pro</span>
                      
                      {/* Enhanced Status Indicator showing User Key */}
                      <div className="flex items-center gap-1.5 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                         <span className="text-xs">🔑</span>
                         <span className="text-xs font-bold text-indigo-700">
                             개인 Key 사용 중 (..{apiKey ? apiKey.slice(-4) : '????'})
                         </span>
                         <span className="relative flex h-2 w-2 ml-1">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                         </span>
                      </div>
                   </div>
                   <div className="h-8 w-px bg-slate-200 hidden md:block"></div>
                   <div className="flex items-center gap-2 pl-2">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md ring-2 ring-white">
                         {userName ? userName.substring(0,1) : 'U'}
                      </div>
                      <div className="hidden sm:flex flex-col">
                        <span className="text-sm font-bold text-slate-700">
                            {userName}님
                        </span>
                        <button 
                            onClick={logout} 
                            className="text-xs text-red-400 hover:text-red-600 hover:underline text-left"
                        >
                            로그아웃
                        </button>
                      </div>
                   </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Error Toast with Context-Aware Actions */}
        {globalError && (
          <div className={`fixed top-20 right-4 z-50 text-white px-6 py-5 rounded-xl shadow-2xl animate-shake max-w-sm border-2 ${isAuthError ? 'bg-red-600 border-red-400' : 'bg-orange-500 border-orange-300'}`}>
            <div className="font-bold mb-2 flex items-center gap-2">
                <span>{isAuthError ? '🚫' : '⚠️'}</span> 
                {isAuthError ? '인증 오류 (키 확인 필요)' : '서버 통신 오류'}
            </div>
            <div className="text-sm opacity-95 leading-relaxed break-keep mb-4">
                {globalError}
            </div>
            
            <div className={`flex gap-2 justify-end pt-2 border-t ${isAuthError ? 'border-red-500/50' : 'border-orange-400/50'}`}>
                {/* Auth Error: Show Logout */}
                {isAuthError && (
                    <button 
                        onClick={() => {
                            logout();
                            setGlobalError(null);
                            window.location.reload(); 
                        }}
                        className="text-xs bg-white text-red-600 px-3 py-1.5 rounded-lg font-bold hover:bg-red-50 transition-colors shadow-sm"
                    >
                        로그아웃 및 키 재설정
                    </button>
                )}
                
                {/* Traffic/Server Error: Show Close only */}
                <button 
                    onClick={() => setGlobalError(null)} 
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${isAuthError ? 'bg-red-700 hover:bg-red-800' : 'bg-white text-orange-600 hover:bg-orange-50 font-bold'}`}
                >
                    {isAuthError ? '닫기' : '알겠습니다 (잠시 후 재시도)'}
                </button>
            </div>
          </div>
        )}

        {/* 
           [CRITICAL] Conditional Rendering Logic
           - isThumbnailSkipped가 false면: 썸네일 메이커 (Step 0)
           - isThumbnailSkipped가 true면: 메인 워크스페이스 (Step 1, 2)
           - 키(key)를 부여하여 상태 변경 시 컴포넌트를 완전히 새로 그립니다.
        */}
        {!isThumbnailSkipped ? (
          <ThumbnailMaker key="step-0-thumbnail-maker" />
        ) : (
          <Workspace key="step-workspace" />
        )}

        <div className="text-center mt-12 text-slate-300 text-[10px] space-y-1">
           <p>100% Client-Side Serverless Architecture • 0% Data Storage on Server</p>
           <p>Powered by Google Gemini 3 Pro • Secure BYOK (Bring Your Own Key) System</p>
           <p className="text-slate-200">개발자 비용 발생 없음 (No Server Cost)</p>
        </div>

      </main>
    </div>
  );
};

export default App;