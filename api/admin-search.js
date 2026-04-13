const YAHOO_CLIENT_ID = "dmVyPTIwMjUwNyZpZD1QaXVLMXc2cDVjJmhhc2g9TXpFMU16VTRabUUwTkdabE4yTTJNdw";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { q, start = "1" } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });

  try {
    const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&query=${encodeURIComponent(q)}&results=20&start=${start}&output=json`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.Error) return res.status(400).json({ error: data.Error.Message });

    const seen = new Set();
    const items = (data?.hits || []).map(item => ({
      name: item.name || "",
      photoUrl: item.image?.medium || item.image?.small || "",
      jan: item.janCode || "",
      scale: guessScale(item.name || ""),
    })).filter(item => {
      const key = item.jan || item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.json({ items, total: data?.totalResultsAvailable || 0 });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

function guessScale(name) {
  if (/\bMGSD\b/i.test(name)) return "MGSD";
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHG\b/i.test(name)) return "HG";
  if (/\bSD\b/i.test(name)) return "SD";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/1\/100/i.test(name)) return "1/100";
  if (/1\/144/i.test(name)) return "1/144";
  if (/1\/72/i.test(name)) return "1/72";
  if (/1\/60/i.test(name)) return "1/60";
  if (/1\/48/i.test(name)) return "1/48";
  if (/1\/35/i.test(name)) return "1/35";
  return "";
}
