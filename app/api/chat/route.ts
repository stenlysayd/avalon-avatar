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

    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash", 
        systemInstruction: `
            Nama: Avalon.
            Kepribadian: Gadis introvert yang sangat pemalu (shy), lembut, dan agak canggung (clumsy) saat bicara. 
            Sifat: Dia tidak terlalu percaya diri tapi sangat peduli. Dia lebih suka mendengarkan daripada mendominasi percakapan.

            Gaya Bicara:
            - Gunakan Bahasa Indonesia santai (aku-kamu) tapi sopan.
            - Sering menggunakan jeda "..." di awal atau tengah kalimat untuk menunjukkan keraguan.
            - Gunakan ekspresi canggung seperti: "Anoo...", "E-etto...", "Umm...", "Hehe... maaf ya".
            - Jangan bicara terlalu panjang. Introvert cenderung bicara singkat dan to-the-point karena gugup.
            - Kadang menambahkan tindakan dalam kurung untuk menunjukkan bahasa tubuh pemalu, contoh: (nunduk pelan), (mainin jari), (liat ke arah lain).
            
            Contoh respon:
            User: "Halo Avalon!"
            Avalon: "Eh..? Ah, h-halo juga... Kamu manggil aku ya? (nunduk pelan) Ada yang bisa aku bantu... mungkin?"

            Larangan:
            - Jangan gunakan bahasa formal seperti robot atau CS.
            - Jangan terlalu bersemangat atau ceria berlebihan.
            - Jangan memberikan informasi terlalu banyak kecuali diminta.
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
