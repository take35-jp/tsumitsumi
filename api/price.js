// api/price.js - v3
// JANコードからメーカー希望小売価格（税込）を取得
//
// 取得フロー:
//   Step1: Yahoo! V3 JAN検索 → fixedPrice or listPrice最頻値
//   Step2: 楽天 JAN検索       → listPrice最頻値
//   Step3: Supabaseで商品名取得 → Yahooキーワード検索 → listPrice最頻値
//   Step4: Yahooキーワード検索 → fixedPrice or listPrice (商品名のみ・ノイズ少なめ)
//
// ※ 販売価格(price)は絶対使わない・取れなければ null を返す

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
  const candidates = Object.entries(counts).filter(([,c])=>c===max).map(([v])=>parseInt(v));
  return Math.min(...candidates);
}

// Yahoo検索コア - fixedPrice or listPrice最頻値を返す
async function yahooSearch(params) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&${params}`;
    const r = await fetch(url);
    if (!r.ok) return { result: null, hitCount: 0 };
    const data = await r.json();
    const allHits = data?.hits || [];
    const hits = allHits.filter(h => !SKIP_WORDS.test(h.name || ""));
    if (!hits.length) return { result: null, hitCount: allHits.length };

    // fixedPrice最優先
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return { result: { price: f, source: "yahoo_fixed" }, hitCount: allHits.length };
    }

    // listPrice最頻値
    const lists = hits.map(h=>h.priceLabel?.listPrice).filter(p=>p&&p>0&&p<300000);
    if (lists.length >= 2) {
      const m = mode(lists);
      if (m) return { result: { price: m, source: "yahoo_list_mode" }, hitCount: allHits.length };
    }
    if (lists.length === 1) {
      return { result: { price: lists[0], source: "yahoo_list_single" }, hitCount: allHits.length };
    }

    // listPriceが全くない場合：priceの最頻値（2店舗以上一致なら定価の可能性大）
    const prices = hits.map(h=>h.price).filter(p=>p&&p>0&&p<300000);
    if (prices.length >= 3) {
      const counts = {};
      prices.forEach(p => { counts[p] = (counts[p]||0)+1; });
      const maxCount = Math.max(...Object.values(counts));
      if (maxCount >= 3) { // 3店舗以上同じ価格なら定価とみなす
        const priceMode = parseInt(Object.entries(counts).find(([,c])=>c===maxCount)[0]);
        return { result: { price: priceMode, source: "yahoo_price_mode3" }, hitCount: allHits.length };
      }
    }

    return { result: null, hitCount: allHits.length };
  } catch (e) {
    return { result: null, hitCount: 0, error: String(e) };
  }
}

// 楽天JAN検索
async function rakutenSearch(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const items = (data?.Items||[]).map(i=>i.Item).filter(i=>i&&!SKIP_WORDS.test(i.itemName||""));
    const lists = items.map(i=>i.listPrice).filter(p=>p&&p>0&&p<300000);
    if (lists.length >= 2) return { price: mode(lists), source: "rakuten_list_mode" };
    if (lists.length === 1) return { price: lists[0], source: "rakuten_list_single" };
    return null;
  } catch { return null; }
}

// Supabaseから商品情報取得
async function getProduct(jan) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}&select=name,scale,series,maker&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await r.json();
    return data?.[0] || null;
  } catch { return null; }
}

// 商品名からキーワードを作成（複数パターン）
function makeKeywords(name, scale, maker) {
  // ノイズ除去
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  // キーワードパターン（精度高い順）
  const patterns = [];

  // パターン1: scale + 商品名の主要部分（最初の30文字）
  if (scale) patterns.push(`${scale} ${clean.slice(0, 30)} プラモデル`);

  // パターン2: 商品名の最初の40文字
  patterns.push(`${clean.slice(0, 40)} プラモデル`);

  // パターン3: makerがタミヤ・ハセガワ等の場合、メーカー名を加える
  const makerMap = { 'タミヤ': 'タミヤ', 'ハセガワ': 'ハセガワ', 'コトブキヤ': 'コトブキヤ', 'アオシマ': 'アオシマ' };
  if (maker && makerMap[maker]) {
    patterns.push(`${makerMap[maker]} ${clean.slice(0, 25)} プラモデル`);
  }

  return patterns.map(p => p.trim().slice(0, 60));
}

// メインハンドラ
export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) {
    return res.status(400).json({ error: "jan required (min 8 digits)" });
  }

  const debug = [];

  // Step 1: JAN検索（Yahoo + 楽天 並行）
  const [y1, r1] = await Promise.all([
    yahooSearch(`jan_code=${encodeURIComponent(jan)}`),
    rakutenSearch(jan),
  ]);
  debug.push({ step: 1, yahooHits: y1.hitCount, yahooResult: y1.result, rakutenResult: r1 });

  const best1 = y1.result || r1;
  if (best1) {
    return res.status(200).json({
      jan, price: best1.price,
      priceStr: `¥${best1.price.toLocaleString("ja-JP")}`,
      source: best1.source, debug,
    });
  }

  // Step 2: Supabaseで商品情報取得 → キーワード検索
  const product = await getProduct(jan);
  debug.push({ step: 2, product: product?.name?.slice(0, 50) });

  if (product?.name) {
    const keywords = makeKeywords(product.name, product.scale, product.maker);
    for (const kw of keywords) {
      const yk = await yahooSearch(`query=${encodeURIComponent(kw)}`);
      debug.push({ step: 2, kw, yahooHits: yk.hitCount, yahooResult: yk.result });
      if (yk.result) {
        return res.status(200).json({
          jan, price: yk.result.price,
          priceStr: `¥${yk.result.price.toLocaleString("ja-JP")}`,
          source: yk.result.source + "_kw", debug,
        });
      }
    }
  }

  return res.status(200).json({
    jan, price: null, priceStr: null, source: null, message: "not_found", debug,
  });
}
