#!/usr/bin/env node
/**
 * Creators API に searchItems（キーワード検索）があるか・精度はどうかを確認する調査用。
 * 塗料名で検索して、トップ候補のASIN/タイトルが妥当か見る。
 */
const fs = require("fs");
const ENV_PATH = "C:/Users/taker/Documents/GitHub/tsumitsumi/local-tools/.env";
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");
const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";

const queries = [
  "GSIクレオス Mr.カラー C1 ホワイト",
  "ガイアノーツ サーフェイサーエヴォ ブラック",
  "タミヤ アクリル塗料 XF-1 フラットブラック",
];

async function token() {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString() });
  return (await r.json()).access_token;
}

async function trySearch(tok, endpoint, payload) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": "www.amazon.co.jp" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return { status: r.status, text };
}

(async () => {
  const tok = await token();
  const endpoints = [
    "https://creatorsapi.amazon/catalog/v1/searchItems",
    "https://creatorsapi.amazon/catalog/v1/search",
  ];
  // まずエンドポイント存在チェック（1クエリ）
  for (const ep of endpoints) {
    console.log("\n==== endpoint:", ep, "====");
    const res = await trySearch(tok, ep, {
      keywords: queries[0],
      itemCount: 3,
      resources: ["itemInfo.title", "images.primary.medium", "offersV2.listings.price"],
      partnerTag: TAG,
      partnerType: "Associates",
    });
    console.log("HTTP", res.status);
    console.log(res.text.slice(0, 1200));
    await new Promise((r) => setTimeout(r, 1300));
  }
})();
