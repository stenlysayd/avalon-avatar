import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { Constants, EdgeTTS } from "@andresaya/edge-tts";
import { z } from "zod";
import { stripStageDirections } from "@/lib/avalon";

export const runtime = "nodejs";
export const maxDuration = 30;

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(500),
});

type TtsProvider = "none" | "edge" | "edge-local" | "openai" | "elevenlabs";
type TtsProviderSetting = TtsProvider | "auto";

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

function edgeOptions() {
  return {
    rate: process.env.EDGE_TTS_RATE || "+8%",
    pitch: process.env.EDGE_TTS_PITCH || "+18Hz",
    volume: process.env.EDGE_TTS_VOLUME || "+0%",
    outputFormat: Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
  };
}

function audioHeaders(provider: TtsProvider) {
  return {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store",
    "X-TTS-Provider": provider,
  };
}

function hasElevenLabsConfig() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

function hasOpenAiConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function hasEdgeLocalConfig() {
  return Boolean(process.env.EDGE_TTS_URL);
}

function resolveTtsProvider(): TtsProvider {
  const setting = (process.env.TTS_PROVIDER || "auto").toLowerCase() as TtsProviderSetting;

  if (setting === "none") return "none";
  if (setting === "elevenlabs" && hasElevenLabsConfig()) return "elevenlabs";
  if (setting === "openai" && hasOpenAiConfig()) return "openai";
  if (setting === "edge-local" && hasEdgeLocalConfig()) return "edge-local";

  // Auto mode also covers older templates that still leave TTS_PROVIDER=edge active.
  if (hasElevenLabsConfig()) return "elevenlabs";
  if (hasOpenAiConfig()) return "openai";
  if (hasEdgeLocalConfig()) return "edge-local";

  return "edge";
}

function openAiPayload(text: string) {
  return {
    model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
    voice: process.env.OPENAI_TTS_VOICE || "coral",
    input: text,
    response_format: "mp3",
    instructions:
      process.env.OPENAI_TTS_INSTRUCTIONS ||
      "Speak in a soft, shy, cheerful Indonesian anime companion style.",
  };
}

async function requestOpenAiAudio(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(openAiPayload(text)),
  });

  if (!response.ok) throw new Error(`OpenAI TTS failed: ${response.status}`);
  return response;
}

function elevenLabsPayload(text: string) {
  return {
    text,
    model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
    voice_settings: {
      stability: Number(process.env.ELEVENLABS_STABILITY || "0.42"),
      similarity_boost: Number(process.env.ELEVENLABS_SIMILARITY_BOOST || "0.78"),
      style: Number(process.env.ELEVENLABS_STYLE || "0.45"),
      speed: Number(process.env.ELEVENLABS_SPEED || "1"),
      use_speaker_boost: process.env.ELEVENLABS_SPEAKER_BOOST !== "false",
    },
  };
}

async function requestElevenLabsAudio(text: string) {
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
      body: JSON.stringify(elevenLabsPayload(text)),
    },
  );

  if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  return response;
}

function streamUpstreamAudio(response: Response, provider: TtsProvider) {
  if (!response.body) throw new Error(`${provider} TTS returned an empty body`);

  return new Response(response.body, {
    headers: audioHeaders(provider),
  });
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function synthesizeWithOpenAI(text: string): Promise<TtsResult> {
  const response = await requestOpenAiAudio(text);

  return {
    audio: toBase64(await response.arrayBuffer()),
    mimeType: "audio/mpeg",
    provider: "openai",
  };
}

async function synthesizeWithEdge(text: string): Promise<TtsResult> {
  const tts = new EdgeTTS();

  await tts.synthesize(escapeXml(text), process.env.EDGE_TTS_VOICE || "id-ID-GadisNeural", {
    ...edgeOptions(),
  });

  const audio = tts.toBuffer() as Buffer;

  return {
    audio: audio.toString("base64"),
    mimeType: "audio/mpeg",
    provider: "edge",
  };
}

async function synthesizeWithElevenLabs(text: string): Promise<TtsResult> {
  const response = await requestElevenLabsAudio(text);

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
    const provider = resolveTtsProvider();

    if (!textToSpeak) {
      return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
    }

    if (provider === "edge") return json(await synthesizeWithEdge(textToSpeak));
    if (provider === "openai") return json(await synthesizeWithOpenAI(textToSpeak));
    if (provider === "elevenlabs") return json(await synthesizeWithElevenLabs(textToSpeak));
    if (provider === "edge-local") return json(await synthesizeWithEdgeLocal(textToSpeak));

    return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
  } catch (error) {
    console.error("TTS_ERROR", error);
    return json({ audio: null, mimeType: "audio/mpeg", provider: "browser" });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsed = ttsRequestSchema.safeParse({
    text: searchParams.get("text") || "",
  });

  if (!parsed.success) {
    return new Response("Invalid text", { status: 400 });
  }

  const textToSpeak = stripStageDirections(parsed.data.text);
  const provider = resolveTtsProvider();

  if (!textToSpeak || provider === "none") {
    return new Response(null, { status: 204 });
  }

  try {
    if (provider === "elevenlabs") {
      return streamUpstreamAudio(await requestElevenLabsAudio(textToSpeak), "elevenlabs");
    }

    if (provider === "openai") {
      return streamUpstreamAudio(await requestOpenAiAudio(textToSpeak), "openai");
    }

    if (provider === "edge-local") {
      const result = await synthesizeWithEdgeLocal(textToSpeak);

      if (!result.audio) return new Response(null, { status: 204 });

      return new Response(Buffer.from(result.audio, "base64"), {
        headers: audioHeaders("edge-local"),
      });
    }

    const tts = new EdgeTTS();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of tts.synthesizeStream(
            escapeXml(textToSpeak),
            process.env.EDGE_TTS_VOICE || "id-ID-GadisNeural",
            edgeOptions(),
          )) {
            controller.enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          controller.close();
        } catch (error) {
          console.error("TTS_STREAM_ERROR", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: audioHeaders("edge"),
    });
  } catch (error) {
    console.error("TTS_STREAM_ERROR", error);
    return new Response("TTS provider failed", { status: 502 });
  }
}
