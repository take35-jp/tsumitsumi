// api/price.js
// JANコードから税込希望小売価格を取得する専用API
// GET /api/price?jan=4573102616098
// 
// 取得ソース（優先順）:
//   1. Yahoo!ショッピングAPI V3 → priceLabel.fixedPrice（定価）
//   2. Yahoo!ショッピングAPI V3 → priceLabel.defaultPrice（通常価格）
//   3. 楽天商品検索API → listPrice（定価）
//   4. Yahoo!ショッピングAPI V3 → price（最安値）
//
// ※中古・ジャンクは除外し、新品の価格のみを返す

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売/i;

// ---------- Yahoo Shopping API V3 ----------
async function fetchYahooPrice(jan) {
  try {
    // JAN検索で複数件取得（新品を探すため多めに取る）
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${jan}&results=10&output=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const hits = data?.hits || [];

    // 新品だけフィルタ
    const newItems = hits.filter(h => !SKIP_WORDS.test(h.name || ""));
    const items = newItems.length > 0 ? newItems : hits;
    if (items.length === 0) return null;

    // 1. priceLabel.fixedPrice（希望小売価格）があればそれを優先
    for (const item of items) {
      const fixed = item.priceLabel?.fixedPrice;
      if (fixed && fixed > 0) {
        return { price: fixed, source: "yahoo_fixed" };
      }
    }

    // 2. priceLabel.defaultPrice（通常価格）
    for (const item of items) {
      const def = item.priceLabel?.defaultPrice;
      if (def && def > 0) {
        return { price: def, source: "yahoo_default" };
      }
    }

    // 3. 最安値 price（最後の手段）
    // 複数店舗の価格を集めて最頻値を取る（中古プレ値排除のため）
    const prices = items
      .map(h => h.price)
      .filter(p => p && p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return null;

    // 最安値より少し高い「最頻値帯」を定価とみなす
    // 中古のプレ値は高いので上位を除外、定価は多くの店で同じ価格のことが多い
    const priceCounts = {};
    prices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
    const mostCommon = Object.entries(priceCounts).sort((a, b) => b[1] - a[1])[0];
    if (mostCommon && mostCommon[1] >= 2) {
      // 2店舗以上同じ価格 → 定価の可能性が高い
      return { price: parseInt(mostCommon[0]), source: "yahoo_mode" };
    }

    // 最安値のみ
    return { price: prices[0], source: "yahoo_min" };
  } catch (e) {
    return null;
  }
}

// ---------- 楽天商品検索API ----------
async function fetchRakutenPrice(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${jan}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const items = data?.Items || [];

    // 新品だけフィルタ
    const newItems = items
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));

    if (newItems.length === 0) return null;

    // listPrice（参考価格=希望小売価格）があればそれを優先
    for (const item of newItems) {
      if (item.listPrice && item.listPrice > 0) {
        return { price: item.listPrice, source: "rakuten_list" };
      }
    }

    // itemPrice（通常価格）の最頻値
    const prices = newItems
      .map(i => i.itemPrice)
      .filter(p => p && p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return null;

    const priceCounts = {};
    prices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
    const mostCommon = Object.entries(priceCounts).sort((a, b) => b[1] - a[1])[0];
    if (mostCommon && mostCommon[1] >= 2) {
      return { price: parseInt(mostCommon[0]), source: "rakuten_mode" };
    }
    return { price: prices[0], source: "rakuten_min" };
  } catch (e) {
    return null;
  }
}

// ---------- メインハンドラ ----------
export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) {
    return res.status(400).json({ error: "jan required (min 8 digits)" });
  }

  try {
    // Yahoo と 楽天 を並行取得
    const [yahooResult, rakutenResult] = await Promise.all([
      fetchYahooPrice(jan),
      fetchRakutenPrice(jan),
    ]);

    // 優先順位で返す
    // fixed/list が最も信頼性高い（希望小売価格そのもの）
    const priority = [
      yahooResult?.source === "yahoo_fixed"   ? yahooResult  : null,
      rakutenResult?.source === "rakuten_list" ? rakutenResult : null,
      yahooResult?.source === "yahoo_default"  ? yahooResult  : null,
      rakutenResult?.source === "rakuten_mode" ? rakutenResult : null,
      yahooResult?.source === "yahoo_mode"     ? yahooResult  : null,
      rakutenResult?.source === "rakuten_min"  ? rakutenResult : null,
      yahooResult?.source === "yahoo_min"      ? yahooResult  : null,
    ].filter(Boolean);

    if (priority.length === 0) {
      return res.status(200).json({ jan, price: null, source: null, message: "not_found" });
    }

    const best = priority[0];
    return res.status(200).json({
      jan,
      price: best.price,          // 数値（税込）
      priceStr: `¥${best.price.toLocaleString("ja-JP")}`,
      source: best.source,
      // デバッグ用
      yahoo: yahooResult,
      rakuten: rakutenResult,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
