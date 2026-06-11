#!/usr/bin/env node
/**
 * Creators API の eligibility を1回だけ判定する軽量チェッカー。
 * バックグラウンドのポーリングループから呼ばれる想定。
 *
 * exit code:
 *   0  = ELIGIBLE（getItems成功）→ 画像取得を実行できる
 *   42 = まだ AssociateNotEligible（待機継続）
 *   1  = その他エラー（トークン失敗・ネットワーク等。継続はするがログ残す）
 */
const fs = require("fs");
const ENV_PATH = "C:/Users/taker/Documents/GitHub/tsumitsumi/local-tools/.env";
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];

const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");

(async () => {
  try {
    const tr = await fetch("https://api.amazon.co.jp/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CID,
        client_secret: SEC,
        scope: "creatorsapi::default",
      }).toString(),
    });
    if (!tr.ok) { console.error("token " + tr.status); process.exit(1); }
    const tok = (await tr.json()).access_token;

    const r = await fetch("https://creatorsapi.amazon/catalog/v1/getItems", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tok,
        "Content-Type": "application/json",
        "x-marketplace": "www.amazon.co.jp",
      },
      body: JSON.stringify({
        itemIds: ["B077Z61TPN"],
        itemIdType: "ASIN",
        resources: ["itemInfo.title"],
        partnerTag: TAG,
        partnerType: "Associates",
      }),
    });

    if (r.status === 200) {
      console.log("ELIGIBLE");
      process.exit(0);
    }
    const d = await r.json().catch(() => ({}));
    if (d.reason === "AssociateNotEligible" || r.status === 403) {
      console.log("not-yet");
      process.exit(42);
    }
    console.error("unexpected " + r.status + " " + JSON.stringify(d).slice(0, 120));
    process.exit(1);
  } catch (e) {
    console.error("err " + e.message);
    process.exit(1);
  }
})();
