// api/price.js
// JANコードからメーカー希望小売価格（税込）を取得
//
// 取得ソース優先順:
//   1. あみあみ API → c_price_taxed（参考価格 = メーカー希望小売価格）
//   2. Yahoo! V3   → priceLabel.fixedPrice（メーカーが設定した定価）
//
// ※ 販売価格・最安値・プレ値は絶対に返さない
// ※ 取得できない場合は price: null を返す

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

// ---------- あみあみ API ----------
// c_price_taxed = 参考価格（税込）= メーカー希望小売価格
async function fetchAmiami(jan) {
  try {
    const url = `https://api.amiami.jp/api/v1.0/items?s_jan_code=${encodeURIComponent(jan)}&lang=ja&pagemax=3`;
    const r = await fetch(url, {
      headers: {
        "X-User-Key": "amiami_dev",
        "Accept": "application/json",
      }
    });
    if (!r.ok) return null;
    const data = await r.json();
    const items = data?.items || [];

    // 新品・通常商品のみ（中古・プレ値除外）
    const newItems = items.filter(item =>
      !SKIP_WORDS.test(item.sname || "") &&
      item.condition === "0" // 0 = 新品
    );
    const targets = newItems.length > 0 ? newItems : items;

    for (const item of targets) {
      // c_price_taxed = 参考価格（メーカー希望小売価格・税込）
      const ref = item.c_price_taxed;
      if (ref && ref > 0) {
        return { price: ref, source: "amiami_ref" };
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ---------- Yahoo! Shopping API V3 ----------
// fixedPrice のみ使用（メーカーが明示的に設定した定価）
async function fetchYahooFixed(jan) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${encodeURIComponent(jan)}&results=20&output=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const hits = (data?.hits || []).filter(h => !SKIP_WORDS.test(h.name || ""));

    for (const item of hits) {
      const fixed = item.priceLabel?.fixedPrice;
      if (fixed && fixed > 0) {
        return { price: fixed, source: "yahoo_fixed" };
      }
    }
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
    // あみあみ と Yahoo を並行取得
    const [amiamiResult, yahooResult] = await Promise.all([
      fetchAmiami(jan),
      fetchYahooFixed(jan),
    ]);

    // あみあみ参考価格 → Yahoo fixedPrice の順で優先
    const best = amiamiResult || yahooResult;

    if (!best) {
      return res.status(200).json({
        jan, price: null, priceStr: null, source: null, message: "not_found",
      });
    }

    return res.status(200).json({
      jan,
      price: best.price,
      priceStr: `¥${best.price.toLocaleString("ja-JP")}`,
      source: best.source,
      amiami: amiamiResult,
      yahoo: yahooResult,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
