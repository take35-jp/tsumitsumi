//new
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

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { resolve({ status: res.statusCode, body: raw.slice(0, 200) }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(9000, () => { req.destroy(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

  // 429の場合は15秒待ってリトライ
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await httpsPost(
        "generativelanguage.googleapis.com",
        `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [
              { text: "この画像にあるバーコードの下に書かれている数字を読んでください。数字のみを答えてください。" },
              { inline_data: { mime_type: "image/jpeg", data: image } }
            ]
          }]
        }
      );

      if (result.status === 429) {
        if (attempt === 0) { await sleep(15000); continue; }
        return res.status(429).json({ error: "rate limited", imageSize });
      }

      const text = result.body?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jan = extractJAN(text);

      if (jan) return res.json({ jan, raw: text, imageSize });
      return res.status(404).json({ error: "not found", raw: text, imageSize, httpStatus: result.status });
    } catch (e) {
      return res.status(500).json({ error: String(e), imageSize });
    }
  }
}
