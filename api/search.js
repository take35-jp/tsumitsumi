const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

// 楽天AppID は Vercel 環境変数 RAKUTEN_APP_ID に設定してください
const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "";

// ---------- 名前クリーニング ----------
function cleanName(name) {
  name = name.replace(/『[^』]*』/g, "");
  name = name.replace(/【[^】]*】/g, "");
  name = name.replace(/［[^］]*］/g, "");

  const noiseWords = [
    /爆買/g, /再販/g, /再生産/g, /新品/g, /送料無料/g, /即納/g, /即日/g,
    /在庫あり/g, /お得/g, /プレミアムバンダイ限定/g, /プレバン限定/g,
    /代引き不可/g, /〈プラモデル〉/g, /＜プラモデル＞/g,
    /<プラモデル>/g, /（プラモデル）/g, /プラモデル/g,
    /プラスチックモデルキット/g, /返品種別[A-Z]/g,
  ];
  for (const w of noiseWords) name = name.replace(w, "");

  name = name.replace(/[（(][0-9]{4,}[）)]/g, "");

  const startKeywords = [
    /MGSD/, /PG/, /RG/, /HGUC/, /HGCE/, /HGBD/, /HG/, /EG/, /SD/, /MG/,
    /1\/144/, /1\/100/, /1\/60/, /1\/72/, /1\/48/, /1\/35/, /1\/24/, /1\/12/,
    /Figure-rise/, /フィギュアライズ/,
    /30MM/, /30MS/, /ヘキサギア/, /メガミデバイス/, /フレームアームズ/,
  ];
  for (const kw of startKeywords) {
    const match = name.match(kw);
    if (match) { name = name.slice(name.indexOf(match[0])); break; }
  }

  const stopKeywords = [
    /\s+機動戦士ガンダム(?!X|W|F91|V|00|SEED)/, /\s+機動新世紀/, /\s+新機動/,
    /\s+閃光のハサウェイ/, /\s+鉄血のオルフェンズ/, /\s+水星の魔女/,
    /\s+ガンダムSEED(?!DESTINY)/, /\s+バンダイ/, /\s+BANDAI/i,
    /\s+爆買/, /\s+再販/,
  ];
  for (const kw of stopKeywords) {
    const match = name.match(kw);
    if (match) name = name.slice(0, name.indexOf(match[0]));
  }

  name = name.replace(/&amp;/g, "&");
  return name.replace(/\s+/g, " ").trim();
}

// ---------- Yahoo!ショッピング ----------
async function yahooSearch(params) {
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=5&output=json&${params}`;
  const r = await fetch(url);
  const data = await r.json();
  const hits = data?.hits || [];
  const skipWords = /中古|即納|訳あり|ジャンク|used/i;
  const clean = hits.find(h => !skipWords.test(h.name || ""));
  return clean || hits[0] || null;
}

function formatYahooResult(item) {
  return {
    name: cleanName(item.name || ""),
    photoUrl: item.image?.medium || item.image?.small || "",
    price: item.price ? String(item.price) : "",
    source: "yahoo",
  };
}

// ---------- 楽天ブックス（Figure-rise・ねんどろいど・figma 等に強い） ----------
async function rakutenBooksSearch(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/BooksTotal/Search/20170404?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=5&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const item = data?.Items?.[0]?.Item;
    if (!item?.title) return null;
    return {
      name: cleanName(item.title),
      photoUrl: item.largeImageUrl || item.mediumImageUrl || "",
      price: item.itemPrice ? String(item.itemPrice) : "",
      source: "rakuten_books",
    };
  } catch (e) {
    return null;
  }
}

// ---------- 楽天市場（コトブキヤ・タミヤ・アオシマ等の補完） ----------
async function rakutenIchibaSearch(jan) {
  if (!RAKUTEN_APP_ID) return null;
  try {
    const url = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?applicationId=${RAKUTEN_APP_ID}&keyword=${encodeURIComponent(jan)}&hits=5&sort=%2BitemPrice&format=json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    const items = data?.Items || [];
    const skipWords = /中古|即納|訳あり|ジャンク|used/i;
    const item = items.find(i => !skipWords.test(i.Item?.itemName || ""))?.Item;
    if (!item?.itemName) return null;
    return {
      name: cleanName(item.itemName),
      photoUrl: item.mediumImageUrls?.[0]?.imageUrl || item.smallImageUrls?.[0]?.imageUrl || "",
      price: item.itemPrice ? String(item.itemPrice) : "",
      source: "rakuten_ichiba",
    };
  } catch (e) {
    return null;
  }
}

// ---------- メインハンドラ ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jan, q } = req.query;

  // ── キーワード検索モード（手動登録の候補表示） ──
  if (q) {
    try {
      const query = encodeURIComponent(q + " プラモデル");
      const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=8&output=json&query=${query}`;
      const r = await fetch(url);
      const data = await r.json();
      const hits = data?.hits || [];
      const skipWords = /中古|即納|訳あり|ジャンク|used/i;
      const results = hits
        .filter(h => !skipWords.test(h.name || ""))
        .slice(0, 5)
        .map(h => ({
          name: cleanName(h.name || ""),
          photoUrl: h.image?.medium || h.image?.small || "",
          price: h.price || "",
        }))
        .filter(h => h.name.length > 0);
      return res.json(results);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  if (!jan) return res.status(400).json({ error: "jan or q required" });

  // ① Supabaseマスタ（最優先・最速）
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/products?jan=eq.${encodeURIComponent(jan)}&limit=1`, {
      headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const data = await r.json();
    const master = data?.[0];
    if (master?.name) {
      return res.json({
        name: master.name,
        photoUrl: master.image_url || "",
        price: "",
        series: master.series || "",
        scale: master.scale || "",
        maker: master.maker || "",
        source: "master",
      });
    }
  } catch (e) {}

  // ② Yahoo! jan_code パラメータ（JANコード専用・精度高）
  try {
    const item = await yahooSearch(`jan_code=${jan}`);
    if (item?.name) return res.json(formatYahooResult(item));
  } catch (e) {}

  // ③ Yahoo! keyword フォールバック
  try {
    const item = await yahooSearch(`keyword=${jan}`);
    if (item?.name) return res.json(formatYahooResult(item));
  } catch (e) {}

  // ④ 楽天ブックス（Figure-rise・ねんどろいど・figma 等に強い）
  const rBooks = await rakutenBooksSearch(jan);
  if (rBooks?.name) return res.json(rBooks);

  // ⑤ 楽天市場（コトブキヤ・タミヤ・アオシマ等の補完）
  const rIchiba = await rakutenIchibaSearch(jan);
  if (rIchiba?.name) return res.json(rIchiba);

  return res.status(404).json({ error: "not found" });
}
