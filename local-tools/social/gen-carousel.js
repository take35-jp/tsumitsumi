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
const FONT = '"Noto Sans JP", "Yu Gothic", "Meiryo", "IPAGothic", sans-serif';
const C = {
  brandA: "#4f8ef7", brandB: "#22c55e",
  ink: "#0f172a", sub: "#475569", soft: "#64748b",
  paper: "#ffffff", line: "#e5e7eb", chip: "#eef2f7",
  card: "#f5f9fd", cardLine: "#dbe7f3", accent: "#2563eb",
  green: "#16a34a", orange: "#f59e0b", white: "#ffffff",
};
const IG_HANDLE = "@take35_pla"; // 投稿先Instagramアカウント（実ハンドル）
const BASE_TAGS = [
  "#ガンプラ", "#プラモデル", "#プラモ", "#積みプラ", "#積みプラ崩し",
  "#模型", "#模型好きと繋がりたい", "#ガンプラ好きと繋がりたい",
  "#プラモデル好きな人と繋がりたい", "#ガンプラ初心者", "#ガンプラ製作",
  "#TSUMITSUMI", "#ツミツミ",
]; // Instagram は最大30個まで可。発見性のため関連タグを厚めに

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
  const leadRaw = (html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || "";
  const lead = firstSentences(leadRaw, 70);
  const leadFull = firstSentences(leadRaw, 120);

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
  const bodyText = stripTags(body).slice(0, 6000); // Claude にそのまま渡す本文（HTML除去）
  return { title, cat, lead, leadFull, bodyText, sections: sections.slice(0, MAX) };
}

