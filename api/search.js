const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

function cleanName(name) {
  // 『』【】などの括弧ごと削除
  name = name.replace(/『[^』]*』/g, "");
  name = name.replace(/【[^】]*】/g, "");
  name = name.replace(/［[^］]*］/g, "");

  // 余計なワードを削除
  const noiseWords = [
    /爆買/g, /再販/g, /再生産/g, /新品/g, /送料無料/g, /即納/g, /即日/g,
    /在庫あり/g, /お得/g, /プレミアムバンダイ限定/g, /プレバン限定/g,
    /代引き不可/g, /〈プラモデル〉/g, /＜プラモデル＞/g,
    /<プラモデル>/g, /（プラモデル）/g, /プラモデル/g,
    /プラスチックモデルキット/g, /返品種別[A-Z]/g,
  ];
  for (const w of noiseWords) name = name.replace(w, "");

  // 数字コードの括弧を削除
  name = name.replace(/[（(][0-9]{4,}[）)]/g, "");

  // グレード・スケールが出てきた位置から取り出す
  const startKeywords = [
    /MGSD/, /PG/, /RG/, /HG[A-Z\s]*/, /EG/, /SD/, /MG/,
    /1\/144/, /1\/100/, /1\/60/, /1\/72/, /1\/48/, /1\/35/, /1\/24/, /1\/12/,
    /Figure-rise/, /フィギュアライズ/,
  ];
  for (const kw of startKeywords) {
    const match = name.match(kw);
    if (match) { name = name.slice(name.indexOf(match[0])); break; }
  }

  // 後半の余計な部分を削除
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

async function yahooSearch(params) {
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=5&output=json&${params}`;
  const r = await fetch(url);
  const data = await r.json();
  const hits = data?.hits || [];
  const skipWords = /中古|即納|訳あり|ジャンク|used/i;
  const clean = hits.find(h => !skipWords.test(h.name || ""));
  return clean || hits[0] || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jan, q } = req.query;

  // キーワード検索モード（部分一致）
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

  // ① まずSupabaseマスタを検索
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

  // ② マスタになければYahoo APIで検索
  try {
    const item = await yahooSearch(`jan_code=${jan}`);
    if (item?.name) return res.json({ name: cleanName(item.name), photoUrl: item.image?.medium || item.image?.small || "", price: "" });
  } catch (e) {}

  try {
    const item = await yahooSearch(`keyword=${jan}`);
    if (item?.name) return res.json({ name: cleanName(item.name), photoUrl: item.image?.medium || item.image?.small || "", price: "" });
  } catch (e) {}

  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${jan}.json`, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    if (data.status === 1) {
      const p = data.product;
      const name = p.product_name_ja || p.product_name || "";
      if (name) return res.json({ name: cleanName(name), photoUrl: p.image_front_url || "", price: "" });
    }
  } catch (e) {}

  try {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${jan}`, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    const item = data?.items?.[0];
    if (item?.title) return res.json({ name: cleanName(item.title), photoUrl: item.images?.[0] || "", price: "" });
  } catch (e) {}

  return res.status(404).json({ error: "not found" });
}
