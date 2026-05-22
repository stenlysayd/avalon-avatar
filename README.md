# Avalon Avatar

Avalon Avatar is a web-based anime AI companion prototype. It combines:

- Next.js App Router
- Live2D rendering with PixiJS
- Groq chat responses with a strict Avalon JSON contract
- Optional server-side TTS providers
- Browser speech fallback for Vercel deployments

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

The app works on Vercel without a Python server by falling back to browser `speechSynthesis`.

```bash
TTS_PROVIDER=none
```

Optional server TTS modes:

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

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
```

## Notes

- Do not commit API keys. `.env*` files are ignored, while `.env.example` is intentionally tracked.
- The default Live2D model is a public Haru sample. Replace it with your own Avalon model through `NEXT_PUBLIC_LIVE2D_MODEL_URL`.
- `/api/chat` includes basic input validation and in-memory rate limiting. For serious public traffic, add durable rate limiting such as Upstash Redis or Vercel Firewall rules.
