export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });

  // 許可するドメインを限定
  const allowed = [
    "item-shopping.c.yimg.jp",
    "shopping.c.yimg.jp",
    "item.rakuten.co.jp",
    "thumbnail.image.rakuten.co.jp",
    "images-na.ssl-images-amazon.com",
    "m.media-amazon.com",
  ];
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return res.status(400).json({ error: "invalid url" });
  }
  if (!allowed.some(d => hostname === d || hostname.endsWith("." + d))) {
    return res.status(403).json({ error: "domain not allowed" });
  }

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TsumiTsumi/1.0)",
        "Referer": "https://shopping.yahoo.co.jp/",
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: "upstream error" });

    const contentType = r.headers.get("content-type") || "image/jpeg";
    const buf = await r.arrayBuffer();

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(buf));
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
