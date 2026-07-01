#!/usr/bin/env node
/**
 * TIPS記事内の商品カード（<div class="product" data-product-id="...">）について、
 * Amazon Creators API で ASIN・商品画像・価格を解決し、public/tips-products.json に書き出す。
 * loader.js がこのJSONを読み、data-product-id 一致でカードに画像・価格・直リンクを差し込む。
 *
 *   node local-tools/paapi-tips-products.js          # 収集して public/tips-products.json を更新
 *   node local-tools/paapi-tips-products.js --dry    # 表示のみ（書き込み無し）
 *
 * 認証：local-tools/.env もしくは環境変数（Secrets）：
 *   AMAZON_PAAPI_ACCESS_KEY / AMAZON_PAAPI_SECRET_KEY / AMAZON_PARTNER_TAG
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
const env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1] || process.env[k];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const MARKETPLACE = "www.amazon.co.jp";

const ROOT = path.resolve(__dirname, "..");
const TIPS = path.join(ROOT, "public", "tips");
const OUT = path.join(ROOT, "public", "tips-products.json");
const DRY = process.argv.includes("--dry");

const HARD_BAD = /中古|訳あり|ジャンク|used|未使用に近い|難あり|互換品|非純正/i;
const norm = (s) => String(s || "").toLowerCase().replace(/[\s　・()（）「」【】［］\[\].,、。/\-]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// TIPS記事から商品カードを抽出（id / 商品名 / 検索キーワード）。同一idは最初の1件。
function collectCards() {
  const cards = new Map();
  for (const f of fs.readdirSync(TIPS)) {
    if (!f.endsWith(".html") || f === "index.html") continue;
    const html = fs.readFileSync(path.join(TIPS, f), "utf8");
    const re = /data-product-id="([^"]+)"[\s\S]*?product-name">\s*([^<]+?)\s*<[\s\S]*?href="[^"]*?[?&]k=([^&"]+)/g;
    let m;
    while ((m = re.exec(html))) {
      const id = m[1];
      if (cards.has(id)) continue;
      let kw = "";
      try { kw = decodeURIComponent(m[3]).replace(/\+/g, " "); } catch (e) { kw = m[3]; }
      cards.set(id, { id, name: m[2].trim(), kw });
    }
  }
  return [...cards.values()];
}

async function getToken() {
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString(),
  });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).access_token;
}
async function search(tok, keywords) {
  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({ keywords, itemCount: 6, resources: ["itemInfo.title", "images.primary.medium", "images.primary.large", "offersV2.listings.price"], partnerTag: TAG, partnerType: "Associates" }),
  });
  if (!r.ok) throw new Error("search " + r.status + " " + (await r.text()).slice(0, 160));
  return (await r.json()).searchResult?.items || [];
}
// キーワードのトークン一致で採点。中古/訳あり等は強く減点。
function score(kw, name, title) {
  const t = norm(title); if (!t) return -999;
  let s = 0;
  for (const tok of (kw + " " + name).split(/[\s　]+/)) { const n = norm(tok); if (n.length >= 2 && t.includes(n)) s += 2; }
  if (HARD_BAD.test(title)) s -= 100;
  return s;
}

(async () => {
  if (!CID || !SEC || !TAG) { console.error("AMAZON_PAAPI_ACCESS_KEY / SECRET_KEY / PARTNER_TAG が未設定です。"); process.exit(1); }
  const cards = collectCards();
  console.log(`商品カード ${cards.length} 件を解決します。`);
  const tok = await getToken();
  const items = {};
  let ok = 0, ng = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    if (i > 0) await sleep(1200);
    // 検索語＝カードのキーワード優先、無ければ商品名
    let cands = [];
    try { cands = await search(tok, c.kw || c.name); } catch (e) { console.log(`  検索失敗 ${c.id}: ${e.message}`); }
    if (!cands.length && c.name && c.name !== c.kw) { try { await sleep(1200); cands = await search(tok, c.name); } catch (e) {} }
    const scored = cands.filter((x) => x.asin).map((x) => ({ x, s: score(c.kw, c.name, x.itemInfo?.title?.displayValue) }))
      .filter((o) => o.s > -40).sort((a, b) => b.s - a.s);
    const best = scored[0]?.x;
    if (best) {
      const amt = best.offersV2?.listings?.[0]?.price?.money?.amount;
      items[c.id] = {
        asin: best.asin,
        title: best.itemInfo?.title?.displayValue || "",
        image: best.images?.primary?.large?.url || best.images?.primary?.medium?.url || null,
        price: (amt != null) ? amt : null,
        url: `https://www.amazon.co.jp/dp/${encodeURIComponent(best.asin)}/?tag=${encodeURIComponent(TAG)}`,
      };
      ok++;
    } else { ng++; }
    if ((i + 1) % 10 === 0 || i === cards.length - 1) console.log(`  進捗 ${i + 1}/${cards.length}（解決 ${ok} / 未解決 ${ng}）`);
  }
  const out = { generatedAt: new Date().toISOString(), partnerTag: TAG, items };
  if (DRY) { console.log(`[DRY] 書き込み無し。解決 ${ok} / 未解決 ${ng}`); return; }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log(`💾 ${OUT} を更新（解決 ${ok} / 未解決 ${ng}）。commit & push で本番反映。`);
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
