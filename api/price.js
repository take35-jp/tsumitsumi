// api/price.js
// JANコードからメーカー希望小売価格（税込）を取得
//
// 戦略：
//   1. Yahoo! V3  → priceLabel.fixedPrice（明示的な定価 - 最優先）
//   2. Yahoo! V3  → 複数店舗の listPrice 最頻値（正規ショップが設定する定価欄）
//   3. 楽天市場   → listPrice（参考価格）
//
// ※ 販売価格(price)・最安値は絶対使わない
// ※ 取得できない場合は price: null を返す

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

// 最頻値を返すユーティリティ（同数の場合は最小値）
function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const maxCount = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts)
    .filter(([, c]) => c === maxCount)
    .map(([v]) => parseInt(v));
  return Math.min(...candidates);
}

// ---------- Yahoo! Shopping API V3 ----------
async function fetchYahoo(jan) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${encodeURIComponent(jan)}&results=30&output=json`;
    const r = await fetch(url);
    if (!r.ok) return { fixed: null, listMode: null };
    const data = await r.json();
    const hits = (data?.hits || []).filter(h => !SKIP_WORDS.test(h.name || ""));

    // 1. fixedPrice（最も信頼できる）
    for (const item of hits) {
      const fixed = item.priceLabel?.fixedPrice;
      if (fixed && fixed > 0) return { fixed, listMode: null, source: "yahoo_fixed" };
    }

    // 2. listPrice の最頻値（正規ショップが「定価」として登録する欄）
    const listPrices = hits
      .map(h => h.priceLabel?.listPrice)
      .filter(p => p && p > 0 && p < 200000); // 20万円以上はおかしいので除外

    if (listPrices.length >= 2) {
      const m = mode(listPrices);
      if (m) return { fixed: null, listMode: m, source: "yahoo_list_mode" };
    }
    if (listPrices.length === 1) {
      return { fixed: null, listMode: listPrices[0], source: "yahoo_list_single" };
    }

    return { fixed: null, listMode: null };
  } catch (e) {
    return { fixed: null, listMode: null };
  }
}

// ---------- 楽天市場API ----------
async function fetchRakuten(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const items = (data?.Items || [])
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));

    // listPrice のみ（参考価格=定価）
    const listPrices = items
      .map(i => i.listPrice)
      .filter(p => p && p > 0 && p < 200000);

    if (listPrices.length >= 2) return { price: mode(listPrices), source: "rakuten_list_mode" };
    if (listPrices.length === 1) return { price: listPrices[0], source: "rakuten_list_single" };
    return null;
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
    const [yahooResult, rakutenResult] = await Promise.all([
      fetchYahoo(jan),
      fetchRakuten(jan),
    ]);

    // 優先順位：yahoo fixedPrice > yahoo listMode > rakuten listMode
    let best = null;
    if (yahooResult?.fixed) {
      best = { price: yahooResult.fixed, source: yahooResult.source };
    } else if (yahooResult?.listMode) {
      best = { price: yahooResult.listMode, source: yahooResult.source };
    } else if (rakutenResult?.price) {
      best = { price: rakutenResult.price, source: rakutenResult.source };
    }

    if (!best) {
      return res.status(200).json({
        jan, price: null, priceStr: null, source: null, message: "not_found",
        debug: { yahoo: yahooResult, rakuten: rakutenResult }
      });
    }

    return res.status(200).json({
      jan,
      price: best.price,
      priceStr: `¥${best.price.toLocaleString("ja-JP")}`,
      source: best.source,
      debug: { yahoo: yahooResult, rakuten: rakutenResult }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
