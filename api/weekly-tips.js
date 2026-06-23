// api/weekly-tips.js
//
// 週1回（Vercel Cron）で「プラモ製作TIPS」の新記事を自動生成して公開する。
// 生成は Claude API（Anthropic Messages API）、公開は GitHub Contents/Git Data API 経由で
// main ブランチへコミット → Vercel の自動再デプロイで本番反映。
//
// 設計方針:
//   - HTML の外枠（メタ情報・3種の構造化データJSON-LD・グローバルナビ・スタイル・
//     CTA・免責表記・フッター・loader.js・AdSense）はこの関数が「決め打ちで」組み立てる。
//     Claude には「記事本文(bodyHtml)＋メタ情報＋FAQ」だけを構造化出力(JSON)で書かせる。
//     → 既存記事テンプレートと完全に同じ体裁・有効なJSON-LDを常に保証できる。
//   - 図解多め（本文に inline <svg> を3〜4枚）を指示。
//   - 既出スラッグと重複しないよう、public/tips の一覧を取得して未公開トピックを選ぶ。
//     用意したトピックキューを使い切ったら Claude に新トピックを発案させる（無限運用）。
//
// 必要な環境変数（Vercel）:
//   ANTHROPIC_API_KEY  ... Claude API キー（必須）
//   GITHUB_TOKEN       ... 対象リポジトリ Contents: read/write 権限（/api/tips-save と共用）
//   CRON_SECRET        ... 任意。設定すると Vercel Cron が Authorization: Bearer <CRON_SECRET>
//                          を付与するので、その一致を必須化する（手動実行は ?secret= でも可）。
//   WEEKLY_TIPS_MODEL  ... 任意。既定 "claude-opus-4-8"。
//   GITHUB_REPO        ... 任意。既定 "take35-jp/tsumitsumi"
//   GITHUB_BRANCH      ... 任意。既定 "main"

export const config = { runtime: "nodejs", maxDuration: 300 };

const ADSENSE_CLIENT = "ca-pub-7474274830134796";
const SITE = "https://tsumitsumi.vercel.app";
const AMZ_TAG = "tsumitsumi232-22";

// 用意済みトピックキュー（初心者〜脱初心者向け・図解向き）。先頭から未公開のものを採用。
// 使い切ったら Claude に新規トピックを発案させる。
const TOPIC_QUEUE = [
  { slug: "putty-basics", title: "パテの種類と使い方 入門【ラッカーパテ・ポリパテ・エポパテ・光硬化】", category: "工具・準備" },
  { slug: "primer-surfacer", title: "サーフェイサー入門【役割・番手・吹き方・下地の傷チェック】", category: "塗装・基礎知識" },
  { slug: "spray-can-painting", title: "缶スプレー塗装 完全ガイド【持ち方・距離・乾燥・厚塗り防止】", category: "塗装・基礎知識" },
  { slug: "brush-painting-basics", title: "筆塗り入門【筆の選び方・希釈・ムラを防ぐ塗り重ね】", category: "塗装・基礎知識" },
  { slug: "weathering-basics", title: "ウェザリング入門【スミ入れ・ドライブラシ・チッピング・ウォッシング】", category: "塗装・基礎知識" },
  { slug: "atohame-kakou", title: "後ハメ加工 入門【塗装後に組める・合わせ目消しと両立】", category: "改造・ステップアップ" },
  { slug: "pla-ban-basics", title: "プラ板工作 入門【厚みの選び方・切り出し・接着・ディテールアップ】", category: "改造・ステップアップ" },
  { slug: "led-electrification", title: "LED電飾 入門【配線の基本・抵抗の選び方・安全な組み込み】", category: "改造・ステップアップ" },
  { slug: "paint-booth-guide", title: "塗装ブースの選び方【吸引力・サイズ・静音・換気の基本】", category: "工具・準備" },
  { slug: "scale-model-intro", title: "スケールモデル入門【カーモデル・戦車・飛行機・船の違いと始め方】", category: "入門・基礎知識" },
  { slug: "diorama-basics", title: "ジオラマ・情景づくり 入門【ベース・地面・草・水の表現】", category: "改造・ステップアップ" },
  { slug: "color-mixing-basics", title: "塗料の調色 入門【混色の基本・指定色の作り方・記録のコツ】", category: "塗装・基礎知識" },
  { slug: "mask-curve-guide", title: "曲面マスキング 入門【曲線テープ・ふちの密着・塗り分けのコツ】", category: "塗装・基礎知識" },
  { slug: "tool-maintenance", title: "工具のメンテナンス入門【ニッパーの手入れ・ヤスリの寿命・保管】", category: "工具・準備" },
];

