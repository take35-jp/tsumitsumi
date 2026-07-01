#!/usr/bin/env node
/**
 * Threads API でカルーセル(public/social/<slug>/slide-*.jpg)を自動投稿する。
 * Instagram(post-instagram.js)と同じ公開JPEG URLをそのまま流用する。
 *
 *   node local-tools/social/post-threads.js beginner-tools --dry   # 投稿せず手順だけ表示
 *   node local-tools/social/post-threads.js beginner-tools         # 実投稿
 *
 * 必要な .env（local-tools/.env）／GitHub Actions Secrets:
 *   THREADS_USER_ID=...       # Threadsユーザーの id（数値）
 *   THREADS_ACCESS_TOKEN=...  # Threads API の長期アクセストークン（約60日）
 *   SOCIAL_SITE=https://tsumitsumi.vercel.app   # 省略時はこの既定値
 *
 * 制約: 画像は公開URLのJPEG / カルーセルは2〜20枚 / テキストは Instagram の caption を流用。
 * ※ Threads はトピックタグが1つだけクリッカブルになる仕様だが、#タグはテキストとして投稿可。
 */
const fs = require("fs");
const path = require("path");

const ENV = path.join(__dirname, "..", ".env");
const env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
// ローカルは .env 優先、無ければ環境変数（GitHub Actions の Secrets）から取得＝CIでも動く。
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1] || process.env[k];
const USER_ID = get("THREADS_USER_ID");
const TOKEN = get("THREADS_ACCESS_TOKEN");
const SITE = (get("SOCIAL_SITE") || "https://tsumitsumi.vercel.app").replace(/\/$/, "");
const BASE = "https://graph.threads.net/v1.0";

const ARGV = process.argv.slice(2);
const SLUG = ARGV.find((a) => !a.startsWith("--"));
const DRY = ARGV.includes("--dry");
if (!SLUG) { console.error("使い方: node post-threads.js <slug> [--dry]"); process.exit(1); }

const LOG = path.join(__dirname, "social-post.log");
function log(m) { const l = `[${new Date().toISOString()}] ${m}`; try { fs.appendFileSync(LOG, l + "\n"); } catch (e) {} console.log(m); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一時的な通信揺れ("fetch failed")だけ最大3回リトライ（API側エラーは即throw）。
async function fetchRetry(url, init, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (i < tries - 1) await sleep(2000 * (i + 1)); }
  }
  throw last;
}
async function tpost(url, params) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN }).toString();
  const r = await fetchRetry(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j)}`);
  return j;
}
async function tget(url) {
  const r = await fetchRetry(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j)}`);
  return j;
}

// コンテナが FINISHED になるまで待つ（Threads は status フィールド）。
async function waitReady(id, label) {
  for (let i = 0; i < 24; i++) {
    const s = await tget(`${BASE}/${id}?fields=status,error_message&access_token=${TOKEN}`);
    if (s.status === "FINISHED") return;
    if (s.status === "ERROR" || s.status === "EXPIRED") throw new Error(`${label} container ${s.status}: ${s.error_message || ""}`);
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
  if (slides.length > 20) { log(`⚠ ${slides.length}枚→先頭20枚に切り詰めます`); slides.length = 20; }
  const caption = fs.existsSync(path.join(dir, "caption.txt")) ? fs.readFileSync(path.join(dir, "caption.txt"), "utf8") : "";
  // SOCIAL_IMG_VER があれば ?v= を付けて“最新画像”を確実に取得させる（CDNの stale ヒット対策）。
  const VER = get("SOCIAL_IMG_VER") || "";
  const urls = slides.map((s) => `${SITE}/social/${SLUG}/${s}${VER ? `?v=${VER}` : ""}`);

  log(`▶ Threads投稿準備: ${SLUG} (${urls.length}枚)`);

  if (DRY) { log("[DRY] 実投稿はスキップ。THREADS_USER_ID / THREADS_ACCESS_TOKEN を設定して本実行してください。"); return; }
  if (!USER_ID || !TOKEN) { console.error("THREADS_USER_ID と THREADS_ACCESS_TOKEN を設定してください"); process.exit(1); }

  // 1) 各スライドの子コンテナ（is_carousel_item=true）
  const children = [];
  for (let i = 0; i < urls.length; i++) {
    const j = await tpost(`${BASE}/${USER_ID}/threads`, { media_type: "IMAGE", image_url: urls[i], is_carousel_item: "true" });
    await waitReady(j.id, `child ${i + 1}`);
    children.push(j.id);
    log(`   ✓ Threads child ${i + 1}/${urls.length}: ${j.id}`);
  }
  // 2) カルーセル親コンテナ（text=キャプション）
  const parent = await tpost(`${BASE}/${USER_ID}/threads`, { media_type: "CAROUSEL", children: children.join(","), text: caption });
  await waitReady(parent.id, "carousel");
  log(`   ✓ Threads carousel container: ${parent.id}`);
  // 3) 公開（Threadsは公開直前に少し待つのが安全）
  await sleep(3000);
  const pub = await tpost(`${BASE}/${USER_ID}/threads_publish`, { creation_id: parent.id });
  log(`✅ Threads投稿完了: id ${pub.id}`);
})().catch((e) => { log("❌ Threads: " + e.message); process.exit(1); });
