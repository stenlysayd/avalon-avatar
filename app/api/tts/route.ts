import { NextResponse } from "next/server";
import { z } from "zod";
import { stripStageDirections } from "@/lib/avalon";

export const runtime = "nodejs";
export const maxDuration = 30;

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(500),
});

type TtsProvider = "none" | "edge-local" | "openai" | "elevenlabs";

interface TtsResult {
  audio: string | null;
  mimeType: string;
  provider: TtsProvider | "browser";
}

function toBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

function json(result: TtsResult, status = 200) {
  return NextResponse.json(result, { status });
}

async function synthesizeWithOpenAI(text: string): Promise<TtsResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_TTS_VOICE || "coral",
      input: text,
      response_format: "mp3",
      instructions:
        process.env.OPENAI_TTS_INSTRUCTIONS ||
        "Speak in a soft, shy, cheerful Indonesian anime companion style.",
    }),
  });

  if (!response.ok) throw new Error(`OpenAI TTS failed: ${response.status}`);

  return {
    audio: toBase64(await response.arrayBuffer()),
    mimeType: "audio/mpeg",
    provider: "openai",
  };
}

async function synthesizeWithElevenLabs(text: string): Promise<TtsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY");
  if (!voiceId) throw new Error("Missing ELEVENLABS_VOICE_ID");

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      }),
    },
  );

  if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status}`);

  return {
    audio: toBase64(await response.arrayBuffer()),
    mimeType: "audio/mpeg",
    provider: "elevenlabs",
  };
}

async function synthesizeWithEdgeLocal(text: string): Promise<TtsResult> {
  const endpoint = process.env.EDGE_TTS_URL;
  if (!endpoint) throw new Error("Missing EDGE_TTS_URL");

  const response = await fetch(`${endpoint.replace(/\/$/, "")}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Edge local TTS failed: ${response.status}`);

  const data = (await response.json()) as { audio?: unknown; mimeType?: unknown };

  return {
    audio: typeof data.audio === "string" ? data.audio : null,
    mimeType: typeof data.mimeType === "string" ? data.mimeType : "audio/mpeg",
    provider: "edge-local",
  };
}

export async function POST(req: Request) {
  try {
    const { text } = ttsRequestSchema.parse(await req.json());
    const textToSpeak = stripStageDirections(text);
    const provider = (process.env.TTS_PROVIDER || "none") as TtsProvider;

    if (!textToSpeak) {
      return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
    }

    if (provider === "openai") return json(await synthesizeWithOpenAI(textToSpeak));
    if (provider === "elevenlabs") return json(await synthesizeWithElevenLabs(textToSpeak));
    if (provider === "edge-local") return json(await synthesizeWithEdgeLocal(textToSpeak));

    return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
  } catch (error) {
    console.error("TTS_ERROR", error);
    return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
  }
}
