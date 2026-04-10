const RAKUTEN_APP_ID = "42e3f5e9-0e32-4e0d-b5e3-2df6b593b6ff";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① 楽天市場API
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${jan}&hits=1&formatVersion=2`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const item = data?.Items?.[0];
      if (item?.itemName) {
        return res.json({
          name: item.itemName,
          photoUrl: item.mediumImageUrls?.[0] || item.smallImageUrls?.[0] || "",
          price: item.itemPrice ? String(item.itemPrice) : "",
        });
      }
    }
  } catch (_) {}

  // ② 楽天ブックスAPI
  try {
    const url = `https://app.rakuten.co.jp/services/api/BooksTotal/Search/20170404?applicationId=${RAKUTEN_APP_ID}&jan=${jan}&hits=1&formatVersion=2`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const item = data?.Items?.[0];
      const name = item?.title || item?.itemName || "";
      if (name) {
        return res.json({
          name,
          photoUrl: item.largeImageUrl || item.mediumImageUrl || "",
          price: item.itemPrice ? String(item.itemPrice) : "",
        });
      }
    }
  } catch (_) {}

  return res.status(404).json({ error: "not found" });
}
