const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

function cleanName(name) {
  // ① スケール・グレードキーワードが出てきた位置から取り出す
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

  // ② 不要なワードを除去（位置に関係なく）
  const removePatterns = [
    /プラスチックモデルキット\s*/g,
    /プラモデル\s*/g,
    /返品種別[A-Z]\s*/g,
    /\([0-9]{6,}\)/g,
    /【[^】]*】/g,
    /\s+バンダイ$/,
    /\s+BANDAI$/i,
  ];
  for (const p of removePatterns) {
    name = name.replace(p, "");
  }

  // ③ 末尾の不要ワードで打ち切る
  const stopKeywords = [
    /\s+機動戦士/, /\s+機動新世紀/, /\s+新機動/, /\s+閃光のハサウェイ/,
    /\s+鉄血/, /\s+水星/, /\s+SEED/, /\s+ユニコーン/,
  ];
  for (const kw of stopKeywords) {
    const match = name.match(kw);
    if (match) name = name.slice(0, name.indexOf(match[0]));
  }

  return name.replace(/\s+/g, " ").trim();
}

async function yahooSearch(params) {
  // results=5件取得して中古っぽいものを除外し最初の1件を返す
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=5&output=json&${params}`;
  const r = await fetch(url);
  const data = await r.json();
  const hits = data?.hits || [];
  // 中古・即納・訳あり等を除外
  const skipWords = /中古|即納|訳あり|ジャンク|未開封品|used/i;
  const clean = hits.find(h => !skipWords.test(h.name || ""));
  return clean || hits[0] || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { jan, q } = req.query;

  // キーワード検索モード
  if (q) {
    try {
      const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&results=5&output=json&keyword=${encodeURIComponent(q + " プラモデル")}&sort=score`;
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
        .filter(h => h.name);
      return res.json(results);
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  if (!jan) return res.status(400).json({ error: "jan or q required" });

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