// ---------- Claude で 5W1H のカルーセル本文＆キャプションを執筆 ----------
// 機械抽出だと断片的で伝わらないため、記事を読み直して「役立つ情報」を明確に書き直す。
function readEnvKey(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const m = env.match(new RegExp("^" + name + "=(.+)$", "m"));
    if (m) return m[1].trim();
  } catch (e) {}
  return null;
}
const AI_MODEL = process.env.WEEKLY_TIPS_MODEL || "claude-opus-4-8";
const CAROUSEL_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["coverSubtitle", "slides", "caption"],
  properties: {
    coverSubtitle: { type: "string", description: "表紙のサブ見出し。誰向けで何が分かるかを1〜2行で明確に。" },
    slides: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["head", "body"],
        properties: {
          head: { type: "string", description: "そのスライドの結論・要点（短く具体的に。体言止め可）" },
          body: { type: "string", description: "結論の根拠と具体的なやり方を2〜4文で。固有名詞・数値・手順・理由を入れ、それ単体で意味が通るように。曖昧な断片は禁止。" },
        },
      },
    },
    caption: { type: "string", description: "Instagram本文。1行目に結論フック→何の話か→誰に役立つか→要点を箇条書き→保存を促す一言。絵文字は控えめ、誇張せず正確に。ハッシュタグ・アカウント名・アプリ宣伝は書かない（システムが付与）。" },
  },
};
async function authorCarousel(art) {
  const apiKey = readEnvKey("ANTHROPIC_API_KEY");
  if (!apiKey) { console.log("  （ANTHROPIC_API_KEY 未設定のためAI執筆をスキップ→従来の抽出で生成）"); return null; }
  const system = [
    "あなたはプラモデル初心者向けInstagramカルーセルの編集者です。日本語で執筆します。",
    "目的：記事の内容を 5W1H（誰が・何を・なぜ・いつ・どこで・どうやって）に沿って、初心者にもハッキリ伝わるように書き直すこと。",
    "原則：①各スライドは単体で意味が通る完結した『役立つ情報』にする。②抽象的・断片的な表現（例『順番に並べると：』だけ）は禁止。③具体的な手順・数値・道具名・理由を必ず入れる。④誇張や不正確な断定をしない。⑤やさしい言葉で簡潔に。",
    "記事に書かれていない事実を創作しないこと。",
  ].join("\n");
  const user = [
    `タイトル: ${art.title}`,
    `カテゴリ: ${art.cat}`,
    `リード: ${art.leadFull || art.lead || ""}`,
    "",
    "本文（HTML除去済み・抜粋）:",
    art.bodyText || "",
    "",
    "上記をもとに、カルーセル用の coverSubtitle / slides(4〜6枚) / caption を作成してください。各 slide.body は2〜4文で具体的に。",
  ].join("\n");
  const reqBody = {
    model: AI_MODEL, max_tokens: 4000, system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "high", format: { type: "json_schema", schema: CAROUSEL_SCHEMA } },
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(reqBody),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Anthropic API error: " + (data && data.error && data.error.message || r.status));
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new Error("空のレスポンス (stop_reason=" + data.stop_reason + ")");
  return JSON.parse(text);
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
function drawCover(ctx, art, logo, total) {
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, H);
  // 装飾の半透明サークル
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.arc(W - 110, 210, 280, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(120, H - 110, 220, 0, Math.PI * 2); ctx.fill();
  // ロゴ＋ワードマーク
  const ls = 92;
  if (logo) { ctx.save(); roundRect(ctx, 80, 88, ls, ls, 22); ctx.clip(); ctx.drawImage(logo, 80, 88, ls, ls); ctx.restore(); }
  ctx.fillStyle = C.white; ctx.textBaseline = "alphabetic";
  ctx.font = `800 38px ${FONT}`; ctx.fillText("TSUMI TSUMI", 192, 132);
  ctx.font = `500 25px ${FONT}`; ctx.globalAlpha = 0.92;
  ctx.fillText("製作TIPS / MAKING TIPS", 192, 168); ctx.globalAlpha = 1;
  // カテゴリチップ
  ctx.font = `700 26px ${FONT}`;
  const cw = ctx.measureText(art.cat).width + 48;
  ctx.fillStyle = "rgba(255,255,255,0.22)"; roundRect(ctx, 80, 430, cw, 54, 27); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(art.cat, 104, 467);
  // タイトル
  ctx.font = `800 72px ${FONT}`; ctx.fillStyle = C.white;
  const lines = wrap(ctx, art.title, W - 160).slice(0, 5);
  let y = drawLines(ctx, lines, 80, 600, 96);
  // リード（プレビュー）
  if (art.lead) {
    ctx.font = `500 32px ${FONT}`; ctx.globalAlpha = 0.95;
    const ll = wrap(ctx, art.lead, W - 170).slice(0, 3);
    y = drawLines(ctx, ll, 80, y + 40, 48); ctx.globalAlpha = 1;
  }
  // 下部：枚数バッジ＋スワイプ
  ctx.font = `700 28px ${FONT}`;
  const badge = `全${total}枚でやさしく解説`;
  const bw = ctx.measureText(badge).width + 48;
  ctx.fillStyle = "rgba(255,255,255,0.18)"; roundRect(ctx, 80, H - 192, bw, 56, 28); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(badge, 104, H - 154);
  ctx.font = `800 32px ${FONT}`; ctx.fillText("スワイプで読む  →", 80, H - 92);
}
function drawAgenda(ctx, art) {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, 14);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.accent; ctx.font = `800 28px ${FONT}`;
  ctx.fillText("WHAT YOU'LL LEARN", 80, 142);
  ctx.fillStyle = C.ink; ctx.font = `800 58px ${FONT}`;
  ctx.fillText("この記事でわかること", 80, 214);
  ctx.strokeStyle = C.line; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(80, 252); ctx.lineTo(W - 80, 252); ctx.stroke();
  let y = 340;
  art.sections.slice(0, 6).forEach((s, i) => {
    ctx.fillStyle = C.green; roundRect(ctx, 80, y - 46, 64, 64, 16); ctx.fill();
    ctx.fillStyle = C.white; ctx.font = `800 34px ${FONT}`; ctx.textAlign = "center";
    ctx.fillText(String(i + 1), 112, y - 2); ctx.textAlign = "left";
    ctx.fillStyle = C.ink; ctx.font = `700 38px ${FONT}`;
    const hl = wrap(ctx, s.head, W - 240).slice(0, 2);
    drawLines(ctx, hl, 168, y - (hl.length > 1 ? 16 : 0), 46);
    y += hl.length > 1 ? 148 : 122;
  });
  ctx.fillStyle = C.soft; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(IG_HANDLE, 80, H - 70);
  ctx.textAlign = "right"; ctx.fillText("INDEX", W - 80, H - 70); ctx.textAlign = "left";
}
function drawContent(ctx, sec, idx, total) {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  // 上部アクセントバー
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, 14);
  ctx.textBaseline = "alphabetic";
  // POINT ラベル＋番号バッジ
  ctx.fillStyle = C.accent; ctx.font = `800 28px ${FONT}`;
  ctx.fillText(`POINT ${idx}`, 192, 150);
  ctx.fillStyle = C.green; roundRect(ctx, 80, 96, 92, 92, 22); ctx.fill();
  ctx.fillStyle = C.white; ctx.font = `800 50px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText(String(idx), 126, 162); ctx.textAlign = "left";
  // 見出し
  ctx.fillStyle = C.ink; ctx.font = `800 54px ${FONT}`;
  const hl = wrap(ctx, sec.head, W - 160).slice(0, 3);
  let y = drawLines(ctx, hl, 80, 290, 72);
  // 区切り線
  y += 22; ctx.strokeStyle = C.line; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(W - 80, y); ctx.stroke();
  // 本文カード（可読性のため淡い背景＋左アクセント）
  y += 44;
  ctx.font = `600 40px ${FONT}`;
  const lh = 62;
  const bl = wrap(ctx, sec.text, W - 240).slice(0, 9);
  const cardPadX = 40, cardPadY = 46;
  const cardH = (bl.length - 1) * lh + 40 + cardPadY * 2;
  ctx.fillStyle = C.card; roundRect(ctx, 80, y, W - 160, cardH, 28); ctx.fill();
  ctx.fillStyle = C.green; roundRect(ctx, 80, y, 12, cardH, 6); ctx.fill();
  ctx.fillStyle = "#1f2937"; ctx.font = `600 40px ${FONT}`;
  drawLines(ctx, bl, 80 + cardPadX + 18, y + cardPadY + 34, lh);
  // フッター
  ctx.fillStyle = C.soft; ctx.font = `600 26px ${FONT}`;
  ctx.fillText(IG_HANDLE, 80, H - 70);
  ctx.textAlign = "right"; ctx.fillText(`${idx} / ${total}`, W - 80, H - 70); ctx.textAlign = "left";
}
function drawCta(ctx, logo) {
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.arc(W - 90, 150, 240, 0, Math.PI * 2); ctx.fill();
  ctx.textBaseline = "alphabetic";
  const ls = 150;
  if (logo) { ctx.save(); roundRect(ctx, (W - ls) / 2, 150, ls, ls, 36); ctx.clip(); ctx.drawImage(logo, (W - ls) / 2, 150, ls, ls); ctx.restore(); }
  ctx.textAlign = "center"; ctx.fillStyle = C.white;
  ctx.font = `800 56px ${FONT}`;
  drawLines(ctx, ["積みプラの管理は", "「TSUMI TSUMI」"], W / 2, 400, 74);
  ctx.font = `500 30px ${FONT}`; ctx.globalAlpha = 0.95;
  ctx.fillText("完全無料・登録不要のWebアプリ", W / 2, 506); ctx.globalAlpha = 1;
  // 機能カード3つ
  const feats = [
    ["在庫管理", "バーコードでカンタン登録・総額も把握"],
    ["モデラーズアルバム", "完成作品をポートフォリオ化"],
    ["My PALETTE", "塗料・調色レシピを色見本つき管理"],
  ];
  let fy = 580;
  feats.forEach((f) => {
    ctx.fillStyle = "rgba(255,255,255,0.14)"; roundRect(ctx, 120, fy, W - 240, 108, 22); ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = C.white; ctx.font = `800 34px ${FONT}`; ctx.fillText(f[0], 160, fy + 46);
    ctx.font = `500 27px ${FONT}`; ctx.globalAlpha = 0.92; ctx.fillText(f[1], 160, fy + 86); ctx.globalAlpha = 1;
    fy += 126;
  });
  // ボタン風＋ハンドル
  ctx.textAlign = "center";
  ctx.fillStyle = C.white; const bw = 820, bx = (W - bw) / 2;
  roundRect(ctx, bx, fy + 16, bw, 96, 48); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = `800 34px ${FONT}`;
  ctx.fillText("プロフィールのリンクから  →", W / 2, fy + 76);
  ctx.fillStyle = C.white; ctx.font = `700 30px ${FONT}`; ctx.globalAlpha = 0.95;
  ctx.fillText(IG_HANDLE, W / 2, fy + 166);
  ctx.globalAlpha = 1; ctx.textAlign = "left";
}

// ---------- 記事の関連商品（tips-products.json）----------
async function fetchImageBuffer(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function loadArticleProducts(html) {
  let items = {};
  try { items = (JSON.parse(fs.readFileSync(path.join(ROOT, "public", "tips-products.json"), "utf8")).items) || {}; } catch (e) { return []; }
  const out = [], seen = new Set();
  const re = /data-product-id="([^"]+)"[\s\S]*?product-name">\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) && out.length < 4) {
    const id = m[1]; if (seen.has(id)) continue; seen.add(id);
    const it = items[id];
    if (it && it.image) out.push({ name: m[2].replace(/\([^)]*\)/g, "").replace(/（[^）]*）/g, "").trim(), price: it.price, image: it.image });
  }
  // 画像はタイムアウト付きで取得（ハング防止）。取れたものだけ表示。
  for (const p of out) { const buf = await fetchImageBuffer(p.image); if (buf) { try { p.img = await loadImage(buf); } catch (e) { p.img = null; } } }
  return out.filter((p) => p.img);
}
function drawContain(ctx, img, x, y, w, h) {
  const r = Math.min(w / img.width, h / img.height);
  const dw = img.width * r, dh = img.height * r;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function drawProducts(ctx, products, logo) {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = grad(ctx); ctx.fillRect(0, 0, W, 14);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.accent; ctx.font = `800 28px ${FONT}`; ctx.fillText("PICKS", 80, 150);
  ctx.fillStyle = C.ink; ctx.font = `800 46px ${FONT}`; ctx.fillText("この記事のおすすめ", 80, 214);
  const M = 56, GAP = 28, cols = 2, cellW = (W - 2 * M - GAP) / 2, imgH = 300, cellH = 430, top = 262;
  products.slice(0, 4).forEach((p, i) => {
    const cx = M + (i % cols) * (cellW + GAP);
    const cy = top + Math.floor(i / cols) * (cellH + GAP);
    ctx.fillStyle = "#f5f9fd"; roundRect(ctx, cx, cy, cellW, imgH, 18); ctx.fill();
    ctx.save(); roundRect(ctx, cx, cy, cellW, imgH, 18); ctx.clip();
    if (p.img) drawContain(ctx, p.img, cx + 18, cy + 18, cellW - 36, imgH - 36);
    ctx.restore();
    ctx.fillStyle = C.ink; ctx.font = `700 24px ${FONT}`;
    const nm = wrap(ctx, p.name, cellW).slice(0, 2);
    const ty = cy + imgH + 40; drawLines(ctx, nm, cx, ty, 30);
    if (p.price != null) { ctx.fillStyle = "#b91c1c"; ctx.font = `800 26px ${FONT}`; ctx.fillText("¥" + Number(p.price).toLocaleString("ja-JP"), cx, ty + nm.length * 30 + 10); }
  });
  ctx.fillStyle = C.soft; ctx.font = `600 24px ${FONT}`; ctx.textAlign = "center";
  ctx.fillText("詳しくは プロフィールのリンク から", W / 2, H - 66); ctx.textAlign = "left";
}

// ---------- メイン ----------
(async () => {
  const file = path.join(TIPS_DIR, SLUG + ".html");
  if (!fs.existsSync(file)) { console.error("記事が見つかりません: " + file); process.exit(1); }
  const html = fs.readFileSync(file, "utf8");
  const art = parseArticle(html);

  // 5W1Hに沿った明確な本文を Claude で執筆（失敗・キー無しは従来の抽出にフォールバック）。--no-ai でスキップ。
  const NO_AI = ARGV.includes("--no-ai");
  let authoredCaption = null;
  if (!NO_AI) {
    try {
      const authored = await authorCarousel(art);
      if (authored && Array.isArray(authored.slides) && authored.slides.length) {
        art.lead = authored.coverSubtitle || art.lead;
        art.leadFull = authored.coverSubtitle || art.leadFull;
        art.sections = authored.slides.map((s) => ({ head: s.head, text: s.body }));
        authoredCaption = authored.caption || null;
        console.log("  ✍ Claudeでカルーセル本文を執筆しました（5W1H）");
      }
    } catch (e) { console.warn("  ⚠ AI執筆に失敗→従来の抽出で継続: " + (e.message || e)); }
  }

  const logo = fs.existsSync(LOGO) ? await loadImage(LOGO) : null;

  const outDir = path.join(OUT_ROOT, SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // この記事に関連する商品（tips-products.json）＝商品写真を最大4点。画像を実際にロード。
  const products = await loadArticleProducts(html);
  if (products.length) console.log(`  ✓ 関連商品スライド: ${products.length}点の商品写真を追加`);

  // Instagram カルーセルは最大10枚。cover+agenda+cta=3枚固定＋商品スライド(0/1)。本文はその残り。
  const hasProducts = products.length > 0;
  art.sections = art.sections.slice(0, hasProducts ? 6 : 7);
  const total = art.sections.length + 3 + (hasProducts ? 1 : 0);
  const slides = [];
  // cover
  let cv = createCanvas(W, H); drawCover(cv.getContext("2d"), art, logo, total); slides.push(cv);
  // agenda（この記事でわかること）
  let ag = createCanvas(W, H); drawAgenda(ag.getContext("2d"), art); slides.push(ag);
  // content
  art.sections.forEach((sec, i) => {
    const c = createCanvas(W, H); drawContent(c.getContext("2d"), sec, i + 1, art.sections.length); slides.push(c);
  });
  // 商品スライド（記事に関連する実際の商品写真）
  if (hasProducts) { let pc = createCanvas(W, H); drawProducts(pc.getContext("2d"), products, logo); slides.push(pc); }
  // cta
  let cc = createCanvas(W, H); drawCta(cc.getContext("2d"), logo); slides.push(cc);

  let n = 0;
  for (const c of slides) {
    n++;
    const buf = await c.encode("jpeg", 92);
    fs.writeFileSync(path.join(outDir, `slide-${n}.jpg`), buf);
  }

  // キャプション：AI執筆があればそれを本文に、無ければ従来の要点リストを使う。末尾に共通CTA＋ハッシュタグ。
  const points = art.sections.map((s, i) => `${i + 1}. ${s.head}`).slice(0, 6);
  const captionMain = authoredCaption || [
    art.leadFull || art.lead,
    "",
    "──────────",
    "◤ この投稿でわかること ◢",
    ...points,
    "──────────",
  ].join("\n");
  const caption = [
    `【${art.cat}】${art.title}`,
    "",
    captionMain,
    "",
    "保存して、作業中に見返すのがおすすめ。",
    "図解つきの全文・他のTIPSはプロフィールのリンクから読めます。",
    "",
    "積みプラ管理アプリ「TSUMI TSUMI」も無料公開中",
    "・バーコードで在庫管理／完成作品のアルバム／塗料管理 My PALETTE",
    IG_HANDLE,
    "",
    BASE_TAGS.join(" "),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "caption.txt"), caption, "utf8");

  console.log(`✅ ${SLUG}: ${slides.length}枚のスライドを生成 → public/social/${SLUG}/`);
  console.log(`   見出し: ${art.title}`);
  console.log(`   セクション: ${art.sections.map((s) => s.head).join(" / ")}`);
})();
