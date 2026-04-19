// api/price.js - v7（商品名ファースト）
//
// 設計思想：
//   JANは「どの箱か」の識別子に過ぎない。再販・値上げでJANが変わっても商品名は変わらない。
//   → 商品名でYahoo検索して定価を取るのがメイン。JANは補助。
//
// 取得フロー:
//   Step1: JANでSupabaseから商品名を取得
//   Step2: 商品名でYahoo検索 → fixedPrice or listPrice（メイン）
//   Step3: JANで直接Yahoo検索 → fixedPrice or listPrice（補完）
//   ※ 販売価格(price)は絶対使わない・プレ値は返さない

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts).filter(([,c])=>c===max).map(([v])=>parseInt(v));
  return Math.min(...candidates);
}

// Yahoo検索 → fixedPrice or listPrice のみ（販売価格は使わない）
async function yahooSearch(params) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&${params}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const hits = ((await r.json())?.hits || [])
      .filter(h => !SKIP_WORDS.test(h.name || ""));

    // 1. fixedPrice（最信頼 - メーカー設定の正確な定価）
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return { price: f, source: "fixed" };
    }

    // 2. listPrice最頻値（定価欄 - 2件以上一致で信頼）
    const lists = hits.map(h => h.priceLabel?.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) {
      const m = mode(lists);
      if (m) return { price: m, source: "list_mode" };
    }
    if (lists.length === 1) return { price: lists[0], source: "list_single" };

    return null;
  } catch { return null; }
}

// Supabaseから商品情報取得
async function getProduct(jan) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}&select=name,scale,maker&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    return (await r.json())?.[0] || null;
  } catch { return null; }
}

// 商品名からYahoo検索用キーワードを生成
function makeKeywords(name, scale, maker) {
  // ノイズ除去
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  const kws = [];
  // パターン1: スケール + 商品名（最も精度高い）
  if (scale) kws.push(`${scale} ${clean.slice(0, 20)} プラモデル`);
  // パターン2: 商品名のみ
  kws.push(`${clean.slice(0, 30)} プラモデル`);
  // パターン3: メーカー名付き（コトブキヤ・タミヤ・ハセガワ等）
  const makerMap = { タミヤ:'タミヤ', ハセガワ:'ハセガワ', コトブキヤ:'コトブキヤ', アオシマ:'アオシマ', フジミ:'フジミ' };
  if (maker && makerMap[maker]) kws.push(`${makerMap[maker]} ${clean.slice(0, 20)} プラモデル`);

  return [...new Set(kws.map(k => k.trim().slice(0, 60)))];
}

export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) return res.status(400).json({ error: "jan required" });

  // Step1: JANでSupabaseから商品名取得
  const product = await getProduct(jan);

  // Step2: 商品名でYahoo検索（メイン - JANに依存しない）
  if (product?.name) {
    const keywords = makeKeywords(product.name, product.scale, product.maker);
    for (const kw of keywords) {
      const result = await yahooSearch(`query=${encodeURIComponent(kw)}`);
      if (result) {
        return res.status(200).json({
          jan, price: result.price,
          priceStr: `¥${result.price.toLocaleString("ja-JP")}`,
          source: `yahoo_${result.source}_name`,
        });
      }
    }
  }

  // Step3: JANで直接検索（商品名取れない・名前検索で取れない場合のみ）
  const janResult = await yahooSearch(`jan_code=${encodeURIComponent(jan)}`);
  if (janResult) {
    return res.status(200).json({
      jan, price: janResult.price,
      priceStr: `¥${janResult.price.toLocaleString("ja-JP")}`,
      source: `yahoo_${janResult.source}_jan`,
    });
  }

  return res.status(200).json({
    jan, price: null, priceStr: null, source: null, message: "not_found",
  });
}
