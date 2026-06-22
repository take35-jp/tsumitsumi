#!/usr/bin/env node
/**
 * 投稿キューから「まだ投稿していない記事」を1本選び、
 * カルーセル画像を生成(無ければ)→ Instagram へ投稿する。定期実行の入口。
 *
 *   node local-tools/social/run-next.js --dry   # 次に何を投稿するかだけ表示
 *   node local-tools/social/run-next.js         # 1本投稿して posted に記録
 *
 * 状態ファイル: local-tools/social/social-queue.json
 *   { "order": ["slug1","slug2", ...], "posted": ["slug"], "paused": false }
 *   - order 省略時は public/tips/*.html を新しい順で自動候補化
 *   - 画像は事前に push 済み(=Vercelで公開URL化済み)であること
 *
 * ※ 投稿後は public/social/<slug>/ を git に push しておく必要がある
 *   (Instagram が image_url を取得するため)。CI/手動どちらでも可。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const TIPS = path.join(ROOT, "public", "tips");
const QF = path.join(HERE, "social-queue.json");
const DRY = process.argv.includes("--dry");

function loadQueue() {
  if (fs.existsSync(QF)) { try { return JSON.parse(fs.readFileSync(QF, "utf8")); } catch (e) {} }
  return { order: [], posted: [], paused: false };
}
function saveQueue(q) { fs.writeFileSync(QF, JSON.stringify(q, null, 2)); }

function allTipsSlugs() {
  return fs.readdirSync(TIPS)
    .filter((f) => f.endsWith(".html") && f !== "index.html")
    .map((f) => ({ slug: f.replace(/\.html$/, ""), mtime: fs.statSync(path.join(TIPS, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.slug);
}

const q = loadQueue();
if (q.paused) { console.log("⏸ キューは paused です。投稿しません。"); process.exit(0); }

const candidates = (q.order && q.order.length ? q.order : allTipsSlugs());
const next = candidates.find((s) => !(q.posted || []).includes(s));
if (!next) { console.log("✅ 未投稿の記事はありません（全て投稿済み）。"); process.exit(0); }

console.log(`▶ 次の投稿対象: ${next}`);

const imgDir = path.join(ROOT, "public", "social", next);
const hasImages = fs.existsSync(imgDir) && fs.readdirSync(imgDir).some((f) => /^slide-1\.jpg$/.test(f));
if (!hasImages) {
  console.log("  画像が無いので生成します…");
  if (!DRY) spawnSync(process.execPath, [path.join(HERE, "gen-carousel.js"), next], { stdio: "inherit" });
  else console.log("  [DRY] gen-carousel.js " + next);
}

if (DRY) { console.log("[DRY] ここで post-instagram.js を実行します（実投稿なし）。"); process.exit(0); }

const res = spawnSync(process.execPath, [path.join(HERE, "post-instagram.js"), next], { stdio: "inherit" });
if (res.status !== 0) { console.error("❌ 投稿に失敗。posted には記録しません。"); process.exit(1); }

q.posted = q.posted || []; q.posted.push(next); saveQueue(q);
console.log(`✅ ${next} を投稿済みに記録しました。残り候補: ${candidates.filter((s) => !q.posted.includes(s)).length}本`);
