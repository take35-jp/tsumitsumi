// api/price.js - v4（最終版）
// JANコードからメーカー希望小売価格（税込）を取得
//
// 鉄則：「fixedPrice」か「listPrice」のみ使用。販売価格(price)は絶対使わない。
//
// 取得フロー:
//   Step1: Yahoo! V3 JAN検索 → fixedPrice優先、次にlistPrice最頻値(2件以上)
//   Step2: 楽天 JAN検索       → listPrice最頻値(2件以上)
//   Step3: Supabase商品名 → Yahooキーワード検索 → fixedPrice or listPrice最頻値
//   ↑ どのステップでも販売価格は一切使わない

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";
const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

function mode(arr) {
  if (arr.length < 2) return null; // 2件未満は信頼性なし
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  if (max < 2) return null; // 2件以上一致しないと採用しない
  const candidates = Object.entries(counts)
    .filter(([, c]) => c === max)
    .map(([v]) => parseInt(v));
  return Math.min(...candidates);
}

// Yahoo検索 - fixedPrice or listPrice最頻値のみ返す（販売価格は絶対使わない）
async function yahooSearch(params, label) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&${params}`;
    const r = await fetch(url);
    if (!r.ok) return { result: null, hits: 0, label };
    const data = await r.json();
    const allHits = data?.hits || [];
    const hits = allHits.filter(h => !SKIP_WORDS.test(h.name || ""));

    // 1. fixedPrice（最信頼 - メーカーが設定した定価）
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) {
        return { result: { price: f, source: "yahoo_fixed" }, hits: allHits.length, label };
      }
    }

    // 2. listPrice最頻値（正規ショップが「定価」欄に入力した値 - 2件以上一致が条件）
    const lists = hits
      .map(h => h.priceLabel?.listPrice)
      .filter(p => p && p > 0 && p < 300000);
    const m = mode(lists); // 2件以上一致しない場合nullを返す
    if (m) {
      return { result: { price: m, source: "yahoo_list_mode" }, hits: allHits.length, label };
    }

    // listPriceが1件だけある場合も採用（定価欄に入力した意図がある）
    if (lists.length === 1) {
      return { result: { price: lists[0], source: "yahoo_list_single" }, hits: allHits.length, label };
    }

    // listPriceもfixedPriceも取れない = 定価不明（販売価格は使わない）
    return { result: null, hits: allHits.length, label };
  } catch (e) {
    return { result: null, hits: 0, label, error: String(e) };
  }
}

// 楽天JAN検索 - listPriceのみ（2件以上一致が条件）
async function rakutenSearch(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const items = ((await r.json())?.Items || [])
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));
    const lists = items.map(i => i.listPrice).filter(p => p && p > 0 && p < 300000);
    const m = mode(lists);
    if (m) return { price: m, source: "rakuten_list_mode" };
    if (lists.length === 1) return { price: lists[0], source: "rakuten_list_single" };
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

// 商品名からキーワードパターンを生成
function makeKeywords(name, scale, maker) {
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  const patterns = [];
  if (scale) patterns.push(`${scale} ${clean.slice(0, 25)} プラモデル`);
  patterns.push(`${clean.slice(0, 35)} プラモデル`);
  const makerKw = { タミヤ: 'タミヤ', ハセガワ: 'ハセガワ', コトブキヤ: 'コトブキヤ', アオシマ: 'アオシマ', フジミ: 'フジミ' };
  if (maker && makerKw[maker]) {
    patterns.push(`${makerKw[maker]} ${clean.slice(0, 20)} プラモデル`);
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

  // Step1: JAN直接検索（Yahoo + 楽天 並行）
  const [y1, r1] = await Promise.all([
    yahooSearch(`jan_code=${encodeURIComponent(jan)}`, "yahoo_jan"),
    rakutenSearch(jan),
  ]);
  debug.push({ step: 1, yahoo: y1, rakuten: r1 });

  const best1 = y1.result || r1;
  if (best1) {
    return res.status(200).json({
      jan, price: best1.price,
      priceStr: `¥${best1.price.toLocaleString("ja-JP")}`,
      source: best1.source, debug,
    });
  }

  // Step2: 商品名キーワードで再検索（廃番・在庫切れでJANがヒットしない場合の対策）
  const product = await getProduct(jan);
  debug.push({ step: 2, product: product?.name?.slice(0, 50) });

  if (product?.name) {
    const keywords = makeKeywords(product.name, product.scale, product.maker);
    for (const kw of keywords) {
      const yk = await yahooSearch(`query=${encodeURIComponent(kw)}`, kw);
      debug.push({ step: 2, kw, result: yk.result, hits: yk.hits });
      if (yk.result) {
        return res.status(200).json({
          jan, price: yk.result.price,
          priceStr: `¥${yk.result.price.toLocaleString("ja-JP")}`,
          source: yk.result.source + "_kw", debug,
        });
      }
    }
  }

  // 定価が取れなかった（プレ値を返すくらいなら null が正解）
  return res.status(200).json({
    jan, price: null, priceStr: null, source: null, message: "not_found", debug,
  });
}
