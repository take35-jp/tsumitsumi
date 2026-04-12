const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { grade } = req.query;

  const keyword = "HG ガンダム プラモデル";
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&keyword=${encodeURIComponent(keyword)}&results=5&output=json`;

  try {
    const r = await fetch(url);
    const text = await r.text();
    // 生レスポンスをそのまま返す
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
