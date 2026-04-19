// api/price.js - v6（商品名ベース検索）
//
// 設計思想：
//   JANは「どの箱を持っているか」の識別子に過ぎない。
//   再販・旧JAN・新JANが混在しても、商品名は変わらない。
//   → 商品名でYahoo検索して定価を取得するのが正解。
//
// 取得フロー:
//   Step1: JANでSupabaseから商品名を取得
//   Step2: 商品名でYahoo検索 → fixedPrice or listPrice最頻値
//   Step3: JANで直接Yahoo検索（Step2で取れない場合の補完）
//   ※ 販売価格(price)は絶対使わない

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";
const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts)
    .filter(([, c]) => c === max)
    .map(([v]) => parseInt(v));
  return Math.min(...candidates);
}

// Yahoo検索 → fixedPrice or listPrice のみ返す
async function yahooSearch(params) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&${params}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const hits = ((await r.json())?.hits || [])
      .filter(h => !SKIP_WORDS.test(h.name || ""));

    // fixedPrice最優先
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return { price: f, source: "yahoo_fixed" };
    }

    // listPrice（定価欄）2件以上一致 or 1件
    const lists = hits.map(h => h.priceLabel?.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) {
      const m = mode(lists);
      if (m) return { price: m, source: "yahoo_list_mode" };
    }
    if (lists.length === 1) return { price: lists[0], source: "yahoo_list_single" };

    return null;
  } catch { return null; }
}

// 楽天検索 → listPrice のみ
async function rakutenSearch(keyword) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(keyword)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const items = ((await r.json())?.Items || [])
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));
    const lists = items.map(i => i.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) return { price: mode(lists), source: "rakuten_list_mode" };
    if (lists.length === 1) return { price: lists[0], source: "rakuten_list_single" };
    return null;
  } catch { return null; }
}

// SupabaseからJANで商品情報取得
async function getProductByJan(jan) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}&select=name,scale,maker&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    return (await r.json())?.[0] || null;
  } catch { return null; }
}

// 商品名から検索キーワードを生成（複数パターン）
function makeKeywords(name, scale) {
  // ノイズ除去
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  const kws = [];
  // パターン1: スケール + 商品名20文字
  if (scale) kws.push(`${scale} ${clean.slice(0, 20)} プラモデル`);
  // パターン2: 商品名30文字
  kws.push(`${clean.slice(0, 30)} プラモデル`);
  // パターン3: 商品名の短縮（括弧以前まで）
  const bracketIdx = clean.indexOf('(');
  if (bracketIdx > 5) kws.push(`${clean.slice(0, bracketIdx).trim()} プラモデル`);

  return [...new Set(kws.map(k => k.trim().slice(0, 60)))];
}

export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) {
    return res.status(400).json({ error: "jan required (min 8 digits)" });
  }

  // Step1: JANでSupabaseから商品名を取得
  const product = await getProductByJan(jan);

  // Step2: 商品名でYahoo+楽天を検索（メインロジック）
  if (product?.name) {
    const keywords = makeKeywords(product.name, product.scale);
    for (const kw of keywords) {
      const [y, rk] = await Promise.all([
        yahooSearch(`query=${encodeURIComponent(kw)}`),
        rakutenSearch(kw),
      ]);
      const best = y || rk;
      if (best) {
        return res.status(200).json({
          jan, price: best.price,
          priceStr: `¥${best.price.toLocaleString("ja-JP")}`,
          source: best.source + "_name",
        });
      }
    }
  }

  // Step3: JANで直接検索（マスタにない商品・補完用）
  const [y2, r2] = await Promise.all([
    yahooSearch(`jan_code=${encodeURIComponent(jan)}`),
    rakutenSearch(jan),
  ]);
  const best2 = y2 || r2;
  if (best2) {
    return res.status(200).json({
      jan, price: best2.price,
      priceStr: `¥${best2.price.toLocaleString("ja-JP")}`,
      source: best2.source + "_jan",
    });
  }

  return res.status(200).json({
    jan, price: null, priceStr: null, source: null, message: "not_found",
  });
}
