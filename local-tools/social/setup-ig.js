#!/usr/bin/env node
/**
 * アクセストークンから、連携済みFacebookページと
 * Instagramビジネスアカウントの id(ig-user-id) を自動で見つける。
 * 見つかった ig-user-id は local-tools/.env の IG_USER_ID に書き込む。
 *
 *   1) Graph API Explorer で生成したトークンを .env の IG_ACCESS_TOKEN に貼る
 *   2) node local-tools/social/setup-ig.js
 *
 * 必要な .env: IG_ACCESS_TOKEN（短期でも可。この後 refresh-ig-token.js で60日化）
 */
const fs = require("fs");
const path = require("path");
const ENV = path.join(__dirname, "..", ".env");
let env = fs.readFileSync(ENV, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const TOKEN = get("IG_ACCESS_TOKEN");
if (!TOKEN) { console.error("先に .env の IG_ACCESS_TOKEN にトークンを貼ってください"); process.exit(1); }
const GRAPH = "https://graph.facebook.com/v21.0";

(async () => {
  const url = `${GRAPH}/me/accounts?fields=name,instagram_business_account{id,username,followers_count}&access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) { console.error("取得失敗: " + JSON.stringify(j.error || j)); process.exit(1); }
  const pages = j.data || [];
  if (!pages.length) { console.error("ページが見つかりません。トークンの権限(pages_show_list)とページ管理権限を確認してください。"); process.exit(1); }

  console.log("=== 連携状況 ===");
  let igId = null, igName = null;
  pages.forEach((p) => {
    const ig = p.instagram_business_account;
    console.log(`・FBページ: ${p.name} (id ${p.id})`);
    if (ig) { console.log(`    └ Instagram: @${ig.username} / ig-user-id = ${ig.id}`); if (!igId) { igId = ig.id; igName = ig.username; } }
    else console.log("    └ Instagram連携なし");
  });

  if (!igId) { console.error("\nInstagramビジネスアカウントが見つかりません。プロ化＋FBページ連携を再確認してください。"); process.exit(1); }

  if (env.match(/^IG_USER_ID=/m)) env = env.replace(/^IG_USER_ID=.*$/m, "IG_USER_ID=" + igId);
  else env = env.replace(/\n?$/, "\n") + "IG_USER_ID=" + igId + "\n";
  fs.writeFileSync(ENV, env);
  console.log(`\n✅ IG_USER_ID=${igId} (@${igName}) を .env に書き込みました。`);
  console.log("   次: node local-tools/social/refresh-ig-token.js でトークンを60日化 → post-instagram.js <slug> --dry で確認");
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
