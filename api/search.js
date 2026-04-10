export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① Open Food Facts（APIキー不要）
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${jan}.json`;
    const r = await fetch(url, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    if (data.status === 1) {
      const p = data.product;
      const name = p.product_name_ja || p.product_name || p.abbreviated_product_name || "";
      if (name) {
        return res.json({
          name,
          photoUrl: p.image_front_url || p.image_url || "",
          price: "",
        });
      }
    }
  } catch (e) {}

  // ② UPC Item DB（APIキー不要・無料枠あり）
  try {
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${jan}`;
    const r = await fetch(url, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    const item = data?.items?.[0];
    if (item?.title) {
      return res.json({
        name: item.title,
        photoUrl: item.images?.[0] || "",
        price: item.offers?.[0]?.price ? String(Math.round(item.offers[0].price)) : "",
      });
    }
  } catch (e) {}

  // ③ Barcode Lookup（APIキー不要）
  try {
    const url = `https://www.barcodelookup.com/${jan}`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html"
      }
    });
    const html = await r.text();
    const nameMatch = html.match(/<h4[^>]*>([^<]{3,80})<\/h4>/);
    const imgMatch = html.match(/product-image[^>]*src="([^"]+)"/);
    if (nameMatch?.[1]) {
      return res.json({
        name: nameMatch[1].trim(),
        photoUrl: imgMatch?.[1] || "",
        price: "",
      });
    }
  } catch (e) {}

  return res.status(404).json({ error: "not found" });
}
