export const avalonEmotions = ["happy", "shy", "angry", "sad", "neutral"] as const;
export const avalonMotions = [
  "idle",
  "listen",
  "think",
  "explain",
  "wave",
  "nod",
  "disagree",
  "jump",
  "tease",
  "comfort",
  "surprise",
] as const;

export type AvalonEmotion = (typeof avalonEmotions)[number];
export type AvalonMotion = (typeof avalonMotions)[number];

export interface AvalonResponse {
  text: string;
  emotion: AvalonEmotion;
  motion: AvalonMotion;
  confidence: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const FALLBACK_RESPONSE: AvalonResponse = {
  text: "A-anu... maaf, aku lagi agak susah mikir. Coba ulang pelan-pelan ya.",
  emotion: "sad",
  motion: "idle",
  confidence: 0.2,
};

export function stripStageDirections(text: string) {
  return text.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}
