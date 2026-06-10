#!/usr/bin/env node
/**
 * Amazon Creators API (旧PA-API 5.0の後継) で商品画像URLを取得して gears_catalog を更新する。
 *
 * 認証情報は local-tools/.env から読む:
 *   AMAZON_PAAPI_ACCESS_KEY  (amzn1.application-oa2-client.xxx)
 *   AMAZON_PAAPI_SECRET_KEY  (amzn1.oa2-cs.v1.xxx)
 *   AMAZON_PARTNER_TAG       (tsumitsumi232-22)
 *
 * 仕様:
 *   - Token endpoint: https://api.amazon.co.jp/auth/o2/token (v3.3 Far East)
 *   - Scope: creatorsapi::default
 *   - API: https://creatorsapi.amazon/catalog/v1/getItems
 *   - x-marketplace: www.amazon.co.jp
 *   - 1リクエストで最大10 ASIN
 *
 * 使い方:
 *   node local-tools/paapi-creators-fetch.js          # dry-run（photoセクションのみ・取得結果表示）
 *   node local-tools/paapi-creators-fetch.js --apply  # 取得→gears_catalog 反映
 *   node local-tools/paapi-creators-fetch.js --apply --all  # photo + paint + topcoat 全件
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = "C:/Users/taker/Documents/GitHub/tsumitsumi/local-tools/.env";
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];

const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");
const SUPABASE_URL = get("SUPABASE_URL");
const SERVICE_ROLE = get("SUPABASE_SERVICE_ROLE_KEY");
const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");

if (!CID || !SEC || !TAG) {
  console.error("AMAZON_PAAPI_* / AMAZON_PARTNER_TAG が .env にありません");
  process.exit(1);
}

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const API_URL = "https://creatorsapi.amazon/catalog/v1/getItems";
const MARKETPLACE = "www.amazon.co.jp";

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CID,
    client_secret: SEC,
    scope: "creatorsapi::default",
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`Token失敗 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.access_token;
}

async function getItems(token, asins) {
  if (asins.length === 0) return [];
  if (asins.length > 10) throw new Error("Max 10 ASIN per request");
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify({
      itemIds: asins,
      itemIdType: "ASIN",
      resources: [
        "images.primary.large",
        "images.primary.medium",
        "itemInfo.title",
        "offersV2.listings.price",
      ],
      partnerTag: TAG,
      partnerType: "Associates",
    }),
  });
  if (!r.ok) throw new Error(`getItems失敗 ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.itemsResult?.items || [];
}

async function fetchGearsCatalog() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gears_catalog?id=eq.main&select=data`, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
  });
  return (await r.json())[0]?.data;
}

async function upsertGearsCatalog(data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/gears_catalog?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([{ id: "main", data }]),
  });
  if (!r.ok) throw new Error(`UPSERT失敗 ${r.status}: ${await r.text()}`);
  return await r.json();
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

(async () => {
  console.log("🔐 OAuth2 token 取得中...");
  const token = await getAccessToken();
  console.log("  ✓ Token OK (有効期限 1時間)\n");

  console.log("📋 gears_catalog 読み込み中...");
  const cat = await fetchGearsCatalog();
  const targetSections = ALL
    ? cat.sections
    : cat.sections.filter((s) => s.id.startsWith("photo-"));

  // ASIN付き商品を集める
  const items = [];
  targetSections.forEach((sec) => {
    (sec.products || []).forEach((p) => {
      if (p.asin) items.push({ section: sec.id, product: p });
    });
  });
  console.log(`  ${items.length}件のASIN付き商品を対象 (${targetSections.length}セクション)\n`);

  if (items.length === 0) return;

  // 10件ずつバッチ
  const batches = chunk(items, 10);
  console.log(`🚀 API呼び出し (${batches.length}バッチ × 最大10件)\n`);

  let okCount = 0, failCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const asins = batch.map((b) => b.product.asin);
    try {
      const results = await getItems(token, asins);
      // ASIN→結果のマップ
      const byAsin = {};
      results.forEach((r) => { byAsin[r.asin] = r; });
      batch.forEach(({ product }) => {
        const r = byAsin[product.asin];
        if (r) {
          const img = r.images?.primary?.large?.url || r.images?.primary?.medium?.url;
          if (img) { product.image = img; okCount++; }
          const price = r.offersV2?.listings?.[0]?.price?.amount;
          if (price) product.price = String(price);
        } else {
          failCount++;
        }
      });
      console.log(`  Batch ${i + 1}/${batches.length}: ${results.length}件取得`);
    } catch (e) {
      console.log(`  Batch ${i + 1}/${batches.length}: エラー — ${e.message.slice(0, 200)}`);
      failCount += batch.length;
    }
    // 1 TPS制限の安全マージン
    if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }

  console.log(`\n📊 結果: 画像取得成功 ${okCount}件 / 失敗 ${failCount}件`);

  if (!APPLY) {
    console.log("\n[DRY RUN] 書き込みはしません。--apply で反映。");
    return;
  }

  console.log("\n💾 gears_catalog にupsert...");
  await upsertGearsCatalog(cat);
  console.log("✅ 反映完了");
})().catch((e) => {
  console.error("\n❌ Fatal:", e.message);
  process.exit(1);
});
