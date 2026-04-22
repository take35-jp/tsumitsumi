// 画像URL補完API - Yahoo Shopping APIでJAN検索して image_url=null の商品を補完
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchImageByJan(jan) {
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${jan}&results=5`;
    try {
        const r = await fetch(url);
            if (!r.ok) return null;
                const data = await r.json();
                    if (!data.hits || !data.hits.length) return null;
                        for (const h of data.hits) {
                              const img = h?.image?.medium || h?.image?.small;
                                    if (img) return img;
                                        }
                                            return null;
                                              } catch (e) {
                                                  return null;
                                                    }
                                                    }

                                                    export default async function handler(req, res) {
                                                      res.setHeader("Access-Control-Allow-Origin", "*");
                                                        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !YAHOO_CLIENT_ID) {
                                                            return res.status(500).json({ error: "Missing env vars" });
                                                              }

                                                                const batchSize = Math.min(parseInt(req.query.batchSize || "20", 10), 200);
                                                                  const delay = parseInt(req.query.delay || "500", 10);

                                                                    const h = {
                                                                        apikey: SUPABASE_SERVICE_ROLE_KEY,
                                                                            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                                                                              };

                                                                                // image_url=null の商品を取得（バンダイ優先）
                                                                                  const selectUrl = `${SUPABASE_URL}/rest/v1/products?select=id,jan,name&image_url=is.null&jan=not.like.PB-*&limit=${batchSize}&order=id.asc`;
                                                                                    const targets = await (await fetch(selectUrl, { headers: h })).json();

                                                                                      if (!Array.isArray(targets) || targets.length === 0) {
                                                                                          return res.status(200).json({ done: true, message: "no targets", updated: 0 });
                                                                                            }

                                                                                              const log = { total: targets.length, updated: 0, notFound: 0, errors: [] };

                                                                                                for (const p of targets) {
                                                                                                    if (!p.jan || p.jan.startsWith("PB-")) continue;
                                                                                                        const img = await fetchImageByJan(p.jan);
                                                                                                            if (img) {
                                                                                                                  const up = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${p.id}`, {
                                                                                                                          method: "PATCH",
                                                                                                                                  headers: { ...h, "Content-Type": "application/json", Prefer: "return=minimal" },
                                                                                                                                          body: JSON.stringify({ image_url: img }),
                                                                                                                                                });
                                                                                                                                                      if (up.ok) log.updated++;
                                                                                                                                                            else log.errors.push(`up ${p.id}: ${up.status}`);
                                                                                                                                                                } else {
                                                                                                                                                                      log.notFound++;
                                                                                                                                                                          }
                                                                                                                                                                              await sleep(delay);
                                                                                                                                                                                }

                                                                                                                                                                                  return res.status(200).json(log);
                                                                                                                                                                                  }
                                                                                                                                                                                  