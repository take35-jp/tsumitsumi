// api/price.js
// JANコードから「税込メーカー希望小売価格」を取得する専用API
// GET /api/price?jan=4573102616098
//
// 取得ソース（信頼できるものだけ使用）:
//   1. Yahoo! V3 → priceLabel.fixedPrice  ← バンダイ等が明示的に設定した定価
//   2. 楽天市場  → listPrice              ← メーカー参考価格として登録された定価
//
// ※ 販売価格・最安値・最頻値は使用しない（プレ値・セール価格が混入するため）
// ※ 取得できない場合は price: null を返す（ユーザーに手入力させる）

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

// ---------- Yahoo! Shopping API V3 ----------
async function fetchYahooFixedPrice(jan) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${encodeURIComponent(jan)}&results=20&output=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const hits = data?.hits || [];

    // 新品のみ
    const newItems = hits.filter(h => !SKIP_WORDS.test(h.name || ""));
    const items = newItems.length > 0 ? newItems : hits;

    // priceLabel.fixedPrice のみ使用（これがメーカー希望小売価格）
    for (const item of items) {
      const fixed = item.priceLabel?.fixedPrice;
      if (fixed && fixed > 0) {
        return { price: fixed, source: "yahoo_fixed" };
      }
    }

    // fixedPrice が取れない場合は null（販売価格は使わない）
    return null;
  } catch (e) {
    return null;
  }
}

// ---------- 楽天市場API ----------
async function fetchRakutenListPrice(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const items = (data?.Items || [])
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));

    // listPrice のみ使用（メーカー希望小売価格として楽天に登録された値）
    for (const item of items) {
      if (item.listPrice && item.listPrice > 0) {
        return { price: item.listPrice, source: "rakuten_list" };
      }
    }

    // listPrice が取れない場合は null（販売価格は使わない）
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
    // Yahoo と 楽天 を並行取得
    const [yahooResult, rakutenResult] = await Promise.all([
      fetchYahooFixedPrice(jan),
      fetchRakutenListPrice(jan),
    ]);

    // Yahoo fixedPrice → 楽天 listPrice の順で優先
    const best = yahooResult || rakutenResult;

    if (!best) {
      // 取得できなかった場合は null を返す（プレ値・販売価格は返さない）
      return res.status(200).json({
        jan,
        price: null,
        priceStr: null,
        source: null,
        message: "not_found",
      });
    }

    return res.status(200).json({
      jan,
      price: best.price,
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
