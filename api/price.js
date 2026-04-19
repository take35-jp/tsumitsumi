// api/price.js - v8（商品名のみ・JAN検索完全廃止）
//
// 設計思想：
//   JANで価格を引くのは「古い定価が返ってくる」リスクがある。
//   商品名で検索すれば現在の最新定価（現行品の定価）が返ってくる。
//   → JAN検索フォールバックを完全廃止。商品名検索オンリー。
//
// 取得フロー:
//   Step1: JANでSupabaseから商品名を取得
//   Step2: 商品名でYahoo検索 → fixedPrice or listPrice最頻値
//   取れなければ null を返す（古い定価・プレ値は絶対返さない）

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

// Yahoo検索 → fixedPrice or listPrice のみ
async function yahooSearch(keyword) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&query=${encodeURIComponent(keyword)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const hits = ((await r.json())?.hits || [])
      .filter(h => !SKIP_WORDS.test(h.name || ""));

    // fixedPrice最優先
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return { price: f, source: "yahoo_fixed" };
    }

    // listPrice最頻値（2件以上一致のみ）
    const lists = hits.map(h => h.priceLabel?.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) {
      const m = mode(lists);
      if (m) return { price: m, source: "yahoo_list_mode" };
    }
    if (lists.length === 1) return { price: lists[0], source: "yahoo_list_single" };

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

// 商品名から検索キーワードを複数パターン生成
function makeKeywords(name, scale, maker) {
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  const kws = [];
  // パターン1: スケール＋商品名（最精度）
  if (scale && !['1/144','1/100','1/72','1/35','1/48','1/700','1/12','1/24'].includes(scale)) {
    kws.push(`${scale} ${clean.slice(0, 22)} プラモデル`);
  }
  // パターン2: 商品名フル（括弧前まで）
  const bracketIdx = clean.search(/[（(]/);
  const shortName = bracketIdx > 5 ? clean.slice(0, bracketIdx).trim() : clean.slice(0, 30);
  kws.push(`${shortName} プラモデル`);
  // パターン3: メーカー名付き
  const makerMap = { タミヤ:'タミヤ', ハセガワ:'ハセガワ', コトブキヤ:'コトブキヤ', アオシマ:'アオシマ', フジミ:'フジミ', ウェーブ:'ウェーブ' };
  if (maker && makerMap[maker]) {
    kws.push(`${makerMap[maker]} ${clean.slice(0, 18)} プラモデル`);
  }
  return [...new Set(kws.map(k => k.trim().slice(0, 60)))];
}

export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) return res.status(400).json({ error: "jan required" });

  // Step1: JANでマスタから商品名取得
  const product = await getProduct(jan);
  if (!product?.name) {
    // マスタ未登録 → 価格取得不可（JANで直接検索はしない）
    return res.status(200).json({
      jan, price: null, priceStr: null, source: null,
      message: "not_in_master",
    });
  }

  // Step2: 商品名でYahoo検索（複数キーワードパターン）
  const keywords = makeKeywords(product.name, product.scale, product.maker);
  for (const kw of keywords) {
    const result = await yahooSearch(kw);
    if (result) {
      return res.status(200).json({
        jan, price: result.price,
        priceStr: `¥${result.price.toLocaleString("ja-JP")}`,
        source: result.source,
      });
    }
  }

  // 取得不可（商品名検索でも定価情報なし）
  return res.status(200).json({
    jan, price: null, priceStr: null, source: null, message: "not_found",
  });
}
