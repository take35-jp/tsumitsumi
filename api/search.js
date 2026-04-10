const RAKUTEN_APP_ID = "42e3f5e9-0e32-4e0d-b5e3-2df6b593b6ff";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① 楽天市場API - JANコードをキーワードで検索
  try {
    const url = new URL("https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601");
    url.searchParams.set("applicationId", RAKUTEN_APP_ID);
    url.searchParams.set("keyword", jan);
    url.searchParams.set("hits", "1");
    url.searchParams.set("formatVersion", "2");

    const r = await fetch(url.toString());
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ error: "parse error", raw: text.slice(0, 200) }); }

    const item = data?.Items?.[0];
    if (item?.itemName) {
      return res.json({
        name: item.itemName,
        photoUrl: item.mediumImageUrls?.[0]?.imageUrl || item.smallImageUrls?.[0]?.imageUrl || "",
        price: item.itemPrice ? String(item.itemPrice) : "",
      });
    }
    return res.status(404).json({ error: "not found", debug: data });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
