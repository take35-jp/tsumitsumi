import https from "https";

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

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error("JSON parse failed: " + raw.slice(0, 100))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("timeout")); });
    req.write(data);
    req.end();
  });
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

  try {
    const data = await httpsPost(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [
            { text: "この画像のバーコード下の数字を読んでください。13桁の数字のみ答えてください。例: 4573102642257" },
            { inline_data: { mime_type: mimeType || "image/jpeg", data: image } }
          ]
        }]
      }
    );

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jan = extractJAN(text);

    if (jan) return res.json({ jan, raw: text });
    return res.status(404).json({ error: "not found", raw: text });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
