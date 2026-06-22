#!/usr/bin/env node
/**
 * TIPS記事の未対応カード(検索URLフォールバック/画像なし)に対し、
 * Creators API で ASIN・画像・価格を取得して asin_map に upsert する。
 * key は記事カードの data-product-id と一致させる（loader.js が引ける）。
 *
 *   node local-tools/_fill-tips-asins.js          # dry-run（候補表示のみ）
 *   node local-tools/_fill-tips-asins.js --upsert # asin_map へ書き込み
 */
const fs = require("fs"), path = require("path");
const ENV = path.join(__dirname, ".env");
const env = fs.readFileSync(ENV, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const CID = get("AMAZON_PAAPI_ACCESS_KEY"), SEC = get("AMAZON_PAAPI_SECRET_KEY"), TAG = get("AMAZON_PARTNER_TAG");
const SUPA = get("SUPABASE_URL"), SR = get("SUPABASE_SERVICE_ROLE_KEY");
const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const GET_URL = "https://creatorsapi.amazon/catalog/v1/getItems";
const MK = "www.amazon.co.jp";
const UPSERT = process.argv.includes("--upsert");

// 対象8件。asin = 既知ASIN（getItems）、無ければ q で searchItems。
const TARGETS = [
  { key: "tips-airbrush-comp-l5",     name: "Mr.リニアコンプレッサーL5",        asin: "B0FJKYQ93S" },
  { key: "tips-airbrush-comp-tamiya", name: "タミヤ スプレーワークコンプレッサー", asin: "B006Y3VZV0" },
  { key: "tips-gundam-marker-sumi",   name: "ガンダムマーカー スミ入れ用ブラック", asin: "B0B2P7SL9W" },
  { key: "tips-realtouch-grey-set",   name: "リアルタッチマーカー グレーセット", asin: "B0D2XBM3G5" },
  { key: "tips-topcoat-premium",      name: "Mr.プレミアムトップコート 水性",    asin: "B0FT822TDR" },
  { key: "tips-topcoat-superclear3",  name: "Mr.スーパークリアーIII UVカット",   asin: "B002DTL7ZS" },
];

async function token() {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString() });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}
const RES = ["itemInfo.title", "images.primary.large", "images.primary.medium", "offersV2.listings.price"];
async function search(tok, keywords) {
  const r = await fetch(SEARCH_URL, { method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": MK },
    body: JSON.stringify({ keywords, itemCount: 3, resources: RES, partnerTag: TAG, partnerType: "Associates" }) });
  if (!r.ok) throw new Error("search " + r.status + " " + (await r.text()).slice(0, 160));
  return (await r.json()).searchResult?.items || [];
}
async function getItems(tok, asins) {
  const r = await fetch(GET_URL, { method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": MK },
    body: JSON.stringify({ itemIds: asins, itemIdType: "ASIN", resources: RES, partnerTag: TAG, partnerType: "Associates" }) });
  if (!r.ok) throw new Error("getItems " + r.status + " " + (await r.text()).slice(0, 160));
  return (await r.json()).itemsResult?.items || [];
}
function pick(it) {
  return {
    asin: it.asin,
    title: it.itemInfo?.title?.displayValue || "",
    image_url: it.images?.primary?.large?.url || it.images?.primary?.medium?.url || null,
    price: it.offersV2?.listings?.[0]?.price?.money?.amount ?? null,
  };
}
async function upsert(rows) {
  const r = await fetch(`${SUPA}/rest/v1/asin_map`, { method: "POST",
    headers: { apikey: SR, Authorization: "Bearer " + SR, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows) });
  if (!r.ok) throw new Error("upsert " + r.status + " " + (await r.text()).slice(0, 200));
}
(async () => {
  const tok = await token();
  const out = [];
  for (const t of TARGETS) {
    try {
      let cand;
      if (t.asin) {
        const items = await getItems(tok, [t.asin]);
        cand = items.length ? [pick(items[0])] : [];
        console.log(`\n### ${t.key}  (getItems ${t.asin})`);
      } else {
        const items = await search(tok, t.q);
        cand = items.map(pick);
        console.log(`\n### ${t.key}  (search: ${t.q})`);
      }
      cand.forEach((c, i) => console.log(`  [${i}] ${c.asin}  ¥${c.price}  ${c.title?.slice(0, 70)}  img=${c.image_url ? "y" : "n"}`));
      if (cand[0]?.asin) out.push({ key: t.key, asin: cand[0].asin, title: cand[0].title, image_url: cand[0].image_url, price: cand[0].price, source: "paapi", confidence: "manual", notes: "tips card " + t.key });
    } catch (e) { console.log(`  !! ${t.key}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 1400));
  }
  fs.writeFileSync(path.join(__dirname, "tips-asins-results.json"), JSON.stringify(out, null, 2));
  console.log(`\n候補 ${out.length}/${TARGETS.length} 件を tips-asins-results.json に保存。`);
  if (UPSERT && out.length) { await upsert(out); console.log(`✅ asin_map へ ${out.length} 件 upsert 完了`); }
  else console.log("（dry-run。--upsert で asin_map へ書き込み）");
})();
