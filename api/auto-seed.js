// api/auto-seed.js
// Vercel Cron Jobから毎月1日 AM3:00に自動実行
// 新商品をYahoo!ショッピングから取得してマスタに追加する
//
// vercel.json:
//   "crons": [{ "path": "/api/auto-seed", "schedule": "0 3 1 * *" }]
//
// 手動実行: GET /api/auto-seed?token=YOUR_SECRET&dry=1

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

// 毎月チェックするクエリリスト（新作が出やすいカテゴリを中心に）
const MONTHLY_QUERIES = [
  // ガンプラ最新
  { maker: "バンダイ", query: "HG 1/144 ガンプラ 新作 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "MG 1/100 ガンプラ 新作 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "RG 1/144 ガンプラ 新作 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HG 水星の魔女 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HGUC 機動戦士ガンダム プラモデル", pages: 2 },
  { maker: "バンダイ", query: "30MM バンダイ プラモデル 新作", pages: 2 },
  { maker: "バンダイ", query: "30MS バンダイ プラモデル 新作", pages: 2 },
  // コトブキヤ最新
  { maker: "コトブキヤ", query: "コトブキヤ フレームアームズ 新作 プラモデル", pages: 2 },
  { maker: "コトブキヤ", query: "コトブキヤ メガミデバイス 新作 プラモデル", pages: 2 },
  { maker: "コトブキヤ", query: "コトブキヤ ヘキサギア 新作 プラモデル", pages: 2 },
  // タミヤ最新
  { maker: "タミヤ", query: "タミヤ 1/35 新作 プラモデル", pages: 2 },
  { maker: "タミヤ", query: "タミヤ 1/700 新作 艦船 プラモデル", pages: 2 },
  // ハセガワ最新
  { maker: "ハセガワ", query: "ハセガワ 1/72 新作 プラモデル", pages: 2 },
  // MODEROID最新
  { maker: "グッドスマイル", query: "MODEROID 新作 プラモデル", pages: 2 },
];

function guessSeriesForMaker(name, maker) {
  const n = name || "";
  switch (maker) {
    case "タミヤ":
      if (/1\/35|AFV|戦車|装甲/i.test(n)) return "タミヤ 戦車・AFV";
      if (/1\/700|1\/350|艦船|戦艦/i.test(n)) return "タミヤ 艦船";
      if (/1\/48|1\/72|飛行機|戦闘機/i.test(n)) return "タミヤ 飛行機";
      if (/1\/12|バイク|オートバイ/i.test(n)) return "タミヤ バイク";
      if (/1\/24|1\/20|車|カー/i.test(n)) return "タミヤ 自動車";
      if (/ミニ四駆|ミニ4駆/i.test(n)) return "ミニ四駆";
      return "タミヤ";
    case "ハセガワ":
      if (/飛行機|戦闘機|航空機/i.test(n)) return "ハセガワ 飛行機";
      if (/艦船|戦艦/i.test(n)) return "ハセガワ 艦船";
      if (/マクロス|バルキリー/i.test(n)) return "マクロス（ハセガワ）";
      return "ハセガワ";
    case "コトブキヤ":
      if (/フレームアームズガール|FA:G/i.test(n)) return "フレームアームズ・ガール";
      if (/フレームアームズ/i.test(n)) return "フレームアームズ";
      if (/ヘキサギア/i.test(n)) return "ヘキサギア";
      if (/メガミデバイス/i.test(n)) return "メガミデバイス";
      if (/アーマードコア/i.test(n)) return "アーマードコア（コトブキヤ）";
      return "コトブキヤ";
    case "グッドスマイル":
      return "MODEROID";
    default:
      return "ガンプラ";
  }
}