const RELATED_POOL = [
  { url: "/tips/beginner-tools.html", label: "ガンプラ初心者が最初に揃える工具5選" },
  { url: "/tips/assembly-basics.html", label: "プラモの組み立て手順 完全ガイド" },
  { url: "/tips/gate-whitening.html", label: "ゲート跡が白くなる原因と解決法" },
  { url: "/tips/painting-methods.html", label: "塗装入門（エアブラシ/缶スプレー/筆塗り比較）" },
  { url: "/tips/paint-compatibility.html", label: "塗料の種類と重ね塗りの相性ガイド" },
  { url: "/tips/topcoat-guide.html", label: "トップコート完全ガイド" },
  { url: "/tips/panel-lining.html", label: "スミ入れ完全ガイド" },
  { url: "/tips/glue-types.html", label: "接着剤の種類と選び方" },
  { url: "/tips/parting-line.html", label: "パーティングライン・ヒケの消し方" },
];

// ---------- GitHub helpers ----------
function ghHeaders(token) {
  return { Authorization: `Bearer ${token}`, "User-Agent": "tsumitsumi-weekly-tips", Accept: "application/vnd.github+json" };
}
async function ghGetJson(url, token) {
  const r = await fetch(url, { headers: ghHeaders(token) });
  if (!r.ok) throw new Error(`GitHub GET ${url} -> ${r.status}`);
  return r.json();
}
function b64decode(s) { return Buffer.from(s, "base64").toString("utf8"); }

// 既存 tips スラッグ一覧（重複回避用）
async function listExistingSlugs(repo, branch, token) {
  const arr = await ghGetJson(`https://api.github.com/repos/${repo}/contents/public/tips?ref=${encodeURIComponent(branch)}`, token);
  return (Array.isArray(arr) ? arr : [])
    .filter((f) => f.type === "file" && /\.html$/.test(f.name) && f.name !== "index.html")
    .map((f) => f.name.replace(/\.html$/, ""));
}

// ---------- Claude (Anthropic Messages API) ----------
const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slug: { type: "string", description: "英小文字・数字・ハイフンのみ。例: putty-basics" },
    title: { type: "string", description: "記事タイトル（日本語・【】で要点を補足してよい）" },
    description: { type: "string", description: "120字程度のメタディスクリプション（日本語）" },
    category: { type: "string", description: "カテゴリ（例: 工具・準備 / 塗装・基礎知識 / 仕上げ・トラブル解決 / 入門・基礎知識 / 改造・ステップアップ）" },
    breadcrumbName: { type: "string", description: "パンくず3段目の短い名称" },
    leadHtml: { type: "string", description: "導入文の<p class=\"lead\">…</p>（1つ、HTML）" },
    bodyHtml: { type: "string", description: "記事本文のHTML。h2/h3・p・ul/ol・tip-box/warning-box・<figure><svg>…</svg></figure>（3〜4枚の図解）を含む。FAQ見出しや関連記事・CTA・免責・<article>タグは含めない（外枠は別途付与する）。" },
    indexDesc: { type: "string", description: "一覧カード用の短い説明（80〜110字・日本語）" },
    faq: {
      type: "array",
      description: "5問のFAQ。本文の最後に表示される。",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { q: { type: "string" }, a: { type: "string" } },
        required: ["q", "a"],
      },
    },
  },
  required: ["slug", "title", "description", "category", "breadcrumbName", "leadHtml", "bodyHtml", "indexDesc", "faq"],
};

