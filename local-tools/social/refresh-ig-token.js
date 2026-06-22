#!/usr/bin/env node
/**
 * 長期アクセストークン(約60日)を延長し、local-tools/.env の IG_ACCESS_TOKEN を更新する。
 * 期限切れ前(目安: 月1回)に実行すること。価格リフレッシュと同様にタスクスケジューラ常駐推奨。
 *
 *   node local-tools/social/refresh-ig-token.js
 *
 * 必要な .env:
 *   FB_APP_ID=...
 *   FB_APP_SECRET=...
 *   IG_ACCESS_TOKEN=...   # 現在の長期トークン（これを延長する）
 */
const fs = require("fs");
const path = require("path");
const ENV = path.join(__dirname, "..", ".env");
let env = fs.readFileSync(ENV, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const APP_ID = get("FB_APP_ID"), APP_SECRET = get("FB_APP_SECRET"), TOKEN = get("IG_ACCESS_TOKEN");
if (!APP_ID || !APP_SECRET || !TOKEN) { console.error("FB_APP_ID / FB_APP_SECRET / IG_ACCESS_TOKEN を .env に設定してください"); process.exit(1); }

(async () => {
  const u = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(APP_ID)}&client_secret=${encodeURIComponent(APP_SECRET)}`
    + `&fb_exchange_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok || j.error || !j.access_token) { console.error("更新失敗: " + JSON.stringify(j.error || j)); process.exit(1); }
  env = env.replace(/^IG_ACCESS_TOKEN=.*$/m, "IG_ACCESS_TOKEN=" + j.access_token);
  fs.writeFileSync(ENV, env);
  const days = j.expires_in ? Math.round(j.expires_in / 86400) : "?";
  console.log(`✅ IG_ACCESS_TOKEN を更新しました（有効期限 約${days}日）`);
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
