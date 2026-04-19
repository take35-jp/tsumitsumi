// api/update-prices.js
// マスタのretail_priceを一括更新するAPI
//
// 動作：
//   1. retail_priceが未設定の商品を取得
//   2. 商品名でYahoo検索 → fixedPrice or listPrice最頻値
//   3. 取得できた価格をretail_priceとしてマスタに保存
//
// 実行：GET /api/update-prices?token=tsumitsumi-cron-2026&limit=50
//   limit: 1回の実行で処理する件数（デフォルト50）
//   force: ?force=1 で既存のretail_priceも上書き

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";
const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const TOKEN = "tsumitsumi-cron-2026";

const SKIP_WORDS = /中古|即納|訳あり|ジャンク|used|二次流通|転売|プレ値|高額/i;

function mode(arr) {
  if (!arr.length) return null;
  const counts = {};
  arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const max = Math.max(...Object.values(counts));
  const candidates = Object.entries(counts).filter(([,c])=>c===max).map(([v])=>parseInt(v));
  return Math.min(...candidates);
}

// 商品名でYahoo検索 → fixedPrice or listPrice
async function fetchPrice(keyword) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&query=${encodeURIComponent(keyword)}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const hits = ((await r.json())?.hits || []).filter(h => !SKIP_WORDS.test(h.name || ""));

    // fixedPrice最優先
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return f;
    }

    // listPrice最頻値
    const lists = hits.map(h => h.priceLabel?.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) { const m = mode(lists); if (m) return m; }
    if (lists.length === 1) return lists[0];

    return null;
  } catch { return null; }
}

// 商品名からキーワードを生成
function makeKeyword(name, scale, maker) {
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();

  // スケールがグレード名（HG/MG/RG/PG等）なら先頭に付ける
  const gradeScale = /^(HG|MG|RG|PG|SD|EG|RE|HGUC|HGCE|MGEX|MGSD)$/.test(scale||'');
  if (gradeScale) {
    const bracketIdx = clean.search(/[（(]/);
    const short = bracketIdx > 5 ? clean.slice(0, bracketIdx).trim() : clean.slice(0, 25);
    return `${scale} ${short} プラモデル`.slice(0, 60);
  }

  // メーカー名付き（タミヤ・ハセガワ等）
  const makerMap = { タミヤ:'タミヤ', ハセガワ:'ハセガワ', コトブキヤ:'コトブキヤ', アオシマ:'アオシマ', フジミ:'フジミ' };
  if (maker && makerMap[maker]) {
    return `${makerMap[maker]} ${clean.slice(0, 20)} プラモデル`.slice(0, 60);
  }

  return `${clean.slice(0, 30)} プラモデル`.slice(0, 60);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.query.token !== TOKEN) return res.status(401).json({ error: "unauthorized" });

  const limit = Math.min(parseInt(req.query.limit || "50"), 200);
  const force = req.query.force === "1";

  try {
    // 対象商品を取得（retail_price未設定 or forceなら全件）
    const filter = force
      ? `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,scale,maker&limit=${limit}&order=id.asc`
      : `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,scale,maker&retail_price=is.null&limit=${limit}&order=id.asc`;

    const r = await fetch(filter, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const products = await r.json();

    if (!products?.length) return res.status(200).json({ message: "全件処理済み", updated: 0, failed: 0 });

    let updated = 0, failed = 0;
    const results = [];

    for (const product of products) {
      const kw = makeKeyword(product.name, product.scale, product.maker);
      const price = await fetchPrice(kw);

      if (price) {
        // retail_priceをマスタに保存
        const upd = await fetch(
          `${SUPABASE_URL}/rest/v1/products?id=eq.${product.id}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ retail_price: price }),
          }
        );
        if (upd.ok) { updated++; results.push({ jan: product.jan, name: product.name?.slice(0,30), price, kw }); }
        else failed++;
      } else {
        failed++;
      }

      await sleep(200); // レート制限対策
    }

    return res.status(200).json({
      updated, failed,
      total: products.length,
      remaining: force ? 0 : '未確認',
      results: results.slice(0, 20), // 最初の20件を返す
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