async function generateArticle({ apiKey, model, chosen, existingSlugs }) {
  const system = [
    "あなたは日本のプラモデル情報サイト「TSUMI TSUMI（ツミツミ）」のTIPS記事ライターです。",
    "初心者〜脱初心者に向けた、正確で実用的な日本語記事を書きます。事実に基づき、誇張や誤った断定はしません。",
    "運営者表記は必ず「TSUMI TSUMI」。記事は読みやすく、図解（インラインSVG）を多めにします。",
  ].join("\n");

  const topicLine = chosen
    ? `今回のテーマ（このトピックで書く）: 「${chosen.title}」 / 推奨カテゴリ: ${chosen.category} / 推奨スラッグ: ${chosen.slug}`
    : "今回のテーマ: 下記の既出スラッグと重複しない、初心者〜脱初心者向けのプラモ製作TIPSを1つ自分で選んで書く（図解向きのテーマが望ましい）。";

  const user = [
    topicLine,
    "",
    `既に公開済みのスラッグ（重複禁止・これらと内容が被らないこと）: ${existingSlugs.join(", ")}`,
    "",
    "出力要件（JSONで返す。各フィールドはスキーマに従う）:",
    "- bodyHtml は記事本文のみ。使えるクラス: tip-box（💡ヒント）, warning-box（⚠️注意）。見出しは <h2> と <h3>。",
    "- 図解を必ず3〜4枚、本文中に <figure style=\"margin:24px 0;\"><svg viewBox=\"0 0 720 320\" role=\"img\" aria-label=\"…\" style=\"width:100%;height:auto;display:block;background:#fff;border:1px solid #e5e7eb;border-radius:12px;\">…</svg></figure> の形式で埋め込む。図にはタイトルの <text> を入れ、手描き風の簡易ベクター図でよい（ラベル必須・日本語可）。アクセント色は #22c55e/#f59e0b/#ef4444/#3b82f6 など。",
    "- 商品を勧める場合のみ、本文中に次の体裁の商品カードを1〜2個入れてよい（任意）:",
    `  <div class="product"><div class="product-thumb-slot">📦</div><div class="product-body"><div class="product-name">商品名</div><div class="product-desc">説明</div><a class="product-link" href="https://www.amazon.co.jp/s?k=検索語&tag=${AMZ_TAG}" target="_blank" rel="nofollow noopener noreferrer sponsored">🛒 Amazonで見る</a></div></div>`,
    "- bodyHtml には FAQ・関連記事・CTA・免責・<article>タグ・<h1>・<style>・<script> を含めないこと（外枠はシステム側で付与する）。",
    "- 見出し<h2>は本文(FAQを除く)で6個以上。本文は十分なボリューム（おおむね2500〜4500字相当）。",
    "- faq は5問。各回答は具体的で正確に。",
    "- slug は英小文字・数字・ハイフンのみ。既出スラッグと重複しないこと。",
    "- 強調は <strong> を使う（CSSで赤系強調になる）。",
  ].join("\n");

  const body = {
    model,
    max_tokens: 12000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "high", format: { type: "json_schema", schema: ARTICLE_SCHEMA } },
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Anthropic API error: " + (data?.error?.message || r.status));
  if (data.stop_reason === "refusal") throw new Error("Anthropic refused the request");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new Error("Anthropic returned empty content (stop_reason=" + data.stop_reason + ")");
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new Error("Failed to parse model JSON: " + e.message); }
  return obj;
}

// ---------- HTML assembly (外枠を決め打ちで組み立て) ----------
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function jsonLdEscape(s) { return String(s).replace(/<\/script>/gi, "<\\/script>"); }

