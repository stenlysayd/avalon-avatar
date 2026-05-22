from fastapi import FastAPI
from pydantic import BaseModel, Field
import base64
import edge_tts

app = FastAPI()


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@app.post("/tts")
async def tts(req: TTSRequest):
    communicate = edge_tts.Communicate(
        text=req.text,
        voice="id-ID-GadisNeural",
    )

    audio_bytes = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_bytes += chunk["data"]

    return {
        "audio": base64.b64encode(audio_bytes).decode("utf-8"),
        "mimeType": "audio/mpeg",
    }
