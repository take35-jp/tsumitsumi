#!/usr/bin/env node
/**
 * /paint/ および /topcoat/ への全リンクのリンクテキスト末尾に「（工事中）」を付与する。
 * 既に「工事中」が含まれている場合はスキップ（idempotent）。
 * PA-API取得後に画像が入って完成したら、このスクリプトを逆向きに使うか手動で外す。
 */
const fs = require("fs");
const path = require("path");

const TAG = "（工事中）";
const ROOT = path.join(__dirname, "..");

const files = [
  "index.html",
  "src/App.jsx",
  "public/gears.html",
  "public/admin.html",
  "public/topcoat/index.html",
  "public/paint/index.html",
  // TIPS記事はディレクトリスキャン
];

// public/tips/*.html を追加
const tipsDir = path.join(ROOT, "public/tips");
fs.readdirSync(tipsDir).forEach(f => {
  if (f.endsWith(".html")) files.push(`public/tips/${f}`);
});

let totalChanged = 0;
let totalLinks = 0;

// パターン: <a [href="/paint/"|href="/topcoat/"]...>...</a>
const linkRegex = /(<a[^>]*?href="\/(?:paint|topcoat)\/[^"]*"[^>]*>)([^<]+?)(<\/a>)/g;
// .tt-card パターン (LP用): <a class="tt-card" href="/paint/">...<div class="tt-card-title">...</div>
const cardTitleRegex = /(<a[^>]*class="tt-card"[^>]*href="\/(?:paint|topcoat)\/[^"]*"[^>]*>[\s\S]*?<div class="tt-card-title">)([^<]+?)(<\/div>)/g;

files.forEach(rel => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return;

  let content = fs.readFileSync(file, "utf8");
  const original = content;
  let linkCount = 0;

  // 通常の <a>テキスト</a> パターン
  content = content.replace(linkRegex, (match, openTag, linkText, closeTag) => {
    if (linkText.includes("工事中")) return match;
    linkCount++;
    return `${openTag}${linkText}${TAG}${closeTag}`;
  });

  // .tt-card のタイトル div （LP用）
  content = content.replace(cardTitleRegex, (match, prefix, title, suffix) => {
    if (title.includes("工事中")) return match;
    linkCount++;
    return `${prefix}${title}${TAG}${suffix}`;
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log(`  ✓ ${rel}  (+${linkCount}箇所)`);
    totalChanged++;
    totalLinks += linkCount;
  }
});

console.log(`\n${totalChanged}ファイル更新、${totalLinks}リンクに「${TAG}」付与完了`);