const GLOBAL_NAV = `<nav class="tt-globalnav" aria-label="サイトメニュー" style="display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;padding:8px 12px;background:#ffffff;border-bottom:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Hiragino Sans,Meiryo,sans-serif;font-size:13px;line-height:1.5;">
    <a href="/" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">ホーム</a>
    <a href="/tips/" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">製作TIPS</a>
    <a href="/manual.html" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">取扱説明書</a>
    <a href="/paint/" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">塗料大全</a>
    <a href="/topcoat/" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">トップコート大全</a>
    <a href="/gears.html" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">おすすめ</a>
    <a href="/about.html" style="color:#374151;text-decoration:none;font-weight:600;padding:5px 9px;border-radius:6px;white-space:nowrap;">運営者情報</a>
</nav>`;

const STYLE_BLOCK = `<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif; color: #1f2937; background: #fafafa; line-height: 1.85; font-size: 16px; -webkit-font-smoothing: antialiased; }
  header.site { background: #fff; border-bottom: 1px solid #e5e7eb; padding: 14px 20px; position: sticky; top: 0; z-index: 50; backdrop-filter: blur(8px); }
  .site-inner { max-width: 760px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .logo { font-size: 16px; font-weight: 800; color: #111827; text-decoration: none; }
  .nav-back { color: #4b5563; text-decoration: none; font-size: 13px; }
  .nav-back:hover { color: #22c55e; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 60px; }
  .breadcrumb { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
  .breadcrumb a { color: #15803d; text-decoration: none; }
  h1 { font-size: 28px; font-weight: 800; margin: 0 0 12px; line-height: 1.4; color: #111827; }
  .meta { font-size: 12px; color: #9ca3af; margin-bottom: 24px; display: flex; gap: 12px; flex-wrap: wrap; }
  .meta .tag { background: #f3f4f6; padding: 2px 10px; border-radius: 20px; }
  .lead { font-size: 16px; color: #374151; margin-bottom: 28px; padding: 16px 18px; background: #fff7ed; border-left: 4px solid #f59e0b; border-radius: 6px; line-height: 1.85; }
  h2 { font-size: 21px; font-weight: 800; margin: 36px 0 14px; padding-left: 12px; border-left: 5px solid #22c55e; color: #111827; }
  h3 { font-size: 17px; font-weight: 700; margin: 24px 0 10px; color: #111827; }
  p { margin: 0 0 16px; color: #374151; }
  strong { color: #b91c1c; font-weight: 700; }
  ul, ol { margin: 0 0 16px; padding-left: 1.4em; }
  li { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th, td { padding: 8px; border-bottom: 1px solid #f0f0f0; text-align: left; }
  thead tr { background: #f3f4f6; }
  .tip-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin: 16px 0; font-size: 14px; }
  .tip-box::before { content: "💡 "; font-weight: 700; }
  .warning-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 18px; margin: 16px 0; font-size: 14px; }
  .warning-box::before { content: "⚠️ "; }
  .product { display: flex; gap: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin: 14px 0; align-items: stretch; }
  .product-thumb-slot { flex: 0 0 90px; width: 90px; height: 90px; background: #f3f4f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #d1d5db; font-size: 30px; overflow: hidden; }
  .product-body { flex: 1; min-width: 0; }
  .product-name { font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .product-desc { font-size: 13px; color: #4b5563; margin-bottom: 8px; }
  .product-link { display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px; background: #111; color: #fff; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; align-self: flex-start; }
  .product-link:hover { background: #333; }
  @media (max-width: 540px) { .product-thumb-slot { flex-basis: 72px; width: 72px; height: 72px; font-size: 26px; } }
  .cta-banner { background: linear-gradient(135deg, #4f8ef7, #22c55e); color: #fff; border-radius: 16px; padding: 28px 22px; text-align: center; margin: 40px 0; }
  .cta-banner .cta-logo { display: block; margin: 0 auto 14px; width: 100px; height: 100px; border-radius: 22px; box-shadow: 0 4px 16px rgba(0,0,0,0.25); }
  .cta-banner h2 { color: #fff; border-left: none; padding-left: 0; margin: 0 0 8px; }
  .cta-banner p { color: rgba(255,255,255,0.95); margin: 0 0 16px; }
  .cta-button { display: inline-block; padding: 12px 28px; background: #fff; color: #111; border-radius: 24px; font-weight: 800; text-decoration: none; font-size: 15px; }
  .related-section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px 22px; margin: 32px 0; }
  .related-section h3 { margin-top: 0; }
  .related-section ul { list-style: none; padding: 0; margin: 0; }
  .related-section li { padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
  .related-section li:last-child { border-bottom: none; }
  .related-section a { color: #15803d; text-decoration: none; font-size: 14px; }
  .related-section a:hover { text-decoration: underline; }
  .disclosure { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px 14px; border-radius: 6px; font-size: 12px; color: #92400e; margin: 24px 0; }
  footer { border-top: 1px solid #e5e7eb; margin-top: 60px; padding: 24px; text-align: center; font-size: 12px; color: #9ca3af; background: #fff; }
  footer .links { margin-bottom: 10px; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; }
  footer a { color: #6b7280; text-decoration: none; }
  footer a:hover { color: #22c55e; }
  @media (max-width: 540px) { h1 { font-size: 22px; } h2 { font-size: 18px; } main { padding: 24px 16px 50px; } }
</style>`;

