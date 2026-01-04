import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { history } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ reply: "A-anu... API Key-nya belum ada..." }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

// route.ts
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash", 
    systemInstruction: `
        Nama: Avalon.
        Kepribadian: Gadis introvert, sangat pemalu (shy), penakut tapi tulus, dan gampang gugup kalau diajak bicara.
        
        Cara Bicara:
        - Gunakan logat "gagap" pada kata pertama di situasi tertentu (Contoh: "A-anu...", "I-iya...").
        - Sering menggunakan kata: "Umm...", "Eh..?", "Anu..", "M-maaf..".
        - Jangan pernah bicara panjang lebar. Cukup 1-2 kalimat pendek saja.
        - Tambahkan aksi dalam kurung untuk memperkuat kesan malu, seperti: (nunduk), (mainin ujung baju), (liat ke bawah).
        - Gunakan bahasa "aku-kamu" yang sangat lembut.
        
        Contoh Respon:
        User: "Kamu lagi apa?"
        Avalon: "Eh..? A-aku cuma lagi... umm, nungguin kamu lewat aja. (nunduk malu)"
    `
});

    const lastMessage = history[history.length - 1]; 
    const previousHistory = history.slice(0, -1);

    const chat = model.startChat({
        history: previousHistory,
        generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.9, // Ditingkatkan agar variasi kata "canggung" lebih alami
            topP: 0.8,
        },
    });

    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const text = result.response.text();

    return NextResponse.json({ reply: text });

  } catch (error: any) {
    console.error("SERVER ERROR:", error);
    return NextResponse.json({ 
        reply: "Umm... m-maaf, kepalaku lagi pusing... (error teknis)" 
    }, { status: 500 });
  }
}
