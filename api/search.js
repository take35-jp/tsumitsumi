const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

function cleanName(name) {
  const startKeywords = [
    /\bPG\b/, /\bMG\b/, /\bRG\b/, /\bHG\b/, /\bEG\b/, /\bSD\b/,
    /1\/144/, /1\/100/, /1\/60/, /1\/72/, /1\/35/, /1\/24/, /1\/12/,
    /Figure-rise/, /フィギュアライズ/,
  ];
  for (const kw of startKeywords) {
    const match = name.match(kw);
    if (match) {
      name = name.slice(name.indexOf(match[0]));
      break;
    }
  }
  const stopKeywords = [
    /\s+プラモデル/, /\s+バンダイ/, /\s+BANDAI/i,
    /\s+タミヤ/, /\s+TAMIYA/i, /\s+ハセガワ/, /\s+アオシマ/, /\s+フジミ/,
    /\s+機動戦士/, /\s+機動新世紀/, /\s+新機動/, /\s+閃光のハサウェイ/,
    /\s+鉄血/, /\s+水星/, /\s+SEED/, /\s+ユニコーン/,
    /\([0-9]{6,}\)/,
  ];
  for (const kw of stopKeywords) {
    const match = name.match(kw);
    if (match) name = name.slice(0, name.indexOf(match[0]));
  }
  return name.replace(/\s+/g, " ").trim();
}

async function yahooSearch(params) {
  const base = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch";
  const url = `${base}?appid=${YAHOO_CLIENT_ID}&results=1&output=json&${params}`;
  const r = await fetch(url);
  const data = await r.json();
  return data?.hits?.[0] || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jan } = req.query;
  if (!jan) return res.status(400).json({ error: "jan required" });

  // ① Yahoo jan_codeで検索
  try {
    const item = await yahooSearch(`jan_code=${jan}`);
    if (item?.name) {
      return res.json({ name: cleanName(item.name), photoUrl: item.image?.medium || item.image?.small || "", price: "" });
    }
  } catch (e) {}

  // ② Yahoo keywordでJANコードを検索
  try {
    const item = await yahooSearch(`keyword=${jan}`);
    if (item?.name) {
      return res.json({ name: cleanName(item.name), photoUrl: item.image?.medium || item.image?.small || "", price: "" });
    }
  } catch (e) {}

  // ③ Open Food Facts
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${jan}.json`, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    if (data.status === 1) {
      const p = data.product;
      const name = p.product_name_ja || p.product_name || "";
      if (name) return res.json({ name: cleanName(name), photoUrl: p.image_front_url || "", price: "" });
    }
  } catch (e) {}

  // ④ UPCItemDB
  try {
    const r = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${jan}`, { headers: { "User-Agent": "TsumiTsumi/1.0" } });
    const data = await r.json();
    const item = data?.items?.[0];
    if (item?.title) return res.json({ name: cleanName(item.title), photoUrl: item.images?.[0] || "", price: "" });
  } catch (e) {}

  return res.status(404).json({ error: "not found" });
}