function buildArticleHtml(a, dateISO, dateLabel) {
  const url = `${SITE}/tips/${a.slug}.html`;
  const related = RELATED_POOL.filter((r) => r.url !== `/tips/${a.slug}.html`).slice(0, 3);
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: a.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    image: `${SITE}/LOGO.png`,
    datePublished: `${dateISO}T09:00:00+09:00`,
    dateModified: `${dateISO}T09:00:00+09:00`,
    author: { "@type": "Organization", name: "TSUMI TSUMI", url: `${SITE}/about.html` },
    publisher: { "@type": "Organization", name: "TSUMI TSUMI", logo: { "@type": "ImageObject", url: `${SITE}/LOGO.png` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
  };
  const crumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "TOP", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "TIPS", item: `${SITE}/tips/` },
      { "@type": "ListItem", position: 3, name: a.breadcrumbName || a.title },
    ],
  };
  const faqHtml = a.faq.map((f) => `    <h3>Q. ${esc(f.q)}</h3>\n    <p>${esc(f.a)}</p>`).join("\n");
  const relatedHtml = related.map((r) => `        <li><a href="${r.url}">→ ${esc(r.label)}</a></li>`).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(a.title)}｜ツミツミTIPS</title>
<meta name="description" content="${esc(a.description)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<meta property="og:title" content="${esc(a.title)}" />
<meta property="og:description" content="${esc(a.description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="ツミツミ" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SITE}/LOGO.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="article:published_time" content="${dateISO}T09:00:00+09:00" />
<meta property="article:modified_time" content="${dateISO}T09:00:00+09:00" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(a.title)}" />
<meta name="twitter:description" content="${esc(a.description)}" />
<meta name="twitter:image" content="${SITE}/LOGO.png" />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/png" href="/apple-touch-icon.png" />

<script type="application/ld+json">
${jsonLdEscape(JSON.stringify(articleLd, null, 2))}
</script>
<script type="application/ld+json">
${jsonLdEscape(JSON.stringify(crumbLd, null, 2))}
</script>
<script type="application/ld+json">
${jsonLdEscape(JSON.stringify(faqLd, null, 2))}
</script>
${STYLE_BLOCK}
    <!-- Google AdSense サイト所有権確認・自動広告 -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}"
         crossorigin="anonymous"></script>
  </head>
<body>
${GLOBAL_NAV}

<header class="site">
  <div class="site-inner">
    <a class="logo" href="/">TSUMI TSUMI</a>
    <a class="nav-back" href="/">← アプリに戻る</a>
  </div>
</header>

<main>
  <article>
    <div class="breadcrumb">
      <a href="/">TOP</a> / <a href="/tips/">TIPS</a> / ${esc(a.category)}
    </div>

    <h1>${esc(a.title)}</h1>

    <div class="meta">
      <span class="tag">${esc(a.category)}</span>
      <time datetime="${dateISO}">${dateLabel} 公開</time>
    </div>

    <div style="font-size:12px;color:#9ca3af;margin:0 0 14px;padding:6px 12px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:4px;">※ 本記事はアフィリエイト広告（PR・Amazonアソシエイト等）を含みます。詳細は<a href="/privacy.html" style="color:#6b7280;text-decoration:underline;">プライバシーポリシー</a>をご確認ください。</div>

    ${a.leadHtml}

    ${a.bodyHtml}

    <h2>よくある質問（FAQ）</h2>
${faqHtml}

    <div class="cta-banner">
      <img src="/LOGO.png" alt="TSUMI TSUMI" class="cta-logo" width="100" height="100" />
      <h2>積みプラの管理は「TSUMI TSUMI」で</h2>
      <p>バーコードをスキャンするだけでカンタン登録。完全無料、登録不要のWebアプリ。</p>
      <a href="/" class="cta-button">TSUMI TSUMIを使ってみる→</a>
    </div>

    <div class="related-section">
      <h3>📚 関連記事</h3>
      <ul>
${relatedHtml}
      </ul>
    </div>

    <div class="disclosure">
      ※ 本記事の商品リンクは Amazon アソシエイトです。Amazon のアソシエイトとして、当サイトは適格販売により収入を得ています。リンク経由で商品をご購入いただくと、一部が運営費に充てられます。商品の選定は運営者が独自に行っており、外部からの依頼は受けていません。
    </div>

  </article>
</main>

<footer>
  <div class="links">
    <a href="/">アプリ</a>
    <a href="/manual.html">取扱説明書</a>
    <a href="/about.html">運営者情報</a>
    <a href="/terms.html">利用規約</a>
    <a href="/privacy.html">プライバシーポリシー</a>
    <a href="/gears.html">おすすめ定番アイテム</a>
    <a href="/paint/">塗料大全</a>
    <a href="/topcoat/">トップコート大全</a>
    <a href="/tips/">TIPS一覧</a>
    <a href="https://x.com/tsumitsumi_pla" target="_blank" rel="noopener noreferrer">@tsumitsumi_pla</a>
  </div>
  <div>© 2026 TSUMI TSUMI</div>
</footer>

<!-- gears_catalog から商品カードへ画像・価格・ASIN直リンクを注入 -->
<script src="/tips/loader.js"></script>

</body>
</html>
`;
}

// index.html に新カードを先頭挿入
function insertIndexCard(indexHtml, a, dateLabel) {
  const card = `
    <a class="article-card" href="/tips/${a.slug}.html">
      <span class="article-tag">${esc(a.category)}</span>
      <div class="article-title">${esc(a.title)}</div>
      <div class="article-desc">${esc(a.indexDesc)}</div>
      <div class="article-meta">${dateLabel} 公開</div>
    </a>
`;
  const marker = '<div class="article-grid">';
  const i = indexHtml.indexOf(marker);
  if (i === -1) throw new Error("index.html: article-grid マーカーが見つかりません");
  const at = i + marker.length;
  return indexHtml.slice(0, at) + "\n" + card + indexHtml.slice(at);
}

// sitemap.xml に新URLを </urlset> 直前へ挿入
function insertSitemapUrl(xml, slug, dateISO) {
  const entry = `  <url>
    <loc>${SITE}/tips/${slug}.html</loc>
    <lastmod>${dateISO}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
`;
  const marker = "</urlset>";
  const i = xml.lastIndexOf(marker);
  if (i === -1) throw new Error("sitemap.xml: </urlset> が見つかりません");
  return xml.slice(0, i) + entry + xml.slice(i);
}

// Git Data API で3ファイルを1コミットに（原子的）
async function commitFiles(repo, branch, token, files, message) {
  const ref = await ghGetJson(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, token);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await ghGetJson(`https://api.github.com/repos/${repo}/git/commits/${baseCommitSha}`, token);
  const baseTreeSha = baseCommit.tree.sha;

  const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
    method: "POST", headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })) }),
  });
  const tree = await treeRes.json();
  if (!treeRes.ok) throw new Error("create tree failed: " + (tree.message || treeRes.status));

  const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST", headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommitSha] }),
  });
  const commit = await commitRes.json();
  if (!commitRes.ok) throw new Error("create commit failed: " + (commit.message || commitRes.status));

  const updRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH", headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  const upd = await updRes.json();
  if (!updRes.ok) throw new Error("update ref failed: " + (upd.message || updRes.status));
  return commit;
}

