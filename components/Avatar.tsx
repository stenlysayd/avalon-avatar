"use client";

import JSZip, { type JSZipObject } from "jszip";
import { SendHorizontal, Upload, Volume2, VolumeX } from "lucide-react";
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

type Live2DModelConstructor = {
  registerTicker: (ticker: typeof PIXI.Ticker) => void;
  from: (source: string) => Promise<Live2DModelInstance>;
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

interface ModelCapabilities {
  expressions: string[];
  motions: Record<string, number>;
}

interface UploadedModelSource {
  url: string;
  label: string;
  objectUrls: string[];
  capabilities: ModelCapabilities;
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

const TTS_MODE = process.env.NEXT_PUBLIC_TTS_MODE || "stream";
const AVATAR_SCALE_MULTIPLIER = Number(process.env.NEXT_PUBLIC_AVATAR_SCALE || "1");

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  expressions: ["f00", "f01", "f02", "f03", "f04", "f05", "f06", "f07"],
  motions: {
    Idle: 3,
    Tap: 2,
  },
};

const EXPRESSION_HINTS: Record<AvalonResponse["emotion"], string[]> = {
  neutral: ["neutral", "normal", "default", "f00", "00"],
  happy: ["happy", "smile", "joy", "f01", "01"],
  shy: ["shy", "blush", "tere", "embarrass", "f02", "02"],
  angry: ["angry", "mad", "pout", "f03", "03"],
  sad: ["sad", "cry", "down", "f04", "04"],
};

const MOTION_HINTS: Record<AvalonResponse["motion"], string[]> = {
  idle: ["idle", "wait", "breath"],
  wave: ["wave", "hello", "greet", "tap", "body"],
  nod: ["nod", "yes", "agree", "tap", "body"],
  jump: ["jump", "happy", "excited", "tap", "body"],
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".json": "application/json",
  ".moc3": "application/octet-stream",
  ".moc": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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

function getExtension(path: string) {
  const match = path.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function normalizeZipPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function getDirectory(path: string) {
  const normalized = normalizeZipPath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index + 1);
}

function resolveZipPath(baseDir: string, target: string) {
  const pieces = normalizeZipPath(`${baseDir}${target}`).split("/");
  const resolved: string[] = [];

  for (const piece of pieces) {
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(piece);
  }

  return resolved.join("/");
}

function buildEntryLookup(zip: JSZip) {
  const lookup = new Map<string, JSZipObject>();

  zip.forEach((path, entry) => {
    if (!entry.dir) lookup.set(normalizeZipPath(path).toLowerCase(), entry);
  });

  return lookup;
}

function readCapabilities(modelJson: Record<string, unknown>): ModelCapabilities {
  const fileReferences = modelJson.FileReferences as Record<string, unknown> | undefined;
  const expressions = Array.isArray(fileReferences?.Expressions)
    ? fileReferences.Expressions.map((expression) =>
        typeof expression === "object" && expression && "Name" in expression
          ? String((expression as { Name?: unknown }).Name)
          : "",
      ).filter(Boolean)
    : [];

  const motions: Record<string, number> = {};
  const motionGroups = fileReferences?.Motions;

  if (motionGroups && typeof motionGroups === "object") {
    Object.entries(motionGroups as Record<string, unknown>).forEach(([group, entries]) => {
      motions[group] = Array.isArray(entries) ? entries.length : 0;
    });
  }

  return {
    expressions,
    motions,
  };
}

async function createUploadedModelSource(file: File): Promise<UploadedModelSource> {
  const zip = await JSZip.loadAsync(file);
  const lookup = buildEntryLookup(zip);
  const modelEntry = [...lookup.values()].find((entry) =>
    normalizeZipPath(entry.name).toLowerCase().endsWith(".model3.json"),
  );

  if (!modelEntry) {
    throw new Error("Zip tidak punya file .model3.json");
  }

  const modelDir = getDirectory(modelEntry.name);
  const modelJson = JSON.parse(await modelEntry.async("text")) as Record<string, unknown>;
  const rewrittenModelJson = JSON.parse(JSON.stringify(modelJson)) as Record<string, unknown>;
  const objectUrls: string[] = [];

  async function objectUrlFor(relativePath: unknown) {
    if (typeof relativePath !== "string" || !relativePath) return relativePath;

    const resolved = resolveZipPath(modelDir, relativePath);
    const entry = lookup.get(resolved.toLowerCase());
    if (!entry) return relativePath;

    const blob = await entry.async("blob");
    const mimeType = MIME_BY_EXTENSION[getExtension(resolved)] || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    objectUrls.push(url);
    return url;
  }

  const fileReferences = rewrittenModelJson.FileReferences as Record<string, unknown> | undefined;

  if (fileReferences) {
    fileReferences.Moc = await objectUrlFor(fileReferences.Moc);
    fileReferences.Physics = await objectUrlFor(fileReferences.Physics);
    fileReferences.Pose = await objectUrlFor(fileReferences.Pose);
    fileReferences.DisplayInfo = await objectUrlFor(fileReferences.DisplayInfo);

    if (Array.isArray(fileReferences.Textures)) {
      fileReferences.Textures = await Promise.all(fileReferences.Textures.map(objectUrlFor));
    }

    if (Array.isArray(fileReferences.Expressions)) {
      for (const expression of fileReferences.Expressions) {
        if (expression && typeof expression === "object" && "File" in expression) {
          const expressionRef = expression as { File?: unknown };
          expressionRef.File = await objectUrlFor(expressionRef.File);
        }
      }
    }

    if (fileReferences.Motions && typeof fileReferences.Motions === "object") {
      for (const motions of Object.values(fileReferences.Motions as Record<string, unknown>)) {
        if (!Array.isArray(motions)) continue;

        for (const motion of motions) {
          if (!motion || typeof motion !== "object") continue;
          const motionRef = motion as { File?: unknown; Sound?: unknown };
          motionRef.File = await objectUrlFor(motionRef.File);
          motionRef.Sound = await objectUrlFor(motionRef.Sound);
        }
      }
    }
  }

  const modelBlob = new Blob([JSON.stringify(rewrittenModelJson)], { type: "application/json" });
  const url = URL.createObjectURL(modelBlob);
  objectUrls.push(url);

  return {
    url,
    label: file.name.replace(/\.zip$/i, ""),
    objectUrls,
    capabilities: readCapabilities(modelJson),
  };
}

export default function Avatar() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const live2DModelRef = useRef<Live2DModelConstructor | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mouthRef = useRef({ current: 0, target: 0, lastUpdate: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const nextIdleMotionAtRef = useRef(0);
  const uploadedObjectUrlsRef = useRef<string[]>([]);
  const capabilitiesRef = useRef<ModelCapabilities>(DEFAULT_CAPABILITIES);
  const speakingRef = useRef(false);
  const loadingRef = useRef(false);

  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<ChatBubble[]>([INITIAL_MESSAGE]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isModelUploading, setIsModelUploading] = useState(false);
  const [modelLabel, setModelLabel] = useState("Haru sample");
  const [modelCapabilities, setModelCapabilities] =
    useState<ModelCapabilities>(DEFAULT_CAPABILITIES);

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
    speakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    loadingRef.current = isLoadingAI;
  }, [isLoadingAI]);

  useEffect(() => {
    capabilitiesRef.current = modelCapabilities;
  }, [modelCapabilities]);

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
    appRef.current = app;

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
        if (disposed) return;
        live2DModelRef.current = Live2DModel as Live2DModelConstructor;
        await loadLive2DModel(LIVE2D_MODEL_URL, "Haru sample", DEFAULT_CAPABILITIES);
      } catch (error) {
        console.error("LIVE2D_ERROR", error);
        setModelError("Model Live2D gagal dimuat.");
      }
    }

    initLive2D();

    const handleResize = () => {
      const model = modelRef.current;
      if (!model) return;

      fitModelToViewport(model);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("pointermove", handlePointerMove);
    app.ticker.add(animateAvatar);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      PIXI.Ticker.shared.remove(animateMouth);
      app.ticker.remove(animateAvatar);
      audioRef.current?.pause();
      audioContextRef.current?.close().catch(() => undefined);
      uploadedObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      app.destroy(true, true);
      appRef.current = null;
      live2DModelRef.current = null;
      modelRef.current = null;
    };
    // animation callbacks read mutable refs only; cleanup must remove these first-render callbacks.
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

  function handlePointerMove(event: PointerEvent) {
    pointerRef.current = {
      x: (event.clientX / window.innerWidth - 0.5) * 2,
      y: (event.clientY / window.innerHeight - 0.5) * 2,
    };
  }

  function scheduleNextIdleMotion() {
    nextIdleMotionAtRef.current = performance.now() + 5_000 + Math.random() * 7_000;
  }

  function fitModelToViewport(model: Live2DModelInstance) {
    const bounds = model.getLocalBounds();
    const naturalWidth = Math.max(bounds.width, 1);
    const naturalHeight = Math.max(bounds.height, 1);
    const isMobile = window.innerWidth < 720;
    const widthBudget = window.innerWidth * (isMobile ? 0.82 : 0.42);
    const heightBudget = window.innerHeight * (isMobile ? 0.54 : 0.62);
    const rawScale = Math.min(widthBudget / naturalWidth, heightBudget / naturalHeight);
    const scale = clamp(rawScale * AVATAR_SCALE_MULTIPLIER, 0.02, isMobile ? 0.38 : 0.48);

    model.scale.set(scale);
    model.x = window.innerWidth / 2;
    model.y = window.innerHeight * (isMobile ? 0.46 : 0.47);
  }

  async function loadLive2DModel(
    source: string,
    label: string,
    capabilities = DEFAULT_CAPABILITIES,
  ) {
    const app = appRef.current;
    const Live2DModel = live2DModelRef.current;

    if (!app || !Live2DModel) return;

    setModelLoaded(false);
    setModelError(null);

    const loadedModel = await Live2DModel.from(source);
    const previousModel = modelRef.current;

    if (previousModel) {
      app.stage.removeChild(previousModel);
      previousModel.destroy();
    }

    app.stage.addChild(loadedModel);
    loadedModel.anchor.set(0.5, 0.5);
    fitModelToViewport(loadedModel);
    modelRef.current = loadedModel;
    capabilitiesRef.current = capabilities;
    setModelCapabilities(capabilities);
    setModelLabel(label);
    setModelLoaded(true);
    scheduleNextIdleMotion();
  }

  function findExpression(emotion: AvalonResponse["emotion"]) {
    const expressions = capabilitiesRef.current.expressions;
    if (!expressions.length) return null;

    const hints = EXPRESSION_HINTS[emotion];
    const matched = expressions.find((expression) => {
      const name = expression.toLowerCase();
      return hints.some((hint) => name.includes(hint));
    });

    if (matched) return matched;

    const fallbackIndex: Record<AvalonResponse["emotion"], number> = {
      neutral: 0,
      happy: 1,
      shy: 2,
      angry: 3,
      sad: 4,
    };

    return expressions[fallbackIndex[emotion] % expressions.length] ?? expressions[0];
  }

  function playMotionByHints(hints: string[]) {
    const model = modelRef.current;
    const motions = capabilitiesRef.current.motions;
    const groups = Object.keys(motions).filter((group) => motions[group] > 0);

    if (!model || !groups.length) return;

    const matchedGroup =
      groups.find((group) => {
        const name = group.toLowerCase();
        return hints.some((hint) => name.includes(hint));
      }) || groups.find((group) => group.toLowerCase().includes("idle")) || groups[0];

    const count = motions[matchedGroup] || 1;
    model.motion?.(matchedGroup, Math.floor(Math.random() * count));
  }

  function animateAvatar() {
    const model = modelRef.current;
    const core = model?.internalModel?.coreModel;
    if (!core) return;

    const now = performance.now();
    const t = now / 1000;
    const pointer = pointerRef.current;
    const thinkingWeight = loadingRef.current ? 1 : 0;

    setCoreParam("ParamAngleX", pointer.x * 10 + Math.sin(t * 0.9) * 3);
    setCoreParam("ParamAngleY", -pointer.y * 6 + Math.sin(t * 0.7) * 2);
    setCoreParam("ParamAngleZ", Math.sin(t * 0.55) * 2);
    setCoreParam("ParamBodyAngleX", pointer.x * 4 + Math.sin(t * 0.4) * 1.5);
    setCoreParam("ParamEyeBallX", pointer.x * 0.45);
    setCoreParam("ParamEyeBallY", -pointer.y * 0.35);
    setCoreParam("ParamBreath", 0.5 + Math.sin(t * 1.8) * 0.25);
    setCoreParam("ParamCheek", Math.max(thinkingWeight * 0.4, 0));

    if (!speakingRef.current && now > nextIdleMotionAtRef.current) {
      playMotionByHints(["idle", "tap", "body", "wait"]);
      scheduleNextIdleMotion();
    }
  }

  function setCoreParam(id: string, value: number) {
    try {
      modelRef.current?.internalModel?.coreModel?.setParameterValueById(id, value);
    } catch {
      // Some user-supplied Live2D models do not expose every common parameter.
    }
  }

  function setMouth(value: number) {
    setCoreParam("ParamMouthOpenY", value);
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

    const expression = findExpression(response.emotion);
    if (expression) model.expression?.(expression);

    if (response.motion !== "idle") {
      playMotionByHints(MOTION_HINTS[response.motion]);
    }
  }

  async function playAudioElement(audio: HTMLAudioElement) {
    stopSpeech();

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

  async function playServerAudio(audioBase64: string, mimeType = "audio/mpeg") {
    await playAudioElement(new Audio(`data:${mimeType};base64,${audioBase64}`));
  }

  async function playStreamAudio(text: string) {
    const url = `/api/tts?text=${encodeURIComponent(stripStageDirections(text))}`;
    await playAudioElement(new Audio(url));
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

    if (TTS_MODE === "browser") {
      void speakInBrowser(text);
      return;
    }

    if (TTS_MODE === "stream") {
      try {
        await playStreamAudio(text);
        return;
      } catch (error) {
        console.warn("TTS_STREAM_FALLBACK", error);
      }
    }

    try {
      setIsSpeaking(true);
      PIXI.Ticker.shared.add(animateMouth);

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

  async function handleModelUpload(file: File | undefined) {
    if (!file) return;

    setIsModelUploading(true);
    setModelError(null);

    try {
      const source = await createUploadedModelSource(file);
      await loadLive2DModel(source.url, source.label, source.capabilities);
      uploadedObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      uploadedObjectUrlsRef.current = source.objectUrls;
    } catch (error) {
      console.error("MODEL_UPLOAD_ERROR", error);
      setModelError("Zip Live2D belum bisa dimuat. Pastikan ada file .model3.json di dalamnya.");
    } finally {
      setIsModelUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
          <div className="flex items-center justify-between gap-3 text-xs text-white/65">
            <span className="min-w-0 truncate">
              {modelLoaded ? "Avalon online" : "Memuat Avalon"} - {modelLabel}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => void handleModelUpload(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isModelUploading}
                className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white/80 backdrop-blur transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                aria-label="Muat model Live2D"
                title="Muat model Live2D"
              >
                <Upload size={16} />
              </button>
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

              {(modelError || isModelUploading) && (
                <div className="rounded-md border border-amber-300/30 bg-amber-400/15 px-3 py-2 text-sm text-amber-100">
                  {isModelUploading ? "Menyiapkan model Live2D..." : modelError}
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
