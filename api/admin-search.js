const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
    try {
        if (req.query.action === "fix-images") return await fixImages(req, res);
            const { q, start = "1" } = req.query;
                if (!q) return res.status(400).json({ error: "q required" });
                    const url = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=" + YAHOO_CLIENT_ID + "&query=" + encodeURIComponent(q) + "&results=20&start=" + start;
                        if (q === "__raw") { const rr = await fetch(url); const tt = await rr.text(); return res.json({ sta: rr.status, ylen: YAHOO_CLIENT_ID ? YAHOO_CLIENT_ID.length : 0, txt: tt.slice(0, 800) }); } const r = await fetch(url);
                            const data = await r.json();
                                const items = (data && data.hits ? data.hits : []).map(function(item) {
                                      return {
                                              name: item.name || "",
                                                      photoUrl: (item.image && item.image.medium) || "",
                                                              jan: item.janCode || "",
                                                                      scale: guessScale(item.name || "")
                                                                            };
                                                                                });
                                                                                    return res.json({ items: items, total: (data && data.totalResultsAvailable) || 0 });
                                                                                      } catch (e) {
                                                                                          return res.status(500).json({ error: String(e) });
                                                                                            }
                                                                                            }

                                                                                            async function fixImages(req, res) {
                                                                                              if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !YAHOO_CLIENT_ID) {
                                                                                                  return res.status(500).json({ error: "env missing" });
                                                                                                    }
                                                                                                      const batchSize = Math.min(parseInt(req.query.batchSize || "20", 10), 50);
                                                                                                        const h = {
                                                                                                            apikey: SUPABASE_SERVICE_ROLE_KEY,
                                                                                                                Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY
                                                                                                                  };
                                                                                                                    const sel = SUPABASE_URL + "/rest/v1/products?select=id,jan&image_url=is.null&jan=not.like.PB-*&limit=" + batchSize + "&order=id.asc";
                                                                                                                      const selResp = await fetch(sel, { headers: h });
                                                                                                                        const selText = await selResp.text();
                                                                                                                          let targets;
                                                                                                                            try {
                                                                                                                                targets = JSON.parse(selText);
                                                                                                                                  } catch (e) {
                                                                                                                                      return res.json({ done: true, updated: 0, parseErr: true, sta: selResp.status, txt: selText.slice(0, 300) });
                                                                                                                                        }
                                                                                                                                          if (!Array.isArray(targets) || targets.length === 0) {
                                                                                                                                              return res.json({
                                                                                                                                                    done: true,
                                                                                                                                                          updated: 0,
                                                                                                                                                                sta: selResp.status,
                                                                                                                                                                      isArr: Array.isArray(targets),
                                                                                                                                                                            len: Array.isArray(targets) ? targets.length : "n/a",
                                                                                                                                                                                  preview: JSON.stringify(targets).slice(0, 300)
                                                                                                                                                                                      });
                                                                                                                                                                                        }
                                                                                                                                                                                          const log = { total: targets.length, updated: 0, notFound: 0 };
                                                                                                                                                                                            for (const p of targets) {
                                                                                                                                                                                                if (!p.jan) continue;
                                                                                                                                                                                                    const yUrl = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=" + YAHOO_CLIENT_ID + "&jan_code=" + p.jan + "&results=5";
                                                                                                                                                                                                        try {
                                                                                                                                                                                                              const yd = await (await fetch(yUrl)).json();
                                                                                                                                                                                                                    const hit = (yd && yd.hits) ? yd.hits.find(function(x) { return x && x.image && x.image.medium; }) : null;
                                                                                                                                                                                                                          const img = hit && hit.image && hit.image.medium;
                                                                                                                                                                                                                                if (img) {
                                                                                                                                                                                                                                        const up = await fetch(SUPABASE_URL + "/rest/v1/products?id=eq." + p.id, {
                                                                                                                                                                                                                                                  method: "PATCH",
                                                                                                                                                                                                                                                            headers: Object.assign({}, h, { "Content-Type": "application/json", Prefer: "return=minimal" }),
                                                                                                                                                                                                                                                                      body: JSON.stringify({ image_url: img })
                                                                                                                                                                                                                                                                              });
                                                                                                                                                                                                                                                                                      if (up.ok) log.updated++;
                                                                                                                                                                                                                                                                                            } else {
                                                                                                                                                                                                                                                                                                    log.notFound++;
                                                                                                                                                                                                                                                                                                          }
                                                                                                                                                                                                                                                                                                              } catch (e) {}
                                                                                                                                                                                                                                                                                                                  await new Promise(function(r) { setTimeout(r, 400); });
                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                      return res.json(log);
                                                                                                                                                                                                                                                                                                                      }

                                                                                                                                                                                                                                                                                                                      function guessScale(name) {
                                                                                                                                                                                                                                                                                                                        if (/\bMGSD\b/i.test(name)) return "MGSD";
                                                                                                                                                                                                                                                                                                                          if (/\bPG\b/i.test(name)) return "PG";
                                                                                                                                                                                                                                                                                                                            if (/\bRG\b/i.test(name)) return "RG";
                                                                                                                                                                                                                                                                                                                              if (/\bHG\b/i.test(name)) return "HG";
                                                                                                                                                                                                                                                                                                                                if (/\bMG\b/i.test(name)) return "MG";
                                                                                                                                                                                                                                                                                                                                  if (/\bSD\b/i.test(name)) return "SD";
                                                                                                                                                                                                                                                                                                                                    return "";
                                                                                                                                                                                                                                                                                                                                    }
                                                                                                                                                                                                                                                                                                                                    