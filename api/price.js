// api/price.js - v5
// JANコードからメーカー希望小売価格（税込）を取得
//
// 改善点：
// 1. Yahoo hits の全priceLabel フィールドを詳細チェック
// 2. 公式・正規店舗（bandai-hobby, yodobashi, joshin 等）を優先
// 3. seller情報で公式ストアのpriceを信頼
// 4. listPrice 1件でも採用（2件縛りを緩和）
// 5. 楽天もkeyword検索で補完

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";
const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

// 信頼できる正規ショップのキーワード（storeCode or seller名）
const TRUSTED_STORES = /yodobashi|joshin|biccamera|edion|yamada|sofmap|bandai|アマゾン|amazon|楽天ブックス/i;

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts).filter(([,c])=>c===max).map(([v])=>parseInt(v));
  return Math.min(...candidates);
}

async function yahooSearch(params) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&${params}`;
    const r = await fetch(url);
    if (!r.ok) return { result: null, hits: 0 };
    const data = await r.json();
    const allHits = data?.hits || [];
    const hits = allHits.filter(h => !SKIP_WORDS.test(h.name || ""));

    // 1. fixedPrice（最優先）
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return { result: { price: f, source: "yahoo_fixed" }, hits: allHits.length };
    }

    // 2. listPrice（定価欄）- 1件でも採用
    const listPrices = hits
      .map(h => h.priceLabel?.listPrice)
      .filter(p => p && p > 0 && p < 300000);

    if (listPrices.length >= 2) {
      const m = mode(listPrices);
      if (m) return { result: { price: m, source: "yahoo_list_mode" }, hits: allHits.length };
    }
    if (listPrices.length === 1) {
      return { result: { price: listPrices[0], source: "yahoo_list_single" }, hits: allHits.length };
    }

    // 3. 信頼できる正規店舗のprice（販売価格だが正規店なら定価に近い）
    for (const h of hits) {
      const storeName = h.store?.name || h.seller?.name || "";
      if (TRUSTED_STORES.test(storeName) && h.price > 0) {
        return { result: { price: h.price, source: "yahoo_trusted_store" }, hits: allHits.length };
      }
    }

    return { result: null, hits: allHits.length };
  } catch (e) {
    return { result: null, hits: 0, error: String(e) };
  }
}

async function rakutenSearch(keyword) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(keyword)}&hits=10&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const items = ((await r.json())?.Items || [])
      .map(i => i.Item)
      .filter(i => i && !SKIP_WORDS.test(i.itemName || ""));

    // listPrice優先
    const lists = items.map(i => i.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) return { price: mode(lists), source: "rakuten_list_mode" };
    if (lists.length === 1) return { price: lists[0], source: "rakuten_list_single" };

    // 楽天ブックスの価格（正規価格の可能性高い）
    for (const item of items) {
      const shop = item.shopName || "";
      if (/楽天ブックス|楽天市場/.test(shop) && item.itemPrice > 0) {
        return { price: item.itemPrice, source: "rakuten_official" };
      }
    }
    return null;
  } catch { return null; }
}

async function getProduct(jan) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}&select=name,scale,maker&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    return (await r.json())?.[0] || null;
  } catch { return null; }
}

function makeKeywords(name, scale, maker) {
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  const patterns = [];
  // スケール+商品名（短縮）
  if (scale) patterns.push(`${scale} ${clean.slice(0, 20)}`);
  // 商品名のみ（短縮）
  patterns.push(clean.slice(0, 30));
  // メーカー+商品名
  const makerKw = { タミヤ: 'タミヤ', ハセガワ: 'ハセガワ', コトブキヤ: 'コトブキヤ', アオシマ: 'アオシマ' };
  if (maker && makerKw[maker]) patterns.push(`${makerKw[maker]} ${clean.slice(0, 15)}`);
  return patterns.map(p => (p.trim() + " プラモデル").slice(0, 60));
}

export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) return res.status(400).json({ error: "jan required" });

  // Step1: JAN直接検索
  const [y1, r1] = await Promise.all([
    yahooSearch(`jan_code=${encodeURIComponent(jan)}`),
    rakutenSearch(jan),
  ]);
  const best1 = y1.result || r1;
  if (best1) {
    return res.status(200).json({
      jan, price: best1.price,
      priceStr: `¥${best1.price.toLocaleString("ja-JP")}`,
      source: best1.source,
    });
  }

  // Step2: 商品名キーワード検索
  const product = await getProduct(jan);
  if (product?.name) {
    const keywords = makeKeywords(product.name, product.scale, product.maker);
    for (const kw of keywords) {
      const [yk, rk] = await Promise.all([
        yahooSearch(`query=${encodeURIComponent(kw)}`),
        rakutenSearch(kw),
      ]);
      const best2 = yk.result || rk;
      if (best2) {
        return res.status(200).json({
          jan, price: best2.price,
          priceStr: `¥${best2.price.toLocaleString("ja-JP")}`,
          source: best2.source + "_kw",
        });
      }
    }
  }

  return res.status(200).json({ jan, price: null, priceStr: null, source: null, message: "not_found" });
}