// ---------- handler ----------
export default async function handler(req, res) {
  const APIKEY = process.env.ANTHROPIC_API_KEY;
  const TOKEN = process.env.GITHUB_TOKEN;
  const MODEL = process.env.WEEKLY_TIPS_MODEL || "claude-opus-4-8";
  const REPO = process.env.GITHUB_REPO || "take35-jp/tsumitsumi";
  const BRANCH = process.env.GITHUB_BRANCH || "main";
  const CRON_SECRET = process.env.CRON_SECRET;

  // 認証: CRON_SECRET があれば Vercel Cron の Bearer か ?secret= の一致を必須化
  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    const q = (req.query && req.query.secret) || "";
    if (auth !== `Bearer ${CRON_SECRET}` && q !== CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }
  if (!APIKEY || !TOKEN) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY / GITHUB_TOKEN が未設定です" });
  }

  try {
    const existingSlugs = await listExistingSlugs(REPO, BRANCH, TOKEN);

    // 未公開のキュー項目を選ぶ。無ければ Claude に発案させる（chosen=null）。
    const chosen = TOPIC_QUEUE.find((t) => !existingSlugs.includes(t.slug)) || null;

    // 生成（最大2回まで slug 重複/簡易検証で再試行）
    let a = null, lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const gen = await generateArticle({ apiKey: APIKEY, model: MODEL, chosen, existingSlugs });
      let slug = String(gen.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (!slug) { lastErr = "empty slug"; continue; }
      // 重複回避
      if (existingSlugs.includes(slug)) {
        let n = 2; while (existingSlugs.includes(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      gen.slug = slug;
      // 簡易検証
      if (!gen.bodyHtml || gen.bodyHtml.length < 800) { lastErr = "body too short"; continue; }
      if (!Array.isArray(gen.faq) || gen.faq.length < 3) { lastErr = "faq too few"; continue; }
      a = gen; break;
    }
    if (!a) return res.status(502).json({ error: "記事生成に失敗しました: " + lastErr });

    // 日付
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
    const dateISO = `${y}-${m}-${d}`;
    const dateLabel = `${y}/${m}/${d}`;

    // 既存 index.html / sitemap.xml を取得して更新
    const idxMeta = await ghGetJson(`https://api.github.com/repos/${REPO}/contents/public/tips/index.html?ref=${encodeURIComponent(BRANCH)}`, TOKEN);
    const smMeta = await ghGetJson(`https://api.github.com/repos/${REPO}/contents/public/sitemap.xml?ref=${encodeURIComponent(BRANCH)}`, TOKEN);
    const indexHtml = b64decode(idxMeta.content);
    const sitemapXml = b64decode(smMeta.content);

    const articleHtml = buildArticleHtml(a, dateISO, dateLabel);
    const newIndex = insertIndexCard(indexHtml, a, dateLabel);
    const newSitemap = insertSitemapUrl(sitemapXml, a.slug, dateISO);

    const commit = await commitFiles(REPO, BRANCH, TOKEN, [
      { path: `public/tips/${a.slug}.html`, content: articleHtml },
      { path: "public/tips/index.html", content: newIndex },
      { path: "public/sitemap.xml", content: newSitemap },
    ], `content: 週次TIPS自動追加「${a.title}」(${a.slug})`);

    return res.status(200).json({
      ok: true, slug: a.slug, title: a.title, category: a.category,
      url: `${SITE}/tips/${a.slug}.html`,
      commit: commit.sha, fromQueue: !!chosen,
      message: "記事をコミットしました。Vercel 再デプロイ後（約1〜2分）に本番反映されます。",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
