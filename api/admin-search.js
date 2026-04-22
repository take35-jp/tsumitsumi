const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");

  const { q, start = "1" } = req.query;
    if (req.query.action === "fix-images") { return await fixImages(req, res); } if (!q) return res.status(400).json({ error: "q required" });

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

async function fixImages(req, res) {
    const URL = process.env.SUPABASE_URL;
      const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!URL || !KEY || !YAHOO_CLIENT_ID) return res.status(500).json({ error: "env missing" });
          const batchSize = Math.min(parseInt(req.query.batchSize || "20", 10), 50);
            const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };
              const sel = `${URL}/rest/v1/products?select=id,jan&image_url=is.null&jan=not.like.PB-*&limit=${batchSize}&order=id.asc`;
                const targets = await (await fetch(sel, { headers: h })).json();
                  if (!Array.isArray(targets) || !targets.length) return res.json({ done: true, updated: 0 });
                    const log = { total: targets.length, updated: 0, notFound: 0 };
                      for (const p of targets) {
                          const yUrl = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${p.jan}&results=5`;
                              try {
                                    const yr = await fetch(yUrl);
                                          const yd = await yr.json();
                                                const img = yd?.hits?.find(x => x?.image?.medium)?.image?.medium;
                                                      if (img) {
                                                              const up = await fetch(`${URL}/rest/v1/products?id=eq.${p.id}`, { method: "PATCH", headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ image_url: img }) });
                                                                      if (up.ok) log.updated++;
                                                                            } else log.notFound++;
                                                                                } catch(e){}
                                                                                    await new Promise(r => setTimeout(r, 400));
                                                                                      }
                                                                                        return res.json(log);
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
