'use client';

import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function Avatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  
  const [model, setModel] = useState<any>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  
  const mouthRef = useRef({ current: 0, target: 0, lastUpdate: 0 });

  // 1. SETUP LIVE2D
  useEffect(() => {
    if (!canvasRef.current) return;

    const app = new PIXI.Application({
      view: canvasRef.current,
      autoStart: true,
      resizeTo: window,
      backgroundAlpha: 0,
    });

    const loadScript = (src: string) => {
      return new Promise((resolve) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(true); return; }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
      });
    };

    const initLive2D = async () => {
      (window as any).PIXI = PIXI;
      try {
        await loadScript('/live2dcubismcore.min.js');
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        Live2DModel.registerTicker(PIXI.Ticker);

        // Menggunakan model Haru sebagai contoh
        const modelUrl = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json';
        const loadedModel = await Live2DModel.from(modelUrl);

        loadedModel.x = window.innerWidth / 2;
        loadedModel.y = window.innerHeight / 2 + 100;
        loadedModel.anchor.set(0.5, 0.5);
        loadedModel.scale.set(0.25);
        
        app.stage.addChild(loadedModel as any);
        setModel(loadedModel);
        setModelLoaded(true);
        setMessages([{ role: 'ai', text: 'Halo! Aku Avalon. Senang bertemu kamu lagi!' }]);

      } catch (error) {
        console.error("Gagal init Live2D:", error);
      }
    };

    initLive2D();
    return () => { app.destroy(true, true); };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // --- 2. SISTEM SUARA (GadisNeural) ---
  
// Di dalam file Avatar.tsx, cari fungsi speakText dan ganti dengan ini:

const speakText = (text: string) => {
  // 1. Batalkan suara yang sedang berjalan
  window.speechSynthesis.cancel();

  // 2. FILTER: Hapus teks di dalam kurung agar tidak dibaca (contoh: (nunduk) tidak akan disuarakan)
  const textToSpeak = text.replace(/\(.*?\)/g, '').trim();

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  
  // 3. FORCE: Gunakan 1 voice saja (GadisNeural)
  const voices = window.speechSynthesis.getVoices();
  
  // Mencari suara Gadis (Microsoft Edge/Chrome Online)
  const selectedVoice = voices.find(v => v.name.includes('Gadis')) || 
                        voices.find(v => v.lang === 'id-ID' && v.name.includes('Natural'));

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  } else {
    // Jika tidak ketemu, cari suara perempuan Indonesia manapun
    const femaleIndo = voices.find(v => v.lang === 'id-ID' && (v.name.includes('Female') || v.name.includes('Google')));
    if (femaleIndo) utterance.voice = femaleIndo;
  }

  // 4. TUNING: Sesuaikan nada untuk karakter pemalu
  utterance.pitch = 0.9;  // Sedikit rendah agar tidak terlalu melengking (lebih tenang)
  utterance.rate = 0.85;   // Bicaranya agak lambat karena dia ragu-ragu/pemalu

  utterance.onstart = () => {
    setIsSpeaking(true);
    if (PIXI.Ticker.shared) PIXI.Ticker.shared.add(animateMouth);
  };

  utterance.onend = () => {
    setIsSpeaking(false);
    if (PIXI.Ticker.shared) PIXI.Ticker.shared.remove(animateMouth);
    resetMouth();
  };

  window.speechSynthesis.speak(utterance);
};

  // Animasi Mulut (Sinkronisasi sederhana)
  const animateMouth = () => {
    if (model?.internalModel?.coreModel) {
      const core = model.internalModel.coreModel;
      const now = performance.now();
      if (now - mouthRef.current.lastUpdate > 80) {
        mouthRef.current.target = Math.random() * 0.7;
        mouthRef.current.lastUpdate = now;
      }
      mouthRef.current.current += (mouthRef.current.target - mouthRef.current.current) * 0.3;
      core.setParameterValueById('ParamMouthOpenY', mouthRef.current.current);
    }
  };

  const resetMouth = () => {
    if (model?.internalModel?.coreModel) {
      model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
    }
  };

  // --- 3. LOGIKA CHAT ---
  const handleChat = async () => {
    if (!inputText.trim() || isLoadingAI) return;

    const userMsg = inputText;
    setInputText("");
    
    const newHistory = [...messages, { role: 'user', text: userMsg }];
    setMessages(newHistory as Message[]);
    setIsLoadingAI(true);

    try {
      // Format history untuk Gemini (Mulai dari user)
      let apiHistory = newHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      const firstUserIndex = apiHistory.findIndex(msg => msg.role === 'user');
      if (firstUserIndex !== -1) apiHistory = apiHistory.slice(firstUserIndex);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: apiHistory.slice(-10) }),
      });

      const data = await response.json();
      
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
        if (model) model.motion('TapBody'); // Reaksi gerakan
        speakText(data.reply); // Putar suara GadisNeural
      }
    } catch (error) {
      console.error("Chat Error:", error);
    } finally {
      setIsLoadingAI(false);
    }
  };

  return (
    <div className="relative w-full h-screen bg-gray-950 overflow-hidden font-sans">
      {/* Background Anime Style (Optional) */}
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-900/20 to-black z-0" />
      
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />

      {/* UI Layer */}
      <div className="absolute inset-0 z-20 flex flex-col justify-end pb-12 px-4 items-center pointer-events-none">
        
        {/* Chat Box */}
        <div ref={chatContainerRef} className="w-full max-w-lg max-h-[50vh] overflow-y-auto p-4 space-y-4 pointer-events-auto mb-6 scroll-smooth">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm md:text-base shadow-xl backdrop-blur-md 
                ${msg.role === 'user' 
                  ? 'bg-cyan-600/90 text-white rounded-br-none' 
                  : 'bg-white/90 text-gray-800 rounded-bl-none border border-cyan-200'}`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isLoadingAI && (
            <div className="flex justify-start">
              <div className="bg-white/50 text-gray-800 px-4 py-2 rounded-2xl animate-pulse text-xs">Avalon sedang berpikir...</div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="w-full max-w-lg pointer-events-auto">
          <div className="bg-white/10 backdrop-blur-2xl border border-white/20 p-2 rounded-full shadow-2xl flex gap-2 items-center pl-6 pr-2">
            <input 
              type="text" 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ketik pesan..."
              className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
            />
            <button 
              onClick={handleChat} 
              disabled={isLoadingAI}
              className="bg-cyan-500 hover:bg-cyan-400 text-white p-3 rounded-full transition-all active:scale-90 disabled:grayscale"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Loading Screen */}
      {!modelLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mb-4"></div>
          <p className="text-cyan-400 tracking-widest animate-pulse">MEMUAT AVALON...</p>
        </div>
      )}
    </div>
  );
}
