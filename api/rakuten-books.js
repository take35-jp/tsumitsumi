// /api/rakuten-books.js
// 楽天市場API(IchibaItem)を使ってJANコードから希望小売価格を取得する
// 「楽天ブックス」「あみあみ」「駿河屋」などの定価ベース店舗を優先する

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const ENDPOINT = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601";

// 信頼できる店舗(定価ベースで売っている率が高い順)
// shopCode はそのまま rakuten のショップコード(URLに含まれる)
const TRUSTED_SHOPS = [
  "book",          // 楽天ブックス本体
  "rakutenkobo",
  "amiami",        // あみあみ
  "surugaya-a-too",// 駿河屋
  "yodobashi",     // ヨドバシ
  "joshin",        // ジョーシン
  "biccamera",     // ビックカメラ
];

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!RAKUTEN_APP_ID) {
    return res.status(500).json({ error: "RAKUTEN_APP_ID not configured" });
  }

  const { jan } = req.query;
  if (!jan || !/^\d{8,14}$/.test(jan)) {
    return res.status(400).json({ error: "Invalid jan parameter" });
  }

  try {
    const params = new URLSearchParams({
      applicationId: RAKUTEN_APP_ID,
      keyword: jan,
      hits: "30",
      sort: "+itemPrice", // 安い順
      format: "json",
      formatVersion: "2",
    });

    const url = `${ENDPOINT}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: "Rakuten API error", status: response.status, body: text.substring(0, 200) });
    }

    const data = await response.json();
    const rawItems = (data.Items || []).map((it) => ({
      name: it.itemName || "",
      price: it.itemPrice || 0,
      image: (it.mediumImageUrls && it.mediumImageUrls[0]) || null,
      shopCode: it.shopCode || "",
      shopName: it.shopName || "",
      itemUrl: it.itemUrl || "",
      reviewAverage: it.reviewAverage || 0,
    }));

    // JAN がタイトルに含まれている、 もしくは商品コードが JAN を含む結果を優先
    const exactMatches = rawItems.filter(
      (it) => it.name.includes(jan) || it.itemUrl.includes(jan)
    );

    // 信頼できるショップから定価候補を選別
    const trustedItems = (exactMatches.length > 0 ? exactMatches : rawItems).filter((it) =>
      TRUSTED_SHOPS.includes(it.shopCode)
    );

    // 定価推定: 信頼ショップの中央値を取る
    let estimatedRetailPrice = null;
    if (trustedItems.length > 0) {
      const prices = trustedItems.map((it) => it.price).sort((a, b) => a - b);
      // 中央値
      const mid = Math.floor(prices.length / 2);
      estimatedRetailPrice =
        prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid];
    }

    return res.status(200).json({
      jan,
      estimatedRetailPrice,
      trustedItemsCount: trustedItems.length,
      totalItemsCount: rawItems.length,
      exactMatchCount: exactMatches.length,
      trustedItems: trustedItems.slice(0, 10),
      otherItems: rawItems
        .filter((it) => !TRUSTED_SHOPS.includes(it.shopCode))
        .slice(0, 5),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
