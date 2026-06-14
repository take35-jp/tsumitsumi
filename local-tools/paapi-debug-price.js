#!/usr/bin/env node
/**
 * Creators API getItems の生レスポンス（特に offers/price まわり）をダンプする調査用スクリプト。
 * 価格が取れない原因（resource名 or レスポンス構造の不一致）を特定するため。
 */
const fs = require("fs");
const ENV_PATH = "C:/Users/taker/Documents/GitHub/tsumitsumi/local-tools/.env";
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const API_URL = "https://creatorsapi.amazon/catalog/v1/getItems";

(async () => {
  const tr = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString(),
  });
  const token = (await tr.json()).access_token;

  // 試す resource を複数パターン
  const resourceSets = {
    offersV2_listings_price: ["offersV2.listings.price"],
    offersV2_full: ["offersV2.listings.price", "offersV2.listings.availability", "offersV2.listings.condition", "offersV2.listings.dealDetails", "offersV2.listings.isBuyBoxWinner", "offersV2.listings.loyaltyPoints", "offersV2.listings.merchantInfo", "offersV2.listings.type"],
    offers_listings_price: ["offers.listings.price"],
  };

  for (const [label, resources] of Object.entries(resourceSets)) {
    console.log("\n================ resources:", label, "================");
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "x-marketplace": "www.amazon.co.jp" },
        body: JSON.stringify({
          itemIds: ["B0FJKYQ93S"],
          itemIdType: "ASIN",
          resources,
          partnerTag: TAG,
          partnerType: "Associates",
        }),
      });
      console.log("HTTP", r.status);
      const data = await r.json();
      const item = data.itemsResult?.items?.[0];
      if (item) {
        console.log("item keys:", Object.keys(item).join(", "));
        if (item.offersV2) console.log("offersV2:", JSON.stringify(item.offersV2, null, 2).slice(0, 1500));
        if (item.offers) console.log("offers:", JSON.stringify(item.offers, null, 2).slice(0, 1500));
      } else {
        console.log("no item. raw:", JSON.stringify(data).slice(0, 600));
      }
    } catch (e) {
      console.log("err:", e.message.slice(0, 300));
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
})();
