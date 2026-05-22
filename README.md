# Avalon Avatar

Avalon Avatar is a web-based anime AI companion prototype. It combines:

- Next.js App Router
- Live2D rendering with PixiJS
- Groq chat responses with a strict Avalon JSON contract
- Optional server-side TTS providers
- Browser speech fallback for Vercel deployments
- Live2D zip loading with browser-side saved model selection

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

Set this in `.env.local` locally and in Vercel Project Settings for deploys:

```bash
GROQ_API_KEY=...
```

Optional:

```bash
GROQ_MODEL=llama-3.1-8b-instant
NEXT_PUBLIC_LIVE2D_MODEL_URL=https://example.com/model.model3.json
```

## TTS Modes

The recommended free setup is Edge TTS with the Indonesian female `GadisNeural` voice. It runs through a small serverless package, does not use your GPU, and does not download a local AI model.

```bash
TTS_PROVIDER=edge
EDGE_TTS_VOICE=id-ID-GadisNeural
EDGE_TTS_RATE=+8%
EDGE_TTS_PITCH=+18Hz
NEXT_PUBLIC_TTS_MODE=stream
```

Use this only when you want the lowest delay and accept browser-dependent voice quality:

```bash
NEXT_PUBLIC_TTS_MODE=browser
TTS_PROVIDER=none
```

`NEXT_PUBLIC_TTS_MODE=stream` uses `/api/tts?text=...` so audio can begin as chunks arrive. `server` keeps the older JSON/base64 path for compatibility.

Optional paid or limited-free server TTS modes:

```bash
TTS_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=coral
```

```bash
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
ELEVENLABS_MODEL=eleven_multilingual_v2
ELEVENLABS_STABILITY=0.42
ELEVENLABS_SIMILARITY_BOOST=0.78
ELEVENLABS_STYLE=0.45
ELEVENLABS_SPEED=1
ELEVENLABS_SPEAKER_BOOST=true
NEXT_PUBLIC_TTS_MODE=stream
```

```bash
TTS_PROVIDER=edge-local
EDGE_TTS_URL=http://127.0.0.1:5002
```

For local Edge TTS:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn tts_server:app --host 127.0.0.1 --port 5002
```

## Live2D Models

The upload button in the app can load a local Live2D Cubism 3/4 zip at runtime. The zip must contain a `.model3.json` file and its referenced `.moc3`, textures, expressions, and motions. The model is loaded through temporary browser object URLs, so it does not permanently extract anything onto your SSD and does not need to be committed to GitHub.

For production, host your chosen Avalon model somewhere stable and set:

```bash
NEXT_PUBLIC_LIVE2D_MODEL_URL=https://example.com/avalon.model3.json
```

Uploaded zip models are saved in the browser's IndexedDB after a successful load, so the same browser can pick them again from the model dropdown without reuploading. The saved zip stays on that device/browser profile; it is not uploaded to GitHub, Vercel, or your server.

The avatar can also be dragged on the canvas. Use the slider button in the app to fine-tune size and X/Y position; those settings are saved in `localStorage`.

Avalon maps each chat response to an expression and gesture cue, then tries the closest motion group in the loaded model. If a custom model has expression names or motion groups for things like think, talk, wave, nod, surprise, smile, blush, or angry, the app will use them; otherwise it falls back to procedural head, body, eye, mouth, and arm parameters where the model exposes those Live2D params.

If a custom model still appears too large or too small across all users, tune the default multiplier without code changes:

```bash
NEXT_PUBLIC_AVATAR_SCALE=0.85
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
```

## Notes

- Do not commit API keys. `.env*` files are ignored, while `.env.example` is intentionally tracked.
- The default Live2D model is a public Haru sample. Replace it through the upload button or `NEXT_PUBLIC_LIVE2D_MODEL_URL`.
- `/api/chat` includes basic input validation and in-memory rate limiting. For serious public traffic, add durable rate limiting such as Upstash Redis or Vercel Firewall rules.
