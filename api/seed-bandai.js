// api/seed-bandai.js
// バンダイ製品のJANコードをYahoo!ショッピングAPIから大量取得してSupabaseに登録する
// 呼び出し: GET /api/seed-bandai?query=HGガンプラ&page=1&dry=1
// dry=1 のとき実際には登録せず件数のみ返す

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

// シリーズ・スケール推定
function guessSeriesAndScale(name) {
  let series = "ガンプラ";
  let scale = "";

  if (/MGSD/i.test(name))   { scale = "MGSD"; }
  else if (/\bPG\b/i.test(name))  { scale = "PG"; }
  else if (/\bMG\b/i.test(name))  { scale = "MG"; }
  else if (/\bRG\b/i.test(name))  { scale = "RG"; }
  else if (/\bHG\b/i.test(name))  { scale = "HG"; }
  else if (/\bEG\b/i.test(name))  { scale = "HG"; }
  else if (/\bSD\b/i.test(name))  { scale = "SD"; }
  else if (/1\/60/i.test(name))   { scale = "1/60"; }
  else if (/1\/100/i.test(name))  { scale = "1/100"; }
  else if (/1\/144/i.test(name))  { scale = "1/144"; }

  if (/30MM|30 Minutes Missions/i.test(name))  series = "30 Minutes Missions";
  else if (/30MS|30 Minutes Sisters/i.test(name)) series = "30 Minutes Sisters";
  else if (/30MF|30 Minutes Fantasy/i.test(name)) series = "30 Minutes Fantasy";
  else if (/30MP|30 Minutes Preference/i.test(name)) series = "30 Minutes Preference";
  else if (/Figure-rise/i.test(name)) series = "Figure-rise Standard";
  else if (/ポケモン|ポケットモンスター/i.test(name)) series = "ポケプラ";
  else if (/ゾイド|ZOIDS/i.test(name)) series = "ゾイド";
  else if (/ウルトラマン/i.test(name)) series = "ウルトラマン";
  else if (/仮面ライダー/i.test(name)) series = "仮面ライダー";
  else if (/スーパーロボット|スパロボ/i.test(name)) series = "ガンプラ";
  else if (/エヴァ|エヴァンゲリオン|EVA/i.test(name)) series = "新世紀エヴァンゲリオン";
  else if (/マクロス/i.test(name)) series = "マクロス";
  else if (/スターウォーズ|STAR WARS/i.test(name)) series = "スターウォーズ";
  else if (/ルパン三世/i.test(name)) series = "ルパン三世";
  else if (/ミニ四駆/i.test(name)) { series = "ミニ四駆"; scale = ""; }
  else if (/タミヤ|TAMIYA/i.test(name)) series = "タミヤ 戦車";
  else if (/ガンダム|Gundam/i.test(name)) series = "ガンプラ";

  return { series, scale };
}

// Yahoo!ショッピングから商品取得
async function fetchYahooItems(query, page = 1, hits = 100) {
  const params = new URLSearchParams({
    appid: YAHOO_CLIENT_ID,
    query: query,
    hits: String(hits),
    start: String((page - 1) * hits + 1),
    seller_id: "all",
    jan_code: "all",
    sort: "-sold",
    jan_code_type: "all",
  });
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`);
  return res.json();
}

// Supabaseに既存JANか確認
async function getExistingJans(jans) {
  if (jans.length === 0) return new Set();
  const janList = jans.map(j => `"${j}"`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?jan=in.(${janList})&select=jan`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  const data = await res.json();
  return new Set((data || []).map(r => r.jan));
}

// Supabaseにupsert
async function upsertProducts(products) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(products),
    }
  );
  return res.status;
}

export default async function handler(req, res) {
  const query   = req.query.query || "バンダイ プラモデル ガンプラ HG";
  const page    = parseInt(req.query.page || "1", 10);
  const dry     = req.query.dry === "1";
  const hits    = parseInt(req.query.hits || "100", 10);

  try {
    const data = await fetchYahooItems(query, page, hits);
    const items = data?.hits || [];

    // JANコードがあるもののみ抽出
    const candidates = items
      .filter(item => item.jan && item.jan.length >= 8)
      .map(item => {
        const name = item.name || "";
        const { series, scale } = guessSeriesAndScale(name);
        return {
          jan: item.jan,
          name: name,
          image_url: item.image?.medium || "",
          series,
          scale,
          maker: "バンダイ",
        };
      });

    if (dry) {
      return res.status(200).json({
        query,
        page,
        totalHits: data?.totalResultsAvailable || 0,
        candidates: candidates.length,
        sample: candidates.slice(0, 5),
      });
    }

    // 既存JANを除外
    const jans = candidates.map(c => c.jan);
    const existing = await getExistingJans(jans);
    const newProducts = candidates.filter(c => !existing.has(c.jan));

    if (newProducts.length === 0) {
      return res.status(200).json({ message: "新規JANなし", existing: existing.size });
    }

    const status = await upsertProducts(newProducts);
    return res.status(200).json({
      query, page,
      inserted: newProducts.length,
      skipped: existing.size,
      status,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
