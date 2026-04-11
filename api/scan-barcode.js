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

  // 複数のモデルを試す
  const models = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];

  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "この画像のバーコード下に書かれている数字を読んでください。13桁または8桁の数字のみを答えてください。例: 4573102642257" },
                { inline_data: { mime_type: mimeType || "image/jpeg", data: image } }
              ]
            }]
          })
        }
      );

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (text && text !== "") {
        const jan = extractJAN(text);
        if (jan) return res.json({ jan, model, raw: text });
        return res.status(404).json({ error: "not found", model, raw: text });
      }
    } catch (e) {
      continue;
    }
  }

  return res.status(500).json({ error: "all models failed" });
}
