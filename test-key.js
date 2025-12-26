// GANTI DENGAN KEY DARI GOOGLE AI STUDIO
const apiKey = "AIzaSyAukdT4IC-J6bsUMd15E5Zps3BGHZXZ5dQ"; 

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function checkAvailableModels() {
  console.log("⏳ Sedang meminta daftar model ke Google...");
  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
        console.log("❌ ERROR DARI GOOGLE:");
        console.log(data.error.message);
    } else if (data.models) {
        console.log("✅ DAFTAR MODEL YANG BISA KAMU PAKAI:");
        console.log("-------------------------------------");
        // Kita cari yang ada kata 'gemini' dan support 'generateContent'
        const validModels = data.models.filter(m => 
            m.name.includes("gemini") && 
            m.supportedGenerationMethods.includes("generateContent")
        );
        
        validModels.forEach(m => {
            // Kita ambil nama pendeknya (buang 'models/')
            console.log(`👉 "${m.name.replace('models/', '')}"`);
        });
        console.log("-------------------------------------");
        console.log("Pilih salah satu nama di atas untuk dipasang di route.ts!");
    } else {
        console.log("⚠️ Tidak ada model ditemukan (Aneh).");
        console.log(data);
    }
  } catch (error) {
    console.log("❌ GAGAL KONEKSI:", error);
  }
}

checkAvailableModels();