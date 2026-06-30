#!/usr/bin/env node
/**
 * GitHub Actions 用：Instagram 自動投稿のオーケストレータ（週2運用）。
 * 1) 未投稿の記事を1本選ぶ（social-queue.json の order 優先）
 * 2) gen-carousel.js でカルーセル画像＋キャプションを生成（Claudeが5W1Hで執筆）
 * 3) 画像を main にコミット＆push → Vercel がデプロイして公開URL化
 * 4) 公開URLが見えるまで待機（最大6分ポーリング）
 * 5) post-instagram.js で Instagram 投稿
 * 6) social-queue.json の posted に記録してコミット＆push
 *
 * 必要な環境変数（Secrets）：ANTHROPIC_API_KEY / IG_USER_ID / IG_ACCESS_TOKEN
 * 失敗時は posted に記録しないので、次回スケジュールで同じ記事を再試行する。
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const TIPS = path.join(ROOT, "public", "tips");
const QF = path.join(__dirname, "social-queue.json");
const SITE = (process.env.SOCIAL_SITE || "https://tsumitsumi.vercel.app").replace(/\/$/, "");

const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: "inherit" });
const shQuiet = (cmd) => { try { execSync(cmd, { cwd: ROOT, stdio: "inherit" }); } catch (e) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadQueue() { try { return JSON.parse(fs.readFileSync(QF, "utf8")); } catch { return { posted: [], order: [], paused: false }; } }
function saveQueue(q) { fs.writeFileSync(QF, JSON.stringify(q, null, 2) + "\n"); }
function allSlugs() {
  return fs.readdirSync(TIPS).filter((f) => f.endsWith(".html") && f !== "index.html")
    .map((f) => f.replace(/\.html$/, "")).sort(); // 決定的な順（order に無い分の保険）
}

const q = loadQueue();
if (q.paused) { console.log("⏸ paused のため投稿しません。"); process.exit(0); }

const all = allSlugs();
const order = (q.order || []).filter((s) => all.includes(s));
const candidates = [...order, ...all.filter((s) => !order.includes(s))];
const next = candidates.find((s) => !(q.posted || []).includes(s));
if (!next) { console.log("✅ 未投稿の記事はありません（全て投稿済み）。"); process.exit(0); }
console.log("▶ 次の投稿対象:", next);

if (!process.env.ANTHROPIC_API_KEY) console.log("⚠ ANTHROPIC_API_KEY 未設定→従来抽出で生成されます");
if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
  console.error("❌ IG_USER_ID / IG_ACCESS_TOKEN が未設定です（リポジトリSecretを設定してください）。");
  process.exit(1);
}

// 1)+2) カルーセル生成
sh(`node local-tools/social/gen-carousel.js ${next}`);

// 3) 画像をコミット＆push（Vercelで公開）
sh(`git config user.name "github-actions[bot]"`);
sh(`git config user.email "github-actions[bot]@users.noreply.github.com"`);
sh(`git add public/social/${next}`);
shQuiet(`git commit -m "chore(social): カルーセル生成 ${next}"`); // 差分なしでも続行
sh(`git push`);

// 4) 公開URLが見えるまで待機（Vercelデプロイ）
const imgUrl = `${SITE}/social/${next}/slide-1.jpg`;
let ready = false;
for (let i = 0; i < 24; i++) {
  try { const r = await fetch(imgUrl, { method: "GET", cache: "no-store" }); if (r.ok) { ready = true; break; } } catch {}
  console.log(`  公開待ち… ${imgUrl} (${i + 1}/24)`);
  await sleep(15000);
}
if (!ready) { console.error("❌ 画像の公開URLを確認できませんでした: " + imgUrl); process.exit(1); }
console.log("  ✓ 公開を確認:", imgUrl);

// 5) Instagram 投稿（失敗時はここで例外→postedに記録されない）
sh(`node local-tools/social/post-instagram.js ${next}`);

// 6) posted に記録
q.posted = q.posted || []; q.posted.push(next); saveQueue(q);
sh(`git add local-tools/social/social-queue.json`);
sh(`git commit -m "chore(social): ${next} を投稿済みに記録"`);
sh(`git push`);
console.log(`✅ ${next} を投稿し、記録しました。`);
