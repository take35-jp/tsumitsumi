//new3
export const config = { runtime: "nodejs" };

function extractJAN(text) {
  const digits = text.replace(/[^0-9]/g, "");
  for (let i = 0; i <= digits.length - 13; i++) {
    const c = digits.slice(i, i + 13);
    let sum = 0;
    for (let j = 0; j < 12; j++) sum += parseInt(c[j]) * (j % 2 === 0 ? 1 : 3);
    if ((10 - (sum % 10)) % 10 === parseInt(c[12])) return c;
  }
  const m = digits.match(/\d{13}/); if (m) return m[0];
  const m8 = digits.match(/\d{8}/); if (m8) return m8[0];
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "API key not configured" });

  const { image, mimeType } = req.body;
  if (!image) return res.status(400).json({ error: "image required" });

  const imageSize = Math.round(image.length / 1024);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "この画像のバーコード下の数字を読んでください。13桁の数字のみ答えてください。" },
              { inline_data: { mime_type: "image/jpeg", data: image } }
            ]
          }]
        })
      }
    );

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jan = extractJAN(text);

    if (jan) return res.json({ jan, raw: text, imageSize });
    return res.status(404).json({ 
      error: "not found", 
      raw: text, 
      imageSize,
      httpStatus: response.status,
      fullResponse: JSON.stringify(data).slice(0, 500)
    });
  } catch (e) {
    return res.status(500).json({ error: String(e), imageSize });
  }
}
