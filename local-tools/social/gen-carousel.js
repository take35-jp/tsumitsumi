#!/usr/bin/env node
/**
 * TIPS記事(public/tips/<slug>.html) を Instagram 向けの要約カルーセル画像に変換する。
 * 1080x1350(4:5) の JPEG スライドを public/social/<slug>/ に書き出し、
 * 投稿用キャプション caption.txt も生成する。
 *
 *   node local-tools/social/gen-carousel.js plastic-materials
 *   node local-tools/social/gen-carousel.js plastic-materials --max 6
 *
 * 依存: @napi-rs/canvas（プレビルド・Windowsでもビルド不要）
 */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "..", "..");
const TIPS_DIR = path.join(ROOT, "public", "tips");
const OUT_ROOT = path.join(ROOT, "public", "social");
const LOGO = path.join(ROOT, "public", "LOGO.png");

const ARGV = process.argv.slice(2);
const SLUG = ARGV.find((a) => !a.startsWith("--"));
const MAX = ARGV.includes("--max") ? parseInt(ARGV[ARGV.indexOf("--max") + 1], 10) : 6;
if (!SLUG) { console.error("使い方: node gen-carousel.js <slug> [--max N]"); process.exit(1); }

const W = 1080, H = 1350;
const FONT = '"Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
const C = {
  brandA: "#4f8ef7", brandB: "#22c55e",
  ink: "#0f172a", sub: "#475569", soft: "#64748b",
  paper: "#ffffff", line: "#e5e7eb", chip: "#eef2f7",
  green: "#16a34a", orange: "#f59e0b", white: "#ffffff",
};
const IG_HANDLE = "@take35_pla"; // 投稿先Instagramアカウント（実ハンドル）
const BASE_TAGS = [
  "#ガンプラ", "#プラモデル", "#ガンプラ初心者", "#プラモ初心者", "#模型",
  "#ガンプラ部", "#プラモ好きと繋がりたい", "#積みプラ", "#ガンプラ製作", "#TSUMITSUMI",
];

