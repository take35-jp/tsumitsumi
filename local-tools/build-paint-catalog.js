#!/usr/bin/env node
/**
 * 塗料大全(public/paint/index.html の PAINTS) と
 * トップコート大全(public/topcoat/index.html の ITEMS) を抽出し、
 * アプリ（マイパレット）が実行時に読み込む public/paint-catalog.json を生成する。
 *
 * 大全を更新したら再実行する:
 *   node local-tools/build-paint-catalog.js
 *
 * ※ 大全の配列はインラインJSなので eval で取り込む（このスクリプトはローカル実行専用）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAINT_HTML = path.join(ROOT, "public/paint/index.html");
const TOPCOAT_HTML = path.join(ROOT, "public/topcoat/index.html");
const OUT = path.join(ROOT, "public/paint-catalog.json");

function extractArray(htmlPath, name) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`));
  if (!m) throw new Error(`${name} が見つかりません: ${htmlPath}`);
  return eval(`[${m[1]}]`);
}
function extractObject(htmlPath, name) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(new RegExp(`const ${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) return {};
  try { return eval(`({${m[1]}})`); } catch { return {}; }
}

const PAINTS = extractArray(PAINT_HTML, "PAINTS");
const ITEMS = extractArray(TOPCOAT_HTML, "ITEMS");
const MFR_NAMES = extractObject(PAINT_HTML, "MFR_NAMES");

const paints = PAINTS.map((p) => ({
  mfr: p.mfr || "", lineup: p.lineup || "", type: p.type || "", code: p.code || "",
  name: p.name || "", finish: p.finish || "", color: p.color || "",
}));
const topcoats = ITEMS.map((p) => ({
  mfr: p.mfr || "", lineup: p.lineup || "", form: p.form || "", type: p.type || "",
  finish: p.finish || "", code: p.code || "", name: p.name || "",
}));

const out = {
  generatedAt: new Date().toISOString(),
  mfrNames: MFR_NAMES,
  paints,
  topcoats,
};
fs.writeFileSync(OUT, JSON.stringify(out), "utf8");
console.log(`✅ ${OUT}\n   塗料 ${paints.length} 件 / トップコート ${topcoats.length} 件 / メーカー ${Object.keys(MFR_NAMES).length}`);
