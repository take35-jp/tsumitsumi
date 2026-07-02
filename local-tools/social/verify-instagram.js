#!/usr/bin/env node
/**
 * Instagram 投稿の実体確認（診断用）。
 * トークンが指すアカウントの username と直近メディアの permalink/日時を表示し、
 * 「本当に投稿されているか／どのアカウントか」を切り分ける。
 *
 *   node local-tools/social/verify-instagram.js            # 直近メディア一覧
 *   node local-tools/social/verify-instagram.js 17945537328032201  # 指定メディアも確認
 *
 * 認証：IG_USER_ID / IG_ACCESS_TOKEN（local-tools/.env もしくは環境変数/Secrets）
 */
const fs = require("fs");
const path = require("path");
const ENV = path.join(__dirname, "..", ".env");
const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1] || process.env[k];
const IG_USER_ID = get("IG_USER_ID");
const TOKEN = get("IG_ACCESS_TOKEN");
const GV = "v21.0";
const GRAPH = `https://graph.facebook.com/${GV}`;
const MEDIA_ID = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function gget(url) {
  const r = await fetch(url);
  const j = await r.json();
  return { ok: r.ok && !j.error, status: r.status, j };
}

(async () => {
  if (!IG_USER_ID || !TOKEN) { console.error("IG_USER_ID / IG_ACCESS_TOKEN が未設定です。"); process.exit(1); }

  // 1) トークンが指すアカウント
  const acc = await gget(`${GRAPH}/${IG_USER_ID}?fields=id,username,name,media_count&access_token=${TOKEN}`);
  console.log("=== アカウント（トークンが指す先）===");
  if (acc.ok) console.log(`  id=${acc.j.id}  username=@${acc.j.username || "?"}  media_count=${acc.j.media_count}`);
  else console.log(`  取得失敗 ${acc.status}: ${JSON.stringify(acc.j.error || acc.j)}`);

  // 2) 直近メディア
  const med = await gget(`${GRAPH}/${IG_USER_ID}/media?fields=id,caption,permalink,timestamp,media_type,media_product_type&limit=8&access_token=${TOKEN}`);
  console.log("\n=== 直近メディア（最大8件）===");
  if (med.ok) {
    const items = med.j.data || [];
    if (!items.length) console.log("  （メディアが1件もありません）");
    for (const m of items) {
      const cap = (m.caption || "").split("\n")[0].slice(0, 30);
      console.log(`  ${m.timestamp}  ${m.media_type}/${m.media_product_type}  ${m.permalink}`);
      console.log(`      id=${m.id}  「${cap}…」`);
    }
  } else console.log(`  取得失敗 ${med.status}: ${JSON.stringify(med.j.error || med.j)}`);

  // 3) 指定メディアの実在確認
  if (MEDIA_ID) {
    const one = await gget(`${GRAPH}/${MEDIA_ID}?fields=id,permalink,timestamp,media_type,media_product_type&access_token=${TOKEN}`);
    console.log(`\n=== 指定メディア ${MEDIA_ID} ===`);
    if (one.ok) console.log(`  実在: ${one.j.permalink}  (${one.j.timestamp} / ${one.j.media_type})`);
    else console.log(`  取得失敗 ${one.status}: ${JSON.stringify(one.j.error || one.j)}`);
  }
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
