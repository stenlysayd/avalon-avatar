import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { history } = await req.json();
    
    // AMBIL DARI ENVIRONMENT VARIABLE
    const apiKey = process.env.GEMINI_API_KEY;

    // Validasi apakah API Key ada
    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY in environment variables");
      return NextResponse.json({ 
        reply: "Duh, Avalon lagi pusing.. (API Key belum dikonfigurasi)" 
      }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        systemInstruction: `
            Kamu adalah Avalon, asisten virtual anime.
            Sifat: Ceria, perhatian, dan punya ingatan yang baik.
            Gaya Bicara: Bahasa Indonesia gaul (aku-kamu), singkat, dan ekspresif.
            Ingatlah nama dan detail yang user berikan sebelumnya.
        `
    });

    const lastMessage = history[history.length - 1]; 
    const previousHistory = history.slice(0, -1);

    const chat = model.startChat({
        history: previousHistory,
        generationConfig: {
            maxOutputTokens: 200,
        },
    });

    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const text = result.response.text();

    return NextResponse.json({ reply: text, audio: null });

  } catch (error: any) {
    console.error("SERVER ERROR:", error);
    return NextResponse.json({ 
        reply: "Aduh, ada masalah teknis nih. Coba lagi nanti ya!" 
    }, { status: 500 });
  }
}
