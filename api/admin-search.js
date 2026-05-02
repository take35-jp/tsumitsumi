const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
    try {
        if (req.query.action === "fix-images") return await fixImages(req, res); if (req.query.action === "price-check") return await priceCheck(req, res); if (req.query.action === "price-check") return await priceCheck(req, res); if (req.query.action === "retail-price") return await getRetailPrice(req, res);
            const { q, start = "1" } = req.query;
                if (!q) return res.status(400).json({ error: "q required" });
                    const url = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=" + YAHOO_CLIENT_ID + "&query=" + encodeURIComponent(q) + "&results=20&start=" + start;
                        const r = await fetch(url);
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
                                                                                                                                                                                                                                                                                                                                    

                                                                                                                                                                                                                                                                                                                                    async function priceCheck(req, res) { const jan = req.query.jan; if (!jan) return res.status(400).json({ error: "jan required" }); try { const ua = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" }; const sR = await fetch("https://www.1999.co.jp/?searchword=" + encodeURIComponent(jan), { headers: ua }); const sHtml = await sR.text(); const idMatch = sHtml.match(/ItemCode="(\d{7,9})"/); if (!idMatch) return res.json({ jan: jan, found: false, reason: "no-result" }); const itemId = idMatch[1]; const dR = await fetch("https://www.1999.co.jp/" + itemId, { headers: ua }); const dHtml = await dR.text(); const priceMatch = dHtml.match(/販売価格[\s\S]{0,200}?¥<span>([\d,]+)<\/span>/); const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null; const titleMatch = dHtml.match(/<title>([^<]+)<\/title>/); return res.json({ jan: jan, found: true, itemId: itemId, price: price, title: titleMatch ? titleMatch[1].trim() : null, detailUrl: "https://www.1999.co.jp/" + itemId }); } catch (e) { return res.status(500).json({ jan: jan, error: String(e) }); } }

// ====== 希望小売価格を外部ソースから取得 ======
// チェーン: ホビーサーチ(JAN+gtin13検証) → プレミアムバンダイ(name+トークン一致) → Yahoo Shopping fixedPrice
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
};

function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, timeoutMs || 4500);
  return fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }))
    .finally(function() { clearTimeout(timer); });
}

async function getRetailPrice(req, res) {
  const jan = (req.query.jan || "").toString().trim();
  const name = (req.query.name || "").toString().trim();
  if (!jan && !name) {
    return res.status(400).json({ error: "jan or name required" });
  }
  const errors = [];
  if (jan) {
    try {
      const result = await tryHobbySearch(jan);
      if (result) return res.json(result);
    } catch (e) { errors.push("hobbysearch: " + (e.message || String(e))); }
  }
  if (name) {
    try {
      const result = await tryPBandai(name);
      if (result) return res.json(result);
    } catch (e) { errors.push("pbandai: " + (e.message || String(e))); }
  }
  if (jan) {
    try {
      const result = await tryYahooFixed(jan);
      if (result) return res.json(result);
    } catch (e) { errors.push("yahoo: " + (e.message || String(e))); }
  }
  return res.status(404).json({ error: "not found", attempts: errors });
}

async function tryHobbySearch(jan) {
  const searchUrl = "https://www.1999.co.jp/search?word=" + encodeURIComponent(jan);
  let searchHtml;
  try {
    const sr = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 4500);
    if (!sr.ok) return null;
    searchHtml = await sr.text();
  } catch (e) { return null; }

  const linkRe = /<a[^>]*class="c-card__(?:th|info)-links"[^>]*href="\/(\d{6,})"/g;
  const candidateIds = [];
  let m;
  while ((m = linkRe.exec(searchHtml)) !== null) {
    if (candidateIds.indexOf(m[1]) === -1) candidateIds.push(m[1]);
  }
  if (candidateIds.length === 0) return null;

  for (let i = 0; i < Math.min(candidateIds.length, 3); i++) {
    const id = candidateIds[i];
    const productUrl = "https://www.1999.co.jp/" + id;
    try {
      const pr = await fetchWithTimeout(productUrl, { headers: BROWSER_HEADERS }, 4500);
      if (!pr.ok) continue;
      const html = await pr.text();

      const gtinMatch = html.match(/"gtin13"\s*:\s*"(\d{13})"/);
      if (!gtinMatch || gtinMatch[1] !== jan) continue;

      const nameMatch = html.match(/"@type"\s*:\s*"Product"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"/);
      const productName = nameMatch ? nameMatch[1] : "";

      const stickerMatch = html.match(/<div[^>]+id="masterBody_stickerPrice"[^>]*>\s*<del>\s*メーカー希望小売価格[：:]\s*&yen;([\d,]+)\s*\(税込\)\s*<\/del>/);
      if (stickerMatch) {
        const price = parseInt(stickerMatch[1].replace(/,/g, ""), 10);
        if (price > 0) {
          return { price: price, source: "ホビーサーチ", product_name: productName, source_url: productUrl };
        }
      }
      const elemMatch = html.match(/c-product-detail__info-price-element[^>]*>¥<span>([\d,]+)<\/span>/);
      if (elemMatch) {
        const price = parseInt(elemMatch[1].replace(/,/g, ""), 10);
        if (price > 0) {
          return { price: price, source: "ホビーサーチ", product_name: productName, source_url: productUrl };
        }
      }
    } catch (e) { /* try next */ }
    await new Promise(function(r) { setTimeout(r, 250); });
  }
  return null;
}

async function tryPBandai(name) {
  const searchUrl = "https://p-bandai.jp/search/?q=" + encodeURIComponent(name);
  let html;
  try {
    const r = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 4500);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    html = new TextDecoder("shift_jis").decode(buf);
  } catch (e) { return null; }

  const cardRe = /<a href="\/item\/(item-\d+)\/"><img[^>]*alt="([^"]+)"[^>]*>[\s\S]{0,500}?<p class="price">([\d,]+)円(?:[（(])税込(?:[）)])<\/p>/g;
  const candidates = [];
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const price = parseInt(m[3].replace(/,/g, ""), 10);
    if (price > 0) candidates.push({ id: m[1], title: m[2], price: price });
  }
  if (candidates.length === 0) return null;

  const tokens = name.split(/[\s　・]+/).filter(function(t) { return t.length >= 2; });
  if (tokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let score = 0;
    for (let j = 0; j < tokens.length; j++) {
      if (c.title.indexOf(tokens[j]) !== -1) score++;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  const threshold = Math.max(2, Math.ceil(tokens.length * 0.6));
  if (!best || bestScore < threshold) return null;

  return {
    price: best.price,
    source: "プレミアムバンダイ",
    product_name: best.title,
    source_url: "https://p-bandai.jp/item/" + best.id + "/",
  };
}

async function tryYahooFixed(jan) {
  if (!YAHOO_CLIENT_ID) return null;
  const url = "https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=" + YAHOO_CLIENT_ID + "&jan_code=" + encodeURIComponent(jan) + "&results=10";
  try {
    const r = await fetchWithTimeout(url, {}, 4500);
    if (!r.ok) return null;
    const data = await r.json();
    const hits = (data && data.hits) ? data.hits : [];
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const fp = h && h.priceLabel && h.priceLabel.fixedPrice;
      if (fp && fp > 0) {
        return {
          price: fp,
          source: "Yahoo Shopping (定価)",
          product_name: h.name || "",
          source_url: h.url || "",
        };
      }
    }
  } catch (e) {}
  return null;
}
