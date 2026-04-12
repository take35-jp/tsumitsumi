const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

function cleanName(name) {
  const startKeywords = [
    /\bPG\b/, /\bMG\b/, /\bRG\b/, /\bHG\b/, /\bEG\b/, /\bSD\b/, /\bMGSD\b/,
    /1\/144/, /1\/100/, /1\/60/, /1\/72/, /1\/35/, /1\/24/, /1\/12/,
  ];
  for (const kw of startKeywords) {
    const match = name.match(kw);
    if (match) { name = name.slice(name.indexOf(match[0])); break; }
  }
  const stopKeywords = [
    /\s+プラモデル/, /\s+バンダイ/, /\s+BANDAI/i,
    /\s+機動戦士/, /\s+機動新世紀/, /\s+新機動/, /\s+閃光/,
    /\s+鉄血/, /\s+水星/, /\s+SEED/, /\s+ユニコーン/,
    /\([0-9]{6,}\)/,
  ];
  for (const kw of stopKeywords) {
    const match = name.match(kw);
    if (match) name = name.slice(0, name.indexOf(match[0]));
  }
  return name.replace(/\s+/g, " ").trim();
}

function guessScale(name) {
  if (/\bMGSD\b/i.test(name)) return "MGSD";
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHG\b/i.test(name)) return "HG";
  if (/\bEG\b/i.test(name)) return "HG";
  if (/\bSD\b/i.test(name)) return "SD";
  if (/1\/100/i.test(name)) return "1/100";
  if (/1\/144/i.test(name)) return "1/144";
  return "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { grade, page = "1" } = req.query;
  if (!grade) return res.status(400).json({ error: "grade required" });

  const gradeKeywords = {
    MG:   "MG 1/100 ガンプラ",
    HG:   "HG 1/144 ガンプラ",
    RG:   "RG 1/144 ガンプラ",
    PG:   "PG ガンプラ",
    SD:   "SD ガンプラ BB戦士",
    MGSD: "MGSD ガンプラ",
  };

  const keyword = gradeKeywords[grade];
  if (!keyword) return res.status(400).json({ error: "invalid grade" });

  const start = (Number(page) - 1) * 30 + 1;

  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&keyword=${encodeURIComponent(keyword)}&results=30&start=${start}&output=json&sort=-score`;
    const r = await fetch(url);
    const data = await r.json();

    const items = (data?.hits || []).map(item => ({
      name: cleanName(item.name || ""),
      rawName: item.name || "",
      scale: guessScale(item.name || ""),
      photoUrl: item.image?.medium || item.image?.small || "",
      jan: item.janCode || "",
      price: item.price ? String(item.price) : "",
    })).filter(item => item.name.length > 2);

    return res.json({
      items,
      total: data?.totalResultsAvailable || 0,
      page: Number(page),
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
