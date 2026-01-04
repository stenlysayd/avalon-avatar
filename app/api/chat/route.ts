import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    // Terima history dari frontend
    const { history } = await req.json();
    
    // API KEY (Pastikan sudah diisi/pakai env)
    // Gunakan process.env.GEMINI_API_KEY jika sudah fix, atau hardcode key baru Anda di sini
     // <-- JANGAN LUPA ISI KEY BARU
    const apiKey = "AIzaSyB-B8rnuQGT9VsVw3U2sf7kj2rzs8Lvw6I";
    if (!apiKey || apiKey.includes("MASUKKAN_KEY")) {
         throw new Error("API Key belum diisi di route.ts");
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

    // --- FITUR MEMORI (CHAT SESSION) ---
    // Pisahkan pesan terakhir (pesan user sekarang) dari history sebelumnya
    const lastMessage = history[history.length - 1]; 
    const previousHistory = history.slice(0, -1);

    // Mulai sesi chat dengan history
    const chat = model.startChat({
        history: previousHistory,
        generationConfig: {
            maxOutputTokens: 200, // Batasi biar gak kepanjangan
        },
    });

    // Kirim pesan baru
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const text = result.response.text();

    return NextResponse.json({ reply: text, audio: null });

  } catch (error: any) {
    console.error("SERVER ERROR:", error);
    return NextResponse.json({ 
        reply: `Error: ${error.message}` 
    }, { status: 500 });
  }
}
