import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  avalonEmotions,
  avalonMotions,
  FALLBACK_RESPONSE,
  type ChatMessage,
} from "@/lib/avalon";

export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_MESSAGE_CHARS = 600;
const MAX_HISTORY_ITEMS = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 18;

const responseSchema = z.object({
  text: z.string().min(1).max(320),
  emotion: z.enum(avalonEmotions),
  motion: z.enum(avalonMotions),
  confidence: z.number().min(0).max(1),
});

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

const requestSchema = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS).optional(),
  messages: z.array(chatMessageSchema).max(MAX_HISTORY_ITEMS).optional(),
  history: z.unknown().optional(),
});

const SYSTEM_PROMPT = `
You are Avalon, a web-based anime-style AI companion.

PERSONALITY:
- shy, warm, playful, curious
- gentle Indonesian "aku-kamu" speech
- short natural replies, usually 1-3 sentences
- can be slightly teasing, but never mean or aggressive
- stage directions in parentheses are allowed, but keep them short

OUTPUT RULES:
- Reply only with valid JSON.
- No markdown.
- No text outside JSON.
- Use this exact shape:
{
  "text": string,
  "emotion": "happy" | "shy" | "angry" | "sad" | "neutral",
  "motion": "idle" | "listen" | "think" | "explain" | "wave" | "nod" | "disagree" | "jump" | "tease" | "comfort" | "surprise",
  "confidence": number
}

MOTION GUIDANCE:
- Pick motion as an animation cue, not a literal command.
- Use "listen" for attentive/calm replies, "think" when pondering or unsure, and "explain" when giving detail.
- Use "wave" for greetings, "nod" for agreement/reassurance, "disagree" for gentle correction, and "jump" for excited moments.
- Use "tease" for playful teasing, "comfort" for soft support, and "surprise" for startled/curious reactions.
- Vary emotion naturally. Prefer "shy" for flustered moments and "happy" for playful moments.
- Keep text short so the voice starts quickly.
`;

let groqClient: Groq | null = null;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  groqClient ??= new Groq({ apiKey });
  return groqClient;
}

function getClientId(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "local";
}

function isRateLimited(clientId: string) {
  const now = Date.now();
  const bucket = rateBuckets.get(clientId);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function normalizeLegacyHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .map((item): ChatMessage | null => {
      if (!item || typeof item !== "object") return null;

      const candidate = item as {
        role?: unknown;
        content?: unknown;
        text?: unknown;
        parts?: Array<{ text?: unknown }>;
      };

      const content =
        typeof candidate.content === "string"
          ? candidate.content
          : typeof candidate.text === "string"
            ? candidate.text
            : typeof candidate.parts?.[0]?.text === "string"
              ? candidate.parts[0].text
              : "";

      if (!content.trim()) return null;

      return {
        role: candidate.role === "model" || candidate.role === "assistant" ? "assistant" : "user",
        content: content.slice(0, MAX_MESSAGE_CHARS),
      };
    })
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-MAX_HISTORY_ITEMS);
}

function buildMessages(payload: z.infer<typeof requestSchema>): ChatMessage[] {
  const messages: ChatMessage[] = payload.messages?.length
    ? payload.messages.map((message) => ({
        role: message.role as ChatMessage["role"],
        content: message.content,
      }))
    : normalizeLegacyHistory(payload.history);

  if (payload.message) {
    const appendedMessage: ChatMessage = { role: "user", content: payload.message };
    return [...messages, appendedMessage].slice(-MAX_HISTORY_ITEMS);
  }

  return messages.slice(-MAX_HISTORY_ITEMS);
}

export async function POST(req: Request) {
  const clientId = getClientId(req);

  if (isRateLimited(clientId)) {
    return NextResponse.json(
      {
        ...FALLBACK_RESPONSE,
        text: "Umm... pelan-pelan ya. Aku perlu napas sebentar sebelum lanjut ngobrol.",
      },
      { status: 429 },
    );
  }

  try {
    const rawPayload = await req.json();
    const payload = requestSchema.parse(rawPayload);
    const messages = buildMessages(payload);
    const lastMessage = messages.at(-1);

    if (!lastMessage || lastMessage.role !== "user") {
      return NextResponse.json(
        {
          ...FALLBACK_RESPONSE,
          text: "A-anu... aku belum nangkep pesanmu. Coba kirim satu kalimat dulu ya.",
        },
        { status: 400 },
      );
    }

    const completion = await getGroqClient().chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      temperature: 0.75,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty LLM response");

    const parsed = responseSchema.parse(JSON.parse(raw));
    return NextResponse.json(parsed);
  } catch (error) {
    console.error("CHAT_ERROR", error);
    return NextResponse.json(FALLBACK_RESPONSE, { status: 503 });
  }
}
