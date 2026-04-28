// /api/rakuten-books.js (v2 - 新API対応) (force redeploy)
// 楽天市場API(IchibaItem)を使ってJANコードから希望小売価格を取得する
// 「楽天ブックス」「あみあみ」「駿河屋」などの定価ベース店舗を優先する
//
// 2026/2/10 楽天API刷新対応:
//   旧: app.rakuten.co.jp + applicationId のみ
//   新: openapi.rakuten.co.jp + applicationId + accessKey + Refererヘッダー
//   旧APIは2026/5/13に完全停止予定

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601";
const REFERER = "https://tsumitsumi.vercel.app";

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
  if (!RAKUTEN_ACCESS_KEY) {
    return res.status(500).json({ error: "RAKUTEN_ACCESS_KEY not configured" });
  }

  const { jan } = req.query;
  if (!jan || !/^\d{8,14}$/.test(jan)) {
    return res.status(400).json({ error: "Invalid jan parameter" });
  }

  try {
    const params = new URLSearchParams({
      applicationId: RAKUTEN_APP_ID,
      accessKey: RAKUTEN_ACCESS_KEY,
      keyword: jan,
      hits: "30",
      format: "json",
    });

    const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
      referrer: REFERER, referrerPolicy: 'unsafe-url', headers: { Referer: REFERER },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(502).json({
        error: "Rakuten API error",
        status: response.status,
        body: body.substring(0, 500),
      });
    }

    const data = await response.json();
    const rawItems = (data.Items || []).map(w => w.Item).filter(Boolean);

    // JAN完全一致(itemCaption や janCode に含まれる)を優先
    const exactMatches = rawItems.filter(it =>
      (it.itemCaption || "").includes(jan) ||
      (it.itemName || "").includes(jan)
    );

    // 信頼できる店舗のものを抽出
    const trustedItems = rawItems.filter(it => TRUSTED_SHOPS.includes(it.shopCode));

    // 価格推定: 信頼店舗の価格中央値を希望小売価格と見なす
    let estimatedRetailPrice = null;
    const sourcePool = trustedItems.length > 0 ? trustedItems : rawItems;
    if (sourcePool.length > 0) {
      const prices = sourcePool
        .map(it => it.itemPrice)
        .filter(p => typeof p === "number" && p > 0)
        .sort((a, b) => a - b);
      if (prices.length > 0) {
        // 中央値
        const mid = Math.floor(prices.length / 2);
        estimatedRetailPrice = prices.length % 2 === 0
          ? Math.round((prices[mid - 1] + prices[mid]) / 2)
          : prices[mid];
      }
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
