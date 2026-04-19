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
  // ─── バンダイ ガンプラ 新作 ───
  { maker: "バンダイ", query: "HG 1/144 ガンプラ 新作 プラモデル", pages: 5 },
  { maker: "バンダイ", query: "MG 1/100 ガンプラ 新作 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "RG 1/144 ガンプラ 新作 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HGCE HGTWFM ガンプラ 新作 プラモデル", pages: 3 },
  // ─── HGUC 宇宙世紀 ───
  { maker: "バンダイ", query: "HGUC 1/144 機動戦士ガンダム プラモデル", pages: 5 },
  { maker: "バンダイ", query: "HGUC 1/144 機動戦士Zガンダム プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HGUC 1/144 機動戦士ZZガンダム プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HGUC 1/144 逆襲のシャア プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HGUC 1/144 機動戦士ガンダムUC プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HGUC 1/144 機動戦士ガンダム0083 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HGUC 1/144 08MS小隊 0080 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HGUC 1/144 Vガンダム F91 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HGUC 1/144 閃光のハサウェイ ナラティブ プラモデル", pages: 2 },
  { maker: "バンダイ", query: "HGUC 1/144 ターンエー クロスボーン プラモデル", pages: 2 },
  // ─── HG 非宇宙世紀 ───
  { maker: "バンダイ", query: "HG 1/144 ガンダムSEED DESTINY FREEDOM プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HG 1/144 ガンダム00 ダブルオー プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HG 1/144 ガンダムAGE ビルドファイターズ プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HG 1/144 鉄血のオルフェンズ 水星の魔女 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HG 1/144 ガンダムW G Xガンダム プラモデル", pages: 3 },
  { maker: "バンダイ", query: "HG 1/144 ガンダムORIGIN サンダーボルト プラモデル", pages: 2 },
  { maker: "バンダイ", query: "EG エントリーグレード ガンプラ プラモデル", pages: 2 },
  // ─── MG 全系統 ───
  { maker: "バンダイ", query: "MG 1/100 機動戦士ガンダム 宇宙世紀 プラモデル", pages: 5 },
  { maker: "バンダイ", query: "MG 1/100 ガンダムSEED DESTINY 00 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "MG 1/100 ガンダムW 00 プラモデル", pages: 3 },
  { maker: "バンダイ", query: "MG 1/100 閃光のハサウェイ 鉄血 プラモデル", pages: 2 },
  { maker: "バンダイ", query: "MGEX MGSD ガンプラ プラモデル", pages: 2 },
  { maker: "バンダイ", query: "FULL MECHANICS フルメカニクス RE/100 プラモデル", pages: 2 },
  // ─── PG・RG・SD ───
  { maker: "バンダイ", query: "PG 1/60 パーフェクトグレード ガンプラ プラモデル", pages: 2 },
  { maker: "バンダイ", query: "RG 1/144 リアルグレード ガンプラ プラモデル", pages: 3 },
  { maker: "バンダイ", query: "SDガンダム BB戦士 SDW HEROES プラモデル", pages: 3 },
  // ─── 30MM/30MS/30MF ───
  { maker: "バンダイ", query: "30MM 30MS 30MF バンダイ プラモデル", pages: 3 },
  // ─── バンダイ キャラクター ───
  { maker: "バンダイ", query: "Figure-rise Standard フィギュアライズ プラモデル", pages: 3 },
  { maker: "バンダイ", query: "ポケプラ ポケモン バンダイ プラモデル", pages: 3 },
  { maker: "バンダイ", query: "ゾイド ZOIDS バンダイ プラモデル", pages: 2 },
  // ─── コトブキヤ ───
  { maker: "コトブキヤ", query: "コトブキヤ フレームアームズ フレームアームズガール プラモデル", pages: 3 },
  { maker: "コトブキヤ", query: "コトブキヤ メガミデバイス ヘキサギア プラモデル", pages: 3 },
  { maker: "コトブキヤ", query: "コトブキヤ 創彩少女庭園 アーマードコア プラモデル", pages: 2 },
  // ─── タミヤ ───
  { maker: "タミヤ", query: "タミヤ 1/35 ミリタリーミニチュア 戦車 AFV プラモデル", pages: 5 },
  { maker: "タミヤ", query: "タミヤ 1/700 ウォーターライン 艦船 プラモデル", pages: 3 },
  { maker: "タミヤ", query: "タミヤ 1/48 1/72 飛行機 航空機 プラモデル", pages: 3 },
  { maker: "タミヤ", query: "タミヤ 1/24 スポーツカー 自動車 プラモデル", pages: 3 },
  { maker: "タミヤ", query: "タミヤ 1/12 バイク ミニ四駆 プラモデル", pages: 2 },
  // ─── ハセガワ ───
  { maker: "ハセガワ", query: "ハセガワ 1/72 飛行機 戦闘機 プラモデル", pages: 5 },
  { maker: "ハセガワ", query: "ハセガワ 1/48 飛行機 プラモデル", pages: 3 },
  { maker: "ハセガワ", query: "ハセガワ マクロス バルキリー キャラクター プラモデル", pages: 3 },
  { maker: "ハセガワ", query: "ハセガワ 1/700 艦船 自動車 プラモデル", pages: 2 },
  // ─── アオシマ・フジミ ───
  { maker: "アオシマ", query: "アオシマ 艦船 自動車 キャラクター プラモデル", pages: 3 },
  { maker: "フジミ", query: "フジミ 艦船 自動車 飛行機 城 プラモデル", pages: 3 },
  // ─── MODEROID・ウェーブ・ピットロード ───
  { maker: "グッドスマイル", query: "MODEROID プラモデル ロボット キャラクター", pages: 3 },
  { maker: "ウェーブ", query: "ウェーブ マシーネンクリーガー PLAMAX プラモデル", pages: 2 },
  { maker: "ピットロード", query: "ピットロード 1/700 艦船 護衛艦 プラモデル", pages: 2 },
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

// ノイズ除去（clean-master.jsと同じロジック）
function removeNoise(name) {
  let n = name || "";
  n = n.replace(/^H-[\dA-Z]{8,}\s*/i, "");
  n = n.replace(/【[^】]*】/g, "");
  n = n.replace(/『中古[^』]*』/g, "");
  n = n.replace(/《[^》]*》/g, "");
  n = n.replace(/\[[^\]]*在庫[^\]]*\]/g, "").replace(/\[[^\]]*発売済[^\]]*\]/g, "").replace(/\[[^\]]*BANDAI[^\]]*\]/gi, "");
  n = n.replace(/（[^)]*中古[^)]*）/g, "");
  n = n.replace(/{[A-Z]+}/g, "");
  n = n.replace(/『([^』]*)』/g, "$1");
  n = n.replace(/「([^」]*)」/g, "$1").replace(/「[^」]*$/g, "");
  n = n.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  n = n.replace(/\s*中古[即納]?\s*/g, " ");
  n = n.replace(/使用感[あ有]り|傷あり|汚れあり|訳あり|ジャンク/g, "");
  n = n.replace(/[0-9０-９]+[週日時間]+以内発送/g, "");
  n = n.replace(/[0-9０-９]+月[0-9０-９]+日[^\s]*発送/g, "");
  n = n.replace(/がんだむ|アニメ\s*ロボット/gi, "");
  n = n.replace(/BANDAI SPIRITS/gi, "").replace(/バンダイスピリッツ/g, "").replace(/バンダイ\s*スピリッツ/g, "").replace(/スピリッツ/g, "");
  n = n.replace(/BSP\(\d+\)/g, "");
  n = n.replace(/爆買[いい]?\s*/g, "");
  n = n.replace(/同梱不可|同梱可|※キャンセル不可/g, "");
  n = n.replace(/特別販売商品|ホビーオンラインショップ限定/g, "");
  n = n.replace(/プレミアムバンダイ限定|プレバン限定|イベント限定|返品種別[A-Z]|限定品/g, "");
  n = n.replace(/\(金属砲身付\)|（金属砲身付）/g, "");
  n = n.replace(/BANDAI/gi, "").replace(/バンダイ/g, "");
  n = n.replace(/送料無料|即納|在庫あり|新品[・\s]?未開封|新品|未開封|再販|再生産|メール便可|代引き?不可/g, "");
  n = n.replace(/\s+プラモデル\s*$/, "").replace(/\s+ガンプラ\s*$/, "").replace(/^ガンプラ\s+/, "");
  n = n.replace(/\s*\[\d+\]\s*/g, " ").replace(/\s*No\.\d+\s*/g, " ");
  n = n.replace(/\b\d{7,}\b/g, "");
  n = n.replace(/\[\s*\]|\(\s*\)/g, "");
  n = n.replace(/\s{2,}/g, " ").trim();
  n = n.replace(/^[\s\-・\/]+|[\s\-・\/]+$/g, "").trim();
  return n;
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
            const rawName = item.name || "";
            const name = removeNoise(rawName); // ノイズ除去
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
