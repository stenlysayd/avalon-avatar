"use client";

import { SendHorizontal, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import {
  FALLBACK_RESPONSE,
  stripStageDirections,
  type AvalonResponse,
  type ChatMessage,
} from "@/lib/avalon";

type Live2DModelInstance = PIXI.DisplayObject & {
  anchor: { set: (x: number, y?: number) => void };
  scale: { set: (value: number) => void };
  expression?: (name: string) => void;
  motion?: (group: string, index?: number) => void;
  internalModel?: {
    coreModel?: {
      setParameterValueById: (id: string, value: number) => void;
    };
  };
};

type ChatBubble = ChatMessage & {
  id: string;
  emotion?: AvalonResponse["emotion"];
};

interface TtsResponse {
  audio: string | null;
  mimeType?: string;
  provider?: string;
}

const INITIAL_MESSAGE: ChatBubble = {
  id: "hello",
  role: "assistant",
  content: "Halo... aku Avalon. Senang ketemu kamu lagi. (senyum malu)",
  emotion: "shy",
};

const LIVE2D_MODEL_URL =
  process.env.NEXT_PUBLIC_LIVE2D_MODEL_URL ||
  "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json";

const FEMALE_VOICE_HINTS = [
  "gadis",
  "female",
  "wanita",
  "perempuan",
  "zira",
  "jenny",
  "aria",
  "siti",
  "ayunda",
  "damayanti",
  "google bahasa indonesia",
];

const MALE_VOICE_HINTS = ["ardi", "andika", "male", "pria", "laki", "david", "mark", "budi"];

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function cleanAssistantText(text: string) {
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

function voiceScore(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang === "id-id") score += 35;
  if (lang.startsWith("id")) score += 20;
  if (name.includes("gadis")) score += 100;
  if (name.includes("natural")) score += 10;
  if (FEMALE_VOICE_HINTS.some((hint) => name.includes(hint))) score += 45;
  if (MALE_VOICE_HINTS.some((hint) => name.includes(hint))) score -= 120;

  return score;
}

function pickFemaleVoice(voices: SpeechSynthesisVoice[]) {
  const scored = voices
    .map((voice) => ({ voice, score: voiceScore(voice) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.voice ?? null;
}

export default function Avatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mouthRef = useRef({ current: 0, target: 0, lastUpdate: 0 });

  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<ChatBubble[]>([INITIAL_MESSAGE]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  const apiMessages = useMemo<ChatMessage[]>(
    () =>
      messages
        .filter((message) => message.id !== INITIAL_MESSAGE.id)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    [messages],
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    let disposed = false;
    const app = new PIXI.Application({
      view: canvasRef.current,
      autoStart: true,
      resizeTo: window,
      backgroundAlpha: 0,
      antialias: true,
    });

    const loadScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(script);
      });

    async function initLive2D() {
      try {
        (window as typeof window & { PIXI?: typeof PIXI }).PIXI = PIXI;
        await loadScript("/live2dcubismcore.min.js");

        const { Live2DModel } = await import("pixi-live2d-display/cubism4");
        Live2DModel.registerTicker(PIXI.Ticker);

        const loadedModel = (await Live2DModel.from(LIVE2D_MODEL_URL)) as Live2DModelInstance;
        if (disposed) return;

        loadedModel.anchor.set(0.5, 0.5);
        loadedModel.scale.set(window.innerWidth < 720 ? 0.2 : 0.25);
        loadedModel.x = window.innerWidth / 2;
        loadedModel.y = window.innerHeight / 2 + (window.innerWidth < 720 ? 80 : 110);

        app.stage.addChild(loadedModel);
        modelRef.current = loadedModel;
        setModelLoaded(true);
      } catch (error) {
        console.error("LIVE2D_ERROR", error);
        setModelError("Model Live2D gagal dimuat.");
      }
    }

    initLive2D();

    const handleResize = () => {
      const model = modelRef.current;
      if (!model) return;

      model.x = window.innerWidth / 2;
      model.y = window.innerHeight / 2 + (window.innerWidth < 720 ? 80 : 110);
      model.scale.set(window.innerWidth < 720 ? 0.2 : 0.25);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      PIXI.Ticker.shared.remove(animateMouth);
      audioRef.current?.pause();
      audioContextRef.current?.close().catch(() => undefined);
      app.destroy(true, true);
      modelRef.current = null;
    };
    // animateMouth reads mutable refs only; cleanup must remove this first-render ticker callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoadingAI]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;

    const syncVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices());
    };

    syncVoices();
    window.speechSynthesis.addEventListener("voiceschanged", syncVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", syncVoices);
    };
  }, []);

  function setMouth(value: number) {
    modelRef.current?.internalModel?.coreModel?.setParameterValueById("ParamMouthOpenY", value);
  }

  function animateMouth() {
    const now = performance.now();
    const analyser = analyserRef.current;

    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      mouthRef.current.target = Math.min(0.85, average / 150);
    } else if (now - mouthRef.current.lastUpdate > 80) {
      mouthRef.current.target = Math.random() * 0.65;
      mouthRef.current.lastUpdate = now;
    }

    mouthRef.current.current += (mouthRef.current.target - mouthRef.current.current) * 0.3;
    setMouth(mouthRef.current.current);
  }

  function resetMouth() {
    mouthRef.current.current = 0;
    mouthRef.current.target = 0;
    setMouth(0);
  }

  function stopSpeech() {
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    PIXI.Ticker.shared.remove(animateMouth);
    analyserRef.current = null;
    setIsSpeaking(false);
    resetMouth();
  }

  function applyAvatarCue(response: AvalonResponse) {
    const model = modelRef.current;
    if (!model) return;

    const expressionByEmotion: Record<AvalonResponse["emotion"], string> = {
      neutral: "f00",
      happy: "f01",
      shy: "f02",
      angry: "f03",
      sad: "f04",
    };

    model.expression?.(expressionByEmotion[response.emotion]);

    if (response.motion !== "idle") {
      const motionIndex: Record<Exclude<AvalonResponse["motion"], "idle">, number> = {
        wave: 0,
        nod: 1,
        jump: 0,
      };
      model.motion?.("Tap", motionIndex[response.motion]);
    }
  }

  async function playServerAudio(audioBase64: string, mimeType = "audio/mpeg") {
    stopSpeech();

    const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
    audioRef.current = audio;

    audio.onplay = () => {
      setIsSpeaking(true);

      try {
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
        const context = audioContextRef.current ?? new AudioContextConstructor();
        audioContextRef.current = context;

        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        const source = context.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(context.destination);
        analyserRef.current = analyser;
      } catch {
        analyserRef.current = null;
      }

      PIXI.Ticker.shared.add(animateMouth);
    };

    audio.onended = stopSpeech;
    audio.onerror = stopSpeech;

    await audio.play();
  }

  async function speakInBrowser(text: string) {
    stopSpeech();

    const textToSpeak = stripStageDirections(text);
    if (!textToSpeak || !("speechSynthesis" in window)) return;

    let voices = availableVoices.length ? availableVoices : window.speechSynthesis.getVoices();

    if (!voices.length) {
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const timeout = window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 350);
        const handleVoicesChanged = () => {
          window.clearTimeout(timeout);
          window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
          resolve(window.speechSynthesis.getVoices());
        };

        window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
      });
      setAvailableVoices(voices);
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const selectedVoice = pickFemaleVoice(voices);

    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.lang = selectedVoice?.lang || "id-ID";
    utterance.pitch = selectedVoice ? 1.08 : 1.24;
    utterance.rate = 0.9;

    utterance.onstart = () => {
      setIsSpeaking(true);
      PIXI.Ticker.shared.add(animateMouth);
    };
    utterance.onend = stopSpeech;
    utterance.onerror = stopSpeech;

    window.speechSynthesis.speak(utterance);
  }

  async function speak(text: string) {
    if (!voiceEnabled) return;

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json()) as TtsResponse;

      if (data.audio) {
        await playServerAudio(data.audio, data.mimeType);
        return;
      }
    } catch (error) {
      console.warn("TTS_FALLBACK", error);
    }

    void speakInBrowser(text);
  }

  async function handleChat() {
    const userText = inputText.trim();
    if (!userText || isLoadingAI) return;

    const userMessage: ChatBubble = {
      id: createId(),
      role: "user",
      content: userText,
    };
    const nextMessages = [...messages, userMessage];

    setInputText("");
    setMessages(nextMessages);
    setIsLoadingAI(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            ...apiMessages,
            {
              role: "user",
              content: userText,
            },
          ].slice(-12),
        }),
      });

      const data = (await response.json()) as AvalonResponse;
      const result = response.ok ? data : { ...FALLBACK_RESPONSE, ...data };
      const assistantText = cleanAssistantText(result.text || FALLBACK_RESPONSE.text);

      applyAvatarCue(result);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "assistant",
          content: assistantText,
          emotion: result.emotion,
        },
      ]);
      void speak(assistantText);
    } catch (error) {
      console.error("CHAT_CLIENT_ERROR", error);
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: "assistant",
          content: FALLBACK_RESPONSE.text,
          emotion: FALLBACK_RESPONSE.emotion,
        },
      ]);
    } finally {
      setIsLoadingAI(false);
    }
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-[#101114] font-sans text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(34,211,238,0.16),transparent_34%),linear-gradient(180deg,#14171f_0%,#08090b_100%)]" />
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end px-3 pb-5 sm:px-6 sm:pb-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-white/65">
            <span>{modelLoaded ? "Avalon online" : "Memuat Avalon"}</span>
            <button
              type="button"
              onClick={() => {
                if (voiceEnabled) stopSpeech();
                setVoiceEnabled((enabled) => !enabled);
              }}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white/80 backdrop-blur transition hover:bg-white/10"
              aria-label={voiceEnabled ? "Matikan suara" : "Nyalakan suara"}
              title={voiceEnabled ? "Matikan suara" : "Nyalakan suara"}
            >
              {voiceEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>
          </div>

          <div
            ref={chatContainerRef}
            className="pointer-events-auto max-h-[44vh] overflow-y-auto rounded-md border border-white/10 bg-black/25 p-3 shadow-2xl backdrop-blur-md sm:p-4"
          >
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[86%] rounded-md px-3 py-2 text-sm leading-relaxed shadow-lg sm:text-base ${
                      message.role === "user"
                        ? "bg-cyan-500 text-black"
                        : "border border-white/15 bg-white/90 text-zinc-900"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {isLoadingAI && (
                <div className="flex justify-start">
                  <div className="rounded-md border border-white/15 bg-white/80 px-3 py-2 text-sm text-zinc-800">
                    Avalon sedang berpikir...
                  </div>
                </div>
              )}

              {modelError && (
                <div className="rounded-md border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-sm text-amber-100">
                  {modelError}
                </div>
              )}
            </div>
          </div>

          <form
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-white/12 bg-zinc-950/80 p-2 shadow-2xl backdrop-blur-xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleChat();
            }}
          >
            <input
              type="text"
              value={inputText}
              maxLength={600}
              onChange={(event) => setInputText(event.target.value)}
              placeholder="Ngobrol sama Avalon..."
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/45 sm:text-base"
            />
            <button
              type="submit"
              disabled={isLoadingAI || !inputText.trim()}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-cyan-400 text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              aria-label="Kirim pesan"
              title="Kirim pesan"
            >
              <SendHorizontal size={19} />
            </button>
          </form>

          {isSpeaking && (
            <div className="mx-auto text-xs tracking-wide text-cyan-200/80">
              Avalon sedang bicara...
            </div>
          )}
        </div>
      </div>

      {!modelLoaded && !modelError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 text-sm tracking-[0.25em] text-cyan-200">
          MEMUAT AVALON
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
