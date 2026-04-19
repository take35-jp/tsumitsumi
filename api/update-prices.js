// api/update-prices.js
// マスタのretail_priceを一括更新
//
// 実行: GET /api/update-prices?token=tsumitsumi-cron-2026&limit=100
// force=1: 既存価格も上書き
// reset=1: -1（取得不可フラグ）をnullにリセットして再試行対象にする
//
// retail_price の意味:
//   null  = 未処理（次回処理対象）
//   > 0   = 取得済み価格
//   -1    = 取得不可（Yahoo/楽天に定価情報なし）→ 次回スキップ

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

async function fetchPrice(keyword) {
  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=30&output=json&query=${encodeURIComponent(keyword)}`;
    const r = await fetch(url);
    if (r.status === 429) throw new Error('RATE_LIMIT');
    if (!r.ok) return null;
    const hits = ((await r.json())?.hits || []).filter(h => !SKIP_WORDS.test(h.name || ""));
    for (const h of hits) {
      const f = h.priceLabel?.fixedPrice;
      if (f && f > 0) return f;
    }
    const lists = hits.map(h => h.priceLabel?.listPrice).filter(p => p && p > 0 && p < 300000);
    if (lists.length >= 2) { const m = mode(lists); if (m) return m; }
    if (lists.length === 1) return lists[0];
    return null;
  } catch (e) {
    if (e.message === 'RATE_LIMIT') throw e;
    return null;
  }
}

function makeKeyword(name, scale, maker) {
  const clean = (name || "")
    .replace(/BANDAI SPIRITS|バンダイスピリッツ|バンダイ|BANDAI/gi, "")
    .replace(/色分け済み|再販|新品|在庫|プラモデル|ガンプラ/gi, "")
    .replace(/\s+/g, " ").trim();
  const gradeScale = /^(HG|MG|RG|PG|SD|EG|RE|HGUC|HGCE|MGEX|MGSD)$/.test(scale||'');
  if (gradeScale) {
    const bracketIdx = clean.search(/[（(]/);
    const short = bracketIdx > 5 ? clean.slice(0, bracketIdx).trim() : clean.slice(0, 25);
    return `${scale} ${short} プラモデル`.slice(0, 60);
  }
  const makerMap = { タミヤ:'タミヤ', ハセガワ:'ハセガワ', コトブキヤ:'コトブキヤ', アオシマ:'アオシマ', フジミ:'フジミ' };
  if (maker && makerMap[maker]) return `${makerMap[maker]} ${clean.slice(0, 20)} プラモデル`.slice(0, 60);
  return `${clean.slice(0, 30)} プラモデル`.slice(0, 60);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function setPrice(id, price) {
  return fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    headers: { apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
    body: JSON.stringify({ retail_price: price }),
  });
}

export default async function handler(req, res) {
  if (req.query.token !== TOKEN) return res.status(401).json({ error: "unauthorized" });

  const limit = Math.min(parseInt(req.query.limit || "100"), 200);
  const force = req.query.force === "1";
  const reset = req.query.reset === "1";

  // reset=1のとき: -1をnullに戻して再処理対象にする
  if (reset) {
    await fetch(`${SUPABASE_URL}/rest/v1/products?retail_price=eq.-1`, {
      method:'PATCH',
      headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: JSON.stringify({ retail_price: null }),
    });
    return res.status(200).json({ message: 'reset完了' });
  }

  // 対象取得: null（未処理）のみ。force=1なら全件
  const filter = force
    ? `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,scale,maker&limit=${limit}&order=id.asc`
    : `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,scale,maker&retail_price=is.null&limit=${limit}&order=id.asc`;

  const r = await fetch(filter, { headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}` } });
  const products = await r.json();
  if (!products?.length) return res.status(200).json({ message:'全件処理済み', updated:0, notFound:0 });

  let updated = 0, notFound = 0, rateLimit = false;
  const results = [];

  for (const product of products) {
    const kw = makeKeyword(product.name, product.scale, product.maker);
    let price = null;
    try {
      price = await fetchPrice(kw);
    } catch (e) {
      if (e.message === 'RATE_LIMIT') { rateLimit = true; break; }
    }

    if (price && price > 0) {
      const upd = await setPrice(product.id, price);
      if (upd.ok) { updated++; results.push({ jan:product.jan, name:product.name?.slice(0,30), price, kw }); }
    } else {
      // 取得不可: -1を設定してスキップフラグに
      await setPrice(product.id, -1);
      notFound++;
    }

    await sleep(150);
  }

  return res.status(200).json({
    updated, notFound, total: products.length,
    rateLimit,
    results: results.slice(0, 10),
  });
}
