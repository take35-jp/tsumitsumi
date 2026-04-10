const RAKUTEN_APP_ID = "42e3f5e9-0e32-4e0d-b5e3-2df6b593b6ff";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① 楽天市場API
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=1&formatVersion=2&sort=standard`;
    const r = await fetch(url);
    const data = await r.json();
    const item = data?.Items?.[0];
    if (item?.itemName) {
      return res.json({
        name: item.itemName,
        photoUrl: item.mediumImageUrls?.[0]?.imageUrl || item.smallImageUrls?.[0]?.imageUrl || "",
        price: item.itemPrice ? String(item.itemPrice) : "",
      });
    }
    // デバッグ用にレスポンスも返す
    return res.status(404).json({ error: "not found", debug: data });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