// ---------- HTML 抽出 ----------
function stripTags(s) {
  return String(s || "")
    .replace(/<br\s*\/?>(\s*)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function firstSentences(text, maxLen) {
  const t = stripTags(text);
  const parts = t.split(/(?<=。)/);
  let out = "";
  for (const p of parts) {
    if ((out + p).length > maxLen && out) break;
    out += p;
    if (out.length >= maxLen) break;
  }
  return out || t.slice(0, maxLen);
}
function parseArticle(html) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  let title = h1.replace(/<small[\s\S]*?<\/small>/i, "");
  title = stripTags(title).replace(/^[\s―\-]+|[\s―\-]+$/g, "");
  const cat = stripTags((html.match(/<span class="tag">([\s\S]*?)<\/span>/i) || [])[1] || "製作TIPS");
  const lead = firstSentences((html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "", 70);

  // 本文を h2 単位で分割
  const body = (html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || [])[1] || html;
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2|<div class="cta-banner"|<div class="related-section"|$)/gi;
  const sections = [];
  let m;
  const SKIP = /(よくある質問|FAQ|関連|まとめ)/;
  while ((m = re.exec(body))) {
    const head = stripTags(m[1]).replace(/^\d+[.\．、]\s*/, "");
    if (SKIP.test(head)) continue;
    const blk = m[2];
    // 優先: tip/warning ボックス → 最初の p
    const box = (blk.match(/<div class="(?:tip|warning)-box"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
    const para = (blk.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
    const text = firstSentences(box || para || "", 92);
    if (head) sections.push({ head, text });
  }
  return { title, cat, lead, sections: sections.slice(0, MAX) };
}

// ---------- 描画ヘルパ ----------
function grad(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.brandA); g.addColorStop(1, C.brandB);
  return g;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrap(ctx, text, maxW) {
  const lines = [];
  let line = "";
  for (const ch of String(text)) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function drawLines(ctx, lines, x, y, lh) {
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

// ---------- 各スライド ----------
function drawCover(ctx, art, logo) {
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, H);
  // ロゴ＋ワードマーク
  const ls = 96;
  if (logo) { ctx.save(); roundRect(ctx, 80, 84, ls, ls, 22); ctx.clip(); ctx.drawImage(logo, 80, 84, ls, ls); ctx.restore(); }
  ctx.fillStyle = C.white;
  ctx.font = `800 40px ${FONT}`; ctx.textBaseline = "alphabetic";
  ctx.fillText("TSUMI TSUMI", 196, 130);
  ctx.font = `500 26px ${FONT}`; ctx.globalAlpha = 0.9;
  ctx.fillText("製作TIPS", 196, 168); ctx.globalAlpha = 1;
  // カテゴリチップ
  ctx.font = `700 26px ${FONT}`;
  const cw = ctx.measureText(art.cat).width + 44;
  ctx.fillStyle = "rgba(255,255,255,0.22)"; roundRect(ctx, 80, 470, cw, 52, 26); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(art.cat, 102, 506);
  // タイトル
  ctx.font = `800 70px ${FONT}`; ctx.fillStyle = C.white;
  const lines = wrap(ctx, art.title, W - 160).slice(0, 5);
  drawLines(ctx, lines, 80, 640, 96);
  // スワイプ
  ctx.font = `700 30px ${FONT}`; ctx.globalAlpha = 0.95;
  ctx.fillText("スワイプで読む  →", 80, H - 110); ctx.globalAlpha = 1;
}
function drawContent(ctx, sec, idx, total) {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  // 上部アクセントバー
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, 14);
  // 番号バッジ
  ctx.fillStyle = C.green; roundRect(ctx, 80, 96, 92, 92, 20); ctx.fill();
  ctx.fillStyle = C.white; ctx.font = `800 50px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText(String(idx), 126, 162); ctx.textAlign = "left";
  // 見出し
  ctx.fillStyle = C.ink; ctx.font = `800 56px ${FONT}`;
  const hl = wrap(ctx, sec.head, W - 160).slice(0, 3);
  let y = drawLines(ctx, hl, 80, 300, 74);
  // 区切り線
  y += 24; ctx.strokeStyle = C.line; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W - 80, y); ctx.stroke();
  // 本文（可読性のため濃いめ＋やや太字）
  y += 70; ctx.fillStyle = "#1f2937"; ctx.font = `600 41px ${FONT}`;
  const bl = wrap(ctx, sec.text, W - 160).slice(0, 9);
  drawLines(ctx, bl, 80, y, 64);
  // フッター
  ctx.fillStyle = C.soft; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(IG_HANDLE, 80, H - 70);
  ctx.textAlign = "right"; ctx.fillText(`${idx} / ${total}`, W - 80, H - 70); ctx.textAlign = "left";
}
function drawCta(ctx, logo) {
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, H);
  const ls = 180;
  if (logo) { ctx.save(); roundRect(ctx, (W - ls) / 2, 250, ls, ls, 40); ctx.clip(); ctx.drawImage(logo, (W - ls) / 2, 250, ls, ls); ctx.restore(); }
  ctx.textAlign = "center"; ctx.fillStyle = C.white;
  ctx.font = `800 58px ${FONT}`;
  drawLines(ctx, ["積みプラの管理は", "「TSUMI TSUMI」で"], W / 2, 560, 78);
  ctx.font = `500 36px ${FONT}`; ctx.globalAlpha = 0.95;
  drawLines(ctx, ["バーコードでカンタン登録", "完全無料・登録不要のWebアプリ"], W / 2, 760, 54);
  ctx.globalAlpha = 1;
  // ボタン風
  ctx.fillStyle = C.white; const bw = 800, bx = (W - bw) / 2;
  roundRect(ctx, bx, 900, bw, 100, 50); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = `800 36px ${FONT}`;
  ctx.fillText("詳しくは プロフィールのリンク から", W / 2, 962);
  ctx.fillStyle = C.white; ctx.font = `700 32px ${FONT}`; ctx.globalAlpha = 0.95;
  ctx.fillText(IG_HANDLE, W / 2, 1120);
  ctx.globalAlpha = 1; ctx.textAlign = "left";
}

// ---------- メイン ----------
(async () => {
  const file = path.join(TIPS_DIR, SLUG + ".html");
  if (!fs.existsSync(file)) { console.error("記事が見つかりません: " + file); process.exit(1); }
  const art = parseArticle(fs.readFileSync(file, "utf8"));
  const logo = fs.existsSync(LOGO) ? await loadImage(LOGO) : null;

  const outDir = path.join(OUT_ROOT, SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  const total = art.sections.length + 2; // cover + content + cta
  const slides = [];
  // cover
  let cv = createCanvas(W, H); drawCover(cv.getContext("2d"), art, logo); slides.push(cv);
  // content
  art.sections.forEach((sec, i) => {
    const c = createCanvas(W, H); drawContent(c.getContext("2d"), sec, i + 1, art.sections.length); slides.push(c);
  });
  // cta
  let cc = createCanvas(W, H); drawCta(cc.getContext("2d"), logo); slides.push(cc);

  let n = 0;
  for (const c of slides) {
    n++;
    const buf = await c.encode("jpeg", 92);
    fs.writeFileSync(path.join(outDir, `slide-${n}.jpg`), buf);
  }

  // キャプション
  const caption = [
    art.title,
    "",
    art.lead,
    "",
    "▼続きと他のTIPSはプロフィールのリンクから",
    "積みプラ管理アプリ「TSUMI TSUMI」も無料公開中",
    IG_HANDLE,
    "",
    BASE_TAGS.join(" "),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "caption.txt"), caption, "utf8");

  console.log(`✅ ${SLUG}: ${slides.length}枚のスライドを生成 → public/social/${SLUG}/`);
  console.log(`   見出し: ${art.title}`);
  console.log(`   セクション: ${art.sections.map((s) => s.head).join(" / ")}`);
})();
