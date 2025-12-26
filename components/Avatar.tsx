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
  const audioRef = useRef<HTMLAudioElement | null>(null); // Player Audio Gemini

  // 1. SETUP LIVE2D (Sama seperti sebelumnya)
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
        script.onerror = () => { console.warn(`Gagal: ${src}`); resolve(false); };
        document.body.appendChild(script);
      });
    };

    const initLive2D = async () => {
      (window as any).PIXI = PIXI;
      try {
        await loadScript('/live2dcubismcore.min.js');
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        Live2DModel.registerTicker(PIXI.Ticker);

        const modelUrl = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json';
        const loadedModel = await Live2DModel.from(modelUrl);

        loadedModel.x = window.innerWidth / 2;
        loadedModel.y = window.innerHeight / 2 + 100;
        loadedModel.anchor.set(0.5, 0.5);
        loadedModel.scale.set(0.25);
        loadedModel.interactive = true;
        loadedModel.on('hit', (hitAreas: string[]) => {
            if (hitAreas.includes('body')) loadedModel.motion('TapBody');
        });

        app.stage.addChild(loadedModel as any);
        setModel(loadedModel);
        setModelLoaded(true);
        setMessages([{ role: 'ai', text: 'Halo! Aku Avalon. Siap ngobrol!' }]);

      } catch (error) {
        console.error("Gagal init:", error);
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

  // --- 2. SISTEM SUARA HYBRID (Gemini Audio / Browser Fallback) ---
  
  // A. Putar Audio File (Dari Gemini)
  const playAudio = (base64Audio: string) => {
      if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
      }

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      audioRef.current = audio;

      audio.onplay = () => {
          setIsSpeaking(true);
          PIXI.Ticker.shared.add(animateMouth);
      };

      audio.onended = () => {
          setIsSpeaking(false);
          PIXI.Ticker.shared.remove(animateMouth);
          resetMouth();
      };

      audio.play().catch(e => console.error("Gagal putar audio:", e));
  };

  // B. Browser TTS Fallback (Jika Gemini gagal kirim audio)
  const speakFallback = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Cari suara Google (Cewek)
    const voices = window.speechSynthesis.getVoices();
    const bestVoice = voices.find(v => v.lang === 'id-ID' && v.name.includes('Google')) 
                   || voices.find(v => v.lang === 'id-ID');
    if (bestVoice) utterance.voice = bestVoice;

    utterance.rate = 1.0; 
    utterance.pitch = 1.1;

    utterance.onstart = () => {
        setIsSpeaking(true);
        PIXI.Ticker.shared.add(animateMouth);
    };

    utterance.onend = () => {
        setIsSpeaking(false);
        PIXI.Ticker.shared.remove(animateMouth);
        resetMouth();
    };

    window.speechSynthesis.speak(utterance);
  };

  // Reset Mulut
  const resetMouth = () => {
      if (model?.internalModel?.coreModel) {
          model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);
          mouthRef.current.current = 0;
      }
  };

  // Animasi Mulut
  const animateMouth = () => {
      if (model?.internalModel?.coreModel) {
          const core = model.internalModel.coreModel;
          const now = performance.now();
          const mouthState = mouthRef.current;

          if (now - mouthState.lastUpdate > 100) {
              mouthState.target = Math.random() * 0.8;
              mouthState.lastUpdate = now;
          }
          mouthState.current += (mouthState.target - mouthState.current) * 0.2;
          core.setParameterValueById('ParamMouthOpenY', mouthState.current);
      }
  };

  // --- 3. LOGIKA CHAT ---
// ... kode sebelumnya ...

  const handleChat = async () => {
    if (!inputText.trim()) return;

    const userMsg = inputText;
    setInputText(""); 
    
    // 1. Update Tampilan (UI) - Biarkan user melihat semua chat termasuk sapaan
    const newHistory = [...messages, { role: 'user', text: userMsg }];
    setMessages(newHistory as Message[]); 
    setIsLoadingAI(true);

    try {
      // 2. Filter History untuk API (LOGIKA BARU DI SINI)
      // Aturan Google: History harus dimulai dari 'user'.
      // Jadi kita cari index pesan 'user' pertama, lalu potong array dari situ.
      
      let apiHistory = newHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model', // ubah 'ai' jadi 'model'
        parts: [{ text: msg.text }]
      }));

      // Cari index pertama dimana role adalah 'user'
      const firstUserIndex = apiHistory.findIndex(msg => msg.role === 'user');

      // Jika ketemu, potong array supaya dimulai dari user tersebut
      // Jika tidak ketemu (aneh), kirim array kosong (biar tidak error)
      if (firstUserIndex !== -1) {
          apiHistory = apiHistory.slice(firstUserIndex);
      } else {
          apiHistory = []; // Fallback aman
      }

      // Ambil 10 pesan terakhir saja agar hemat token
      const recentHistory = apiHistory.slice(-10);

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            history: recentHistory, 
            message: userMsg 
        }),
      });

      const data = await response.json();
      
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
        
        if (model) {
            model.motion('TapBody'); 
        }

        if (data.audio) {
            playAudio(data.audio);
        } else {
            speakFallback(data.reply);
        }
      }

    } catch (error) {
      console.error("AI Error:", error);
      speakFallback("Maaf, aku lupa tadi kita ngomongin apa.");
    } finally {
      setIsLoadingAI(false);
    }
  };

  // ... kode sesudahnya ...

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />

      <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-end pb-24 px-4 md:px-0 items-center">
        <div ref={chatContainerRef} className="w-full max-w-lg max-h-[60vh] overflow-y-auto p-4 space-y-3 pointer-events-auto scrollbar-hide mb-4">
            {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm md:text-base shadow-lg backdrop-blur-sm 
                        ${msg.role === 'user' ? 'bg-cyan-600/80 text-white rounded-br-none' : 'bg-white/80 text-gray-800 rounded-bl-none border border-white/40'}`}>
                        {msg.text}
                    </div>
                </div>
            ))}
            {isLoadingAI && <div className="flex justify-start"><div className="bg-white/50 text-gray-800 px-4 py-2 rounded-2xl rounded-bl-none text-xs animate-pulse">Sedang mengetik...</div></div>}
        </div>

        <div className="w-full max-w-lg pointer-events-auto">
            <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-2 rounded-full shadow-2xl flex gap-2 items-center pl-4">
                <input 
                    type="text" value={inputText} onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ngobrol sama Avalon..."
                    className="flex-1 bg-transparent text-white placeholder-gray-300 focus:outline-none text-sm md:text-base"
                    onKeyDown={(e) => e.key === 'Enter' && !isLoadingAI && handleChat()}
                />
                <button onClick={handleChat} disabled={isLoadingAI || isSpeaking} className="bg-cyan-500 hover:bg-cyan-400 text-white p-3 rounded-full transition-all disabled:opacity-50 disabled:scale-95 shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
                </button>
            </div>
        </div>
      </div>

      {!modelLoaded && <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black text-white"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mb-4"></div><p>Membangunkan Avalon...</p></div>}
    </div>
  );
}