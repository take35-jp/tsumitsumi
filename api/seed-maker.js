// api/seed-maker.js
// タミヤ・ハセガワ・アオシマ・フジミ等のプラモデルをYahoo!から取得してSupabaseに登録
// GET /api/seed-maker?maker=タミヤ&query=タミヤ 1/35 戦車&page=1&dry=1

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

// メーカー別シリーズ推定
function guessSeriesForMaker(name, maker) {
  const n = name || "";
  switch (maker) {
    case "タミヤ":
      if (/1\/35|AFV|戦車|装甲|軍用車|ハーフトラック|ジープ|トラック/i.test(n)) return "タミヤ 戦車・AFV";
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母|潜水艦/i.test(n)) return "タミヤ 艦船";
      if (/1\/48|1\/72|飛行機|戦闘機|爆撃機|輸送機|ヘリ/i.test(n)) return "タミヤ 飛行機";
      if (/1\/12|バイク|オートバイ|モーターサイクル/i.test(n)) return "タミヤ バイク";
      if (/1\/24|1\/20|車|カー|レーシング|スポーツ|F1|フォーミュラ/i.test(n)) return "タミヤ 自動車";
      if (/ミニ四駆|ミニ4駆/i.test(n)) return "ミニ四駆";
      return "タミヤ";
    case "ハセガワ":
      if (/1\/72|1\/48|1\/32|飛行機|戦闘機|爆撃機|輸送機|ヘリ|航空機/i.test(n)) return "ハセガワ 飛行機";
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母/i.test(n)) return "ハセガワ 艦船";
      if (/1\/24|車|カー/i.test(n)) return "ハセガワ 自動車";
      if (/マクロス|バルキリー/i.test(n)) return "マクロス（ハセガワ）";
      if (/エヴァ|エヴァンゲリオン/i.test(n)) return "新世紀エヴァンゲリオン";
      return "ハセガワ";
    case "アオシマ":
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母|自衛隊/i.test(n)) return "アオシマ 艦船";
      if (/宇宙戦艦ヤマト|ヤマト/i.test(n)) return "宇宙戦艦ヤマト";
      if (/1\/24|車|カー|族車/i.test(n)) return "アオシマ 自動車";
      return "アオシマ";
    case "フジミ":
      if (/1\/700|1\/350|艦船|戦艦|駆逐艦|巡洋艦|空母/i.test(n)) return "フジミ 艦船";
      if (/1\/24|車|カー/i.test(n)) return "フジミ 自動車";
      if (/1\/72|1\/48|飛行機/i.test(n)) return "フジミ 飛行機";
      return "フジミ";
    case "ピットロード":
      if (/艦船|戦艦|駆逐艦|護衛艦|潜水艦/i.test(n)) return "ピットロード 艦船";
      if (/航空機|飛行機|戦闘機/i.test(n)) return "ピットロード 航空機";
      return "ピットロード";
    case "ファインモールド":
      if (/スターウォーズ|STAR WARS/i.test(n)) return "スターウォーズ（ファインモールド）";
      if (/飛行機|戦闘機|航空機/i.test(n)) return "ファインモールド 飛行機";
      return "ファインモールド";
    case "ウェーブ":
      if (/マシーネンクリーガー|Ma\.K\.|S\.F\.3\.D/i.test(n)) return "マシーネンクリーガー";
      return "ウェーブ";
    default:
      return maker;
  }
}

function guessScale(name) {
  const sm = name.match(/1\/(1700|1200|700|550|400|350|250|200|144|100|72|60|48|35|32|24|20|12)\b/);
  return sm ? `1/${sm[1]}` : "";
}

async function fetchYahooItems(query, page = 1, results = 100) {
  const start = (page - 1) * results + 1;
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&query=${encodeURIComponent(query)}&results=${results}&start=${start}&output=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`);
  return res.json();
}

async function getExistingJans(jans) {
  if (jans.length === 0) return new Set();
  const janList = jans.join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?jan=in.(${janList})&select=jan`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const data = await res.json();
  return new Set((data || []).map(r => r.jan));
}

async function upsertProducts(products) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(products),
  });
  return res.status;
}

export default async function handler(req, res) {
  const maker   = req.query.maker   || "タミヤ";
  const query   = req.query.query   || `${maker} プラモデル`;
  const page    = parseInt(req.query.page    || "1",   10);
  const dry     = req.query.dry === "1";
  const results = parseInt(req.query.results || "100", 10);

  try {
    const data = await fetchYahooItems(query, page, results);
    if (data.Error) return res.status(400).json({ error: data.Error });

    const items = data?.hits || [];

    // JANあり・重複なしのものだけ抽出
    const seen = new Set();
    const candidates = items
      .filter(item => item.janCode && item.janCode.length >= 8)
      .filter(item => { if (seen.has(item.janCode)) return false; seen.add(item.janCode); return true; })
      .map(item => {
        const name = item.name || "";
        const series = guessSeriesForMaker(name, maker);
        const scale  = guessScale(name);
        return {
          jan: item.janCode,
          name,
          image_url: item.image?.medium || item.image?.small || "",
          series,
          scale,
          maker,
        };
      });

    if (dry) {
      return res.status(200).json({
        query, maker, page,
        totalHits: data?.totalResultsAvailable || 0,
        candidates: candidates.length,
        sample: candidates.slice(0, 5),
      });
    }

    const jans = candidates.map(c => c.jan);
    const existing = await getExistingJans(jans);
    const newProducts = candidates.filter(c => !existing.has(c.jan));

    if (newProducts.length === 0) {
      return res.status(200).json({ message: "新規JANなし", existing: existing.size });
    }

    const status = await upsertProducts(newProducts);
    return res.status(200).json({
      query, maker, page,
      inserted: newProducts.length,
      skipped: existing.size,
      status,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