function guessScale(name) {
  if (/\bMGSD\b/i.test(name)) return "MGSD";
  if (/\bMGEX\b/i.test(name)) return "MGEX";
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHGUC\b|\bHGCE\b|\bHGBD\b|\bHGAC\b|\bHG\b/i.test(name)) return "HG";
  if (/\bEG\b/i.test(name)) return "EG";
  if (/\bRE\/100\b/i.test(name)) return "RE/100";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/\bSD\b|SDW/i.test(name)) return "SD";
  const m = name.match(/1\/(1700|1200|700|550|400|350|250|200|144|100|72|60|48|35|32|24|20|12)\b/);
  return m ? `1/${m[1]}` : "";
}

// 既存JANをバッチ取得してSetで返す
async function getExistingJans() {
  const allJans = new Set();
  let offset = 0;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=jan&limit=1000&offset=${offset}`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    data.forEach(d => d.jan && allJans.add(d.jan));
    if (data.length < 1000) break;
    offset += 1000;
  }
  return allJans;
}

// Yahoo!から商品を取得
async function fetchYahooItems(query, page = 1, results = 100) {
  const start = (page - 1) * results + 1;
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&query=${encodeURIComponent(query)}&results=${results}&start=${start}&output=json`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json();
  return data?.hits || [];
}

// Supabaseに一括upsert
async function upsertProducts(products) {
  if (products.length === 0) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(products),
  });
  return r.ok ? products.length : 0;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req, res) {
  // Cronからの呼び出し or 手動実行のみ許可
  const isCron = req.headers["x-vercel-cron"] === "1";
  const token = req.query.token;
  const CRON_SECRET = process.env.CRON_SECRET || "tsumitsumi-cron-2026";
  const dry = req.query.dry === "1";

  if (!isCron && token !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized. Use ?token=YOUR_SECRET" });
  }

  const startTime = Date.now();
  const log = [];
  let totalInserted = 0;
  let totalSkipped = 0;

  try {
    log.push(`🚀 auto-seed 開始 ${new Date().toISOString()} dry=${dry}`);

    // 既存JANを全件取得
    log.push("既存JANを取得中...");
    const existingJans = await getExistingJans();
    log.push(`既存JAN: ${existingJans.size}件`);

    // 各クエリを処理
    for (const { maker, query, pages } of MONTHLY_QUERIES) {
      let queryInserted = 0;

      for (let page = 1; page <= pages; page++) {
        const items = await fetchYahooItems(query, page);

        // JANあり・新規のみフィルタ
        const seen = new Set();
        const newProducts = items
          .filter(item => item.janCode && item.janCode.length >= 8)
          .filter(item => {
            if (seen.has(item.janCode) || existingJans.has(item.janCode)) return false;
            seen.add(item.janCode);
            return true;
          })
          .map(item => {
            const name = item.name || "";
            return {
              jan: item.janCode,
              name,
              image_url: item.image?.medium || item.image?.small || "",
              series: guessSeriesForMaker(name, maker),
              scale: guessScale(name),
              maker,
            };
          });

        totalSkipped += items.length - newProducts.length;

        if (!dry && newProducts.length > 0) {
          await upsertProducts(newProducts);
          // 追加したJANを既存セットに追加（次のループで重複しないように）
          newProducts.forEach(p => existingJans.add(p.jan));
        }

        totalInserted += newProducts.length;
        queryInserted += newProducts.length;

        await sleep(500); // レート制限対策
      }

      if (queryInserted > 0) {
        log.push(`✅ [${maker}] "${query.slice(0, 30)}" → +${queryInserted}件`);
      }

      // Vercel Serverless Functionのタイムアウト対策（50秒で打ち切り）
      if (Date.now() - startTime > 50000) {
        log.push("⚠️ タイムアウト防止のため処理を打ち切り");
        break;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`🎉 完了！新規追加: ${totalInserted}件 スキップ: ${totalSkipped}件 (${elapsed}s)`);

    return res.status(200).json({
      success: true,
      dry,
      inserted: totalInserted,
      skipped: totalSkipped,
      elapsed: `${elapsed}s`,
      existingCount: existingJans.size,
      log,
    });

  } catch (e) {
    log.push(`❌ エラー: ${e.message}`);
    return res.status(500).json({ error: e.message, log });
  }
}
