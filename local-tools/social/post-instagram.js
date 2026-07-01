#!/usr/bin/env node
/**
 * Instagram Graph API でカルーセル(public/social/<slug>/slide-*.jpg)を自動投稿する。
 * 画像は Vercel 上の公開URL(JPEG)を image_url として渡す方式。
 *
 *   node local-tools/social/post-instagram.js plastic-materials --dry   # 投稿せず手順だけ表示
 *   node local-tools/social/post-instagram.js plastic-materials         # 実投稿
 *
 * 必要な .env（local-tools/.env）:
 *   IG_USER_ID=...          # Instagramビジネスアカウントの ig-user-id（数値）
 *   IG_ACCESS_TOKEN=...     # 長期アクセストークン（約60日・refresh-ig-token.js で更新）
 *   SOCIAL_SITE=https://tsumitsumi.vercel.app   # 省略時はこの既定値
 *
 * 制約: 1アカウント 24時間あたり 25投稿まで / 画像は公開URLのJPEG / カルーセルは2〜10枚。
 */
const fs = require("fs");
const path = require("path");

const ENV = path.join(__dirname, "..", ".env");
const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
// ローカルは .env 優先、無ければ環境変数（GitHub Actions の Secrets）から取得＝CIでも動く。
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1] || process.env[k];
const IG_USER_ID = get("IG_USER_ID");
const TOKEN = get("IG_ACCESS_TOKEN");
const SITE = (get("SOCIAL_SITE") || "https://tsumitsumi.vercel.app").replace(/\/$/, "");
const GV = "v21.0";
const GRAPH = `https://graph.facebook.com/${GV}`;

const ARGV = process.argv.slice(2);
const SLUG = ARGV.find((a) => !a.startsWith("--"));
const DRY = ARGV.includes("--dry");
if (!SLUG) { console.error("使い方: node post-instagram.js <slug> [--dry]"); process.exit(1); }

const LOG = path.join(__dirname, "social-post.log");
function log(m) { const l = `[${new Date().toISOString()}] ${m}`; try { fs.appendFileSync(LOG, l + "\n"); } catch (e) {} console.log(m); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// graph.facebook.com への接続は稀に "fetch failed"(一時的な通信揺れ)になるので
// ネットワーク層の失敗だけ最大3回までリトライする（API側のエラーは即throw）。
async function fetchRetry(url, init, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (i < tries - 1) await sleep(2000 * (i + 1)); }
  }
  throw last;
}
async function gpost(url, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN }).toString();
  const r = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j)}`);
  return j;
}
async function gget(url) {
  const r = await fetchRetry(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j)}`);
  return j;
}

// コンテナが FINISHED になるまで待つ（画像は通常すぐ）
async function waitReady(id, label) {
  for (let i = 0; i < 20; i++) {
    const s = await gget(`${GRAPH}/${id}?fields=status_code,status&access_token=${TOKEN}`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error(`${label} container ERROR: ${s.status}`);
    await sleep(2500);
  }
  throw new Error(`${label} container タイムアウト`);
}

(async () => {
  const dir = path.join(__dirname, "..", "..", "public", "social", SLUG);
  if (!fs.existsSync(dir)) { console.error("先に gen-carousel.js で画像を生成してください: " + dir); process.exit(1); }
  const slides = fs.readdirSync(dir).filter((f) => /^slide-\d+\.jpg$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  if (slides.length < 2) { console.error("カルーセルには2枚以上必要です"); process.exit(1); }
  if (slides.length > 10) { log(`⚠ ${slides.length}枚→先頭10枚に切り詰めます`); slides.length = 10; }
  const caption = fs.existsSync(path.join(dir, "caption.txt")) ? fs.readFileSync(path.join(dir, "caption.txt"), "utf8") : "";
  // SOCIAL_IMG_VER があれば ?v= を付けて“最新画像”を確実に取得させる（CDNの stale ヒット対策）。
  const VER = get("SOCIAL_IMG_VER") || "";
  const urls = slides.map((s) => `${SITE}/social/${SLUG}/${s}${VER ? `?v=${VER}` : ""}`);

  log(`▶ 投稿準備: ${SLUG} (${urls.length}枚)`);
  urls.forEach((u) => log(`   - ${u}`));

  if (DRY) { log("[DRY] 実投稿はスキップ。.env に IG_USER_ID / IG_ACCESS_TOKEN を設定して本実行してください。"); return; }
  if (!IG_USER_ID || !TOKEN) { console.error("IG_USER_ID と IG_ACCESS_TOKEN を local-tools/.env に設定してください"); process.exit(1); }

  // 1) 各スライドの子コンテナ
  const children = [];
  for (let i = 0; i < urls.length; i++) {
    const j = await gpost(`${GRAPH}/${IG_USER_ID}/media`, { image_url: urls[i], is_carousel_item: "true" });
    await waitReady(j.id, `child ${i + 1}`);
    children.push(j.id);
    log(`   ✓ child ${i + 1}/${urls.length}: ${j.id}`);
  }
  // 2) カルーセル親コンテナ
  const parent = await gpost(`${GRAPH}/${IG_USER_ID}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  await waitReady(parent.id, "carousel");
  log(`   ✓ carousel container: ${parent.id}`);
  // 3) 公開
  const pub = await gpost(`${GRAPH}/${IG_USER_ID}/media_publish`, { creation_id: parent.id });
  log(`✅ 投稿完了: media id ${pub.id}`);
})().catch((e) => { log("❌ " + e.message); process.exit(1); });
