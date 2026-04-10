const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① Yahoo!ショッピングAPI（日本語・JANコード検索）
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${jan}&results=1&output=json`;
    const r = await fetch(url);
    const data = await r.json();
    const item = data?.hits?.[0];
    if (item?.name) {
      return res.json({
        name: item.name,
        photoUrl: item.image?.medium || item.image?.small || "",
        price: item.price ? String(item.price) : "",
      });
    }
  } catch (e) {}

  // ② Open Food Facts（フォールバック）
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${jan}.json`;
    const r = await fetch(url, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    if (data.status === 1) {
      const p = data.product;
      const name = p.product_name_ja || p.product_name || "";
      if (name) {
        return res.json({
          name,
          photoUrl: p.image_front_url || "",
          price: "",
        });
      }
    }
  } catch (e) {}

  // ③ UPCItemDB（フォールバック）
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

  return res.status(404).json({ error: "not found" });
}
