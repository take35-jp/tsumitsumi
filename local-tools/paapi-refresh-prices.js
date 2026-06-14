#!/usr/bin/env node
/**
 * 定期更新用：すでに登録済みの ASIN（gears_catalog + asin_map）の
 * 価格・画像を Creators API getItems で再取得して書き戻す。
 *
 * 検索(searchItems)はせず既知ASINのみ getItems するので軽量（数十秒〜数分）。
 * Windows タスクスケジューラ等で 1日1回まわす想定。
 *
 *   node local-tools/paapi-refresh-prices.js            # dry-run（件数のみ）
 *   node local-tools/paapi-refresh-prices.js --apply    # gears_catalog + asin_map を更新
 *
 * 進捗ログ: local-tools/refresh.log
 */
const fs = require("fs");
const path = require("path");
const ENV_PATH = path.join(__dirname, ".env");
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");
const SUPABASE_URL = get("SUPABASE_URL") || "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SERVICE_ROLE = get("SUPABASE_SERVICE_ROLE_KEY");
const APPLY = process.argv.includes("--apply");

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const API_URL = "https://creatorsapi.amazon/catalog/v1/getItems";
const LOG = path.join(__dirname, "refresh.log");
const log = (m) => { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); console.log(m); };

async function token() {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString() });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
async function getItems(tok, asins) {
  const r = await fetch(API_URL, { method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": "www.amazon.co.jp" },
    body: JSON.stringify({ itemIds: asins, itemIdType: "ASIN",
      resources: ["images.primary.large", "images.primary.medium", "offersV2.listings.price"],
      partnerTag: TAG, partnerType: "Associates" }) });
  if (!r.ok) throw new Error("getItems " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).itemsResult?.items || [];
}
const sb = (p, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${p}`, {
  ...opts, headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE, "Content-Type": "application/json", ...(opts.headers || {}) } });
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

(async () => {
  fs.writeFileSync(LOG, "");
  log(APPLY ? "=== refresh (APPLY) ===" : "=== refresh (dry-run) ===");

  // 1) 対象ASIN収集
  const gcRes = await (await sb("gears_catalog?id=eq.main&select=data")).json();
  const cat = gcRes[0]?.data;
  const gearsProducts = (cat?.sections || []).flatMap((s) => s.products || []).filter((p) => p.asin);
  const amRows = await (await sb("asin_map?select=key,asin,title,image_url,price,confidence,source")).json();

  const asinSet = new Set([...gearsProducts.map((p) => p.asin), ...amRows.map((r) => r.asin)]);
  const asins = [...asinSet];
  log(`対象ASIN: ${asins.length} 件 (gears ${gearsProducts.length} / asin_map ${amRows.length})`);

  // 2) getItems で最新の price/image を取得
  const tok = await token();
  const info = {}; // asin -> {price, image}
  const batches = chunk(asins, 10);
  let fetched = 0;
  for (let i = 0; i < batches.length; i++) {
    try {
      const items = await getItems(tok, batches[i]);
      for (const it of items) {
        const price = it.offersV2?.listings?.[0]?.price?.money?.amount;
        const image = it.images?.primary?.large?.url || it.images?.primary?.medium?.url;
        info[it.asin] = { price: price != null ? price : null, image: image || null };
        fetched++;
      }
    } catch (e) { log(`  batch ${i + 1}/${batches.length} err: ${e.message.slice(0, 80)}`); }
    if ((i + 1) % 10 === 0 || i === batches.length - 1) log(`  ${i + 1}/${batches.length} バッチ (取得 ${fetched})`);
    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }

  // 3) 差分集計
  let gPrice = 0, gImg = 0, aPrice = 0, aImg = 0;
  for (const p of gearsProducts) { const n = info[p.asin]; if (!n) continue;
    if (n.price != null && String(n.price) !== String(p.price)) gPrice++;
    if (n.image && n.image !== p.image) gImg++; }
  for (const r of amRows) { const n = info[r.asin]; if (!n) continue;
    if (n.price != null && n.price !== r.price) aPrice++;
    if (n.image && n.image !== r.image_url) aImg++; }
  log(`差分: gears(価格${gPrice}/画像${gImg}) asin_map(価格${aPrice}/画像${aImg})`);

  if (!APPLY) { log("[dry-run] 書き込みなし。--apply で反映。"); return; }

  // 4) gears_catalog 反映（price/image 上書き）
  for (const p of gearsProducts) { const n = info[p.asin]; if (!n) continue;
    if (n.price != null) p.price = String(n.price);
    if (n.image) p.image = n.image; }
  const up1 = await sb("gears_catalog?on_conflict=id", { method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ id: "main", data: cat }]) });
  log(up1.ok ? "✓ gears_catalog 更新" : `✗ gears_catalog 失敗 ${up1.status}`);

  // 5) asin_map 反映（key単位で upsert）
  const rows = amRows.map((r) => { const n = info[r.asin] || {};
    return { key: r.key, asin: r.asin, title: r.title || null,
      image_url: n.image || r.image_url || null, price: (n.price != null) ? n.price : r.price,
      confidence: r.confidence, source: r.source, last_checked_at: new Date().toISOString() }; });
  let ok = 0;
  for (const c of chunk(rows, 100)) {
    const r = await sb("asin_map", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(c) });
    if (r.ok) ok += c.length; else log(`  asin_map chunk失敗 ${r.status} ${(await r.text()).slice(0,100)}`);
  }
  log(`✓ asin_map 更新 ${ok}/${rows.length}`);
  log("=== done ===");
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
