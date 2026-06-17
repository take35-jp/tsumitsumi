#!/usr/bin/env node
/**
 * 塗料大全(PAINTS) / トップコート大全(ITEMS) の各商品を Creators API searchItems で検索し、
 * ASIN・画像・価格を取得して asin_map に投入する。
 *
 * key は paint/index.html・topcoat/index.html の makeKey と完全一致させる（loader.js が引けるように）。
 *
 * 使い方:
 *   node local-tools/paapi-paint-search.js --sample 20      # 等間隔20件を検索→JSON出力（書き込み無し・精度確認用）
 *   node local-tools/paapi-paint-search.js --all            # 全件検索→JSON出力（書き込み無し）
 *   node local-tools/paapi-paint-search.js --all --upsert   # 全件検索→high/mediumを asin_map に書き込み
 *
 * 出力JSON: local-tools/paint-asin-results.json
 * 進捗ログ: local-tools/paint-search.log
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");
const SUPABASE_URL = get("SUPABASE_URL") || "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SERVICE_ROLE = get("SUPABASE_SERVICE_ROLE_KEY");

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const MARKETPLACE = "www.amazon.co.jp";

const ARGV = process.argv.slice(2);
const SAMPLE = ARGV.includes("--sample") ? parseInt(ARGV[ARGV.indexOf("--sample") + 1], 10) : null;
const ALL = ARGV.includes("--all");
const UPSERT = ARGV.includes("--upsert");
const RETRY = ARGV.includes("--retry-unmatched"); // asin_map に未登録の商品だけ、複数クエリで再検索

const REPO_ROOT = path.resolve(__dirname, "..");
const PAINT_HTML = path.join(REPO_ROOT, "public/paint/index.html");
const TOPCOAT_HTML = path.join(REPO_ROOT, "public/topcoat/index.html");
const OUT_JSON = path.join(__dirname, "paint-asin-results.json");
const LOG = path.join(__dirname, "paint-search.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(msg);
}

function normalize(s) {
  return String(s || "").toLowerCase().replace(/[\s　\-/・()（）「」【】［］\[\].,、。]/g, "");
}
function makeKey(p, ns) {
  const str = `${p.mfr || ""}|${p.lineup || ""}|${p.code || ""}|${p.name || ""}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash = hash & hash; }
  return `${ns}-${p.mfr || "x"}-${Math.abs(hash).toString(36)}`;
}
function extractArray(htmlPath, arrayName) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const re = new RegExp(`const ${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`);
  const m = html.match(re);
  if (!m) throw new Error(`配列 ${arrayName} が見つかりません: ${htmlPath}`);
  return eval(`[${m[1]}]`);
}
function extractObject(htmlPath, objName) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const re = new RegExp(`const ${objName}\\s*=\\s*\\{([\\s\\S]*?)\\};`); // 1行/複数行どちらも
  const m = html.match(re);
  if (!m) return {};
  try { return eval(`({${m[1]}})`); } catch { return {}; }
}

// 塗料タイプ判定（エナメル/水性/ラッカー/アクリル）。商品の種別と候補タイトルの種別が食い違ったら減点。
function paintType(s) {
  s = normalize(s);
  if (s.includes("エナメル")) return "enamel";
  if (s.includes("水性") || s.includes("アクリジョン")) return "aqueous";
  if (s.includes("ラッカー")) return "lacquer";
  if (s.includes("アクリル")) return "acrylic";
  return null;
}

let MFR_NAMES = {};
try { MFR_NAMES = extractObject(PAINT_HTML, "MFR_NAMES"); } catch {}

function buildQuery(p) {
  if (p.q && String(p.q).trim()) return String(p.q).trim();
  const brand = MFR_NAMES[p.mfr] || p.mfr || "";
  return [brand, p.lineup, p.name, p.code].filter(Boolean).join(" ").trim();
}

// 再マッチ用：複数のクエリ候補（コード密着で取りこぼすケースを救済）
function buildQueries(p) {
  const brand = MFR_NAMES[p.mfr] || p.mfr || "";
  const qs = [];
  if (p.q && String(p.q).trim()) qs.push(String(p.q).trim());
  qs.push([brand, p.lineup, p.name].filter(Boolean).join(" ").trim());       // ブランド+ラインナップ+色（コード無し）
  qs.push([brand, p.name, p.code].filter(Boolean).join(" ").trim());         // ブランド+色+コード
  qs.push([p.lineup, p.name].filter(Boolean).join(" ").trim());              // ラインナップ+色
  qs.push([brand, p.name].filter(Boolean).join(" ").trim());                 // ブランド+色のみ
  return [...new Set(qs.filter((q) => q && q.length >= 2))];
}

function scoreCandidate(p, item) {
  const title = normalize(item?.itemInfo?.title?.displayValue);
  if (!title) return { score: 0, reasons: [] };
  const code = normalize(p.code);
  const name = normalize(p.name);
  const brand = normalize(MFR_NAMES[p.mfr] || p.mfr);
  const lineup = normalize(p.lineup);
  let s = 0; const reasons = [];
  if (code && code.length >= 2 && title.includes(code)) { s += 4; reasons.push("code"); }
  if (name && name.length >= 2 && title.includes(name)) { s += 3; reasons.push("name"); }
  if (brand && title.includes(brand.slice(0, 4))) { s += 2; reasons.push("brand"); }
  if (lineup && lineup.length >= 2 && title.includes(lineup)) { s += 1; reasons.push("lineup"); }
  // 塗料タイプ不一致は強く減点（例: アクリル指定なのにエナメルがヒット）
  const pType = paintType(`${p.lineup} ${p.name}`);
  const cType = paintType(item?.itemInfo?.title?.displayValue);
  if (pType && cType && pType !== cType) { s -= 5; reasons.push("type-mismatch"); }
  // スプレー缶は塗料大全(ビン/エアブラシ)対象外 → 強く減点（ビン版を優先）
  const rawTitle = item?.itemInfo?.title?.displayValue || "";
  if (/スプレー/.test(rawTitle)) { s -= 6; reasons.push("spray-x"); }
  // 溶剤・うすめ液・洗浄液・工具は塗料ではない → 強く減点
  if (/溶剤|うすめ液|薄め液|シンナー|クリーナー|ブラシマスター|リムーバー|マスキング|筆|ツール|溶液/.test(rawTitle)) { s -= 6; reasons.push("nonpaint-x"); }
  return { score: s, reasons };
}

async function getToken() {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString() });
  if (!r.ok) throw new Error("token " + r.status);
  return (await r.json()).access_token;
}

async function search(tok, keywords) {
  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({
      keywords, itemCount: 3,
      resources: ["itemInfo.title", "images.primary.medium", "images.primary.large", "offersV2.listings.price"],
      partnerTag: TAG, partnerType: "Associates",
    }),
  });
  if (!r.ok) throw new Error("search " + r.status + " " + (await r.text()).slice(0, 120));
  const data = await r.json();
  return data.searchResult?.items || [];
}

async function upsertAsinMap(rows) {
  const CHUNK = 100; let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/asin_map`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) { log(`  upsert失敗 chunk${i}: ${r.status} ${(await r.text()).slice(0,120)}`); continue; }
    total += chunk.length;
  }
  return total;
}

(async () => {
  fs.writeFileSync(LOG, "");
  const paints = extractArray(PAINT_HTML, "PAINTS").map((p) => ({ p, ns: "paint" }));
  const topcoats = extractArray(TOPCOAT_HTML, "ITEMS").map((p) => ({ p, ns: "topcoat" }));
  let items = [...paints, ...topcoats];
  log(`塗料 ${paints.length} / トップコート ${topcoats.length} / 合計 ${items.length} 件`);
  log(`MFR_NAMES: ${Object.keys(MFR_NAMES).length} ブランド`);

  if (SAMPLE && SAMPLE > 0 && SAMPLE < items.length) {
    const step = items.length / SAMPLE;
    const picked = [];
    for (let i = 0; i < SAMPLE; i++) picked.push(items[Math.floor(i * step)]);
    items = picked;
    log(`サンプル ${items.length} 件（等間隔抽出）`);
  } else if (!ALL && !SAMPLE && !RETRY) {
    log("フラグ未指定。--sample N / --all / --retry-unmatched のいずれかを指定してください。");
    return;
  }

  // 再マッチ：asin_map に既に登録済みの key はスキップ（未マッチのみ対象）
  if (RETRY) {
    const er = await fetch(`${SUPABASE_URL}/rest/v1/asin_map?select=key`, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE } });
    const existing = er.ok ? await er.json() : [];
    const have = new Set(existing.map((r) => r.key));
    const before = items.length;
    items = items.filter(({ p, ns }) => !have.has(makeKey(p, ns)));
    log(`未マッチのみ対象: ${items.length} / ${before}（既存 ${have.size} 件はスキップ）`);
  }

  const tok = await getToken();
  log("token OK\n");

  const results = [];
  let high = 0, med = 0, low = 0, none = 0;
  let searchCount = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < items.length; i++) {
    const { p, ns } = items[i];
    const queries = RETRY ? buildQueries(p) : [buildQuery(p)];
    let row = { key: makeKey(p, ns), ns, query: queries[0], mfr: p.mfr, code: p.code, name: p.name };
    let best = null, usedQ = queries[0];
    try {
      for (const q of queries) {
        if (searchCount > 0) await sleep(1200); // 全search呼び出し間 1 TPS安全マージン
        searchCount++;
        let cands;
        try { cands = await search(tok, q); } catch (e) { continue; }
        for (const c of cands) {
          const sc = scoreCandidate(p, c);
          if (!best || sc.score > best.sc.score) { best = { c, sc }; usedQ = q; }
        }
        if (best && best.sc.score >= 7) break; // 高信頼が出たら打ち切り
      }
      row.query = usedQ;
      if (best && best.sc.score >= 4) {
        const c = best.c;
        const conf = best.sc.score >= 7 ? "high" : "medium";
        if (conf === "high") high++; else med++;
        row.asin = c.asin;
        row.title = c.itemInfo?.title?.displayValue || "";
        row.image_url = c.images?.primary?.large?.url || c.images?.primary?.medium?.url || null;
        const amt = c.offersV2?.listings?.[0]?.price?.money?.amount;
        row.price = (amt != null) ? amt : null;
        row.confidence = conf;
        row.score = best.sc.score;
        row.reasons = best.sc.reasons.join("+");
      } else {
        low++; row.confidence = best ? "low" : "none"; row.score = best ? best.sc.score : 0;
        if (best) { row.candidateTitle = best.c.itemInfo?.title?.displayValue || ""; row.candidateAsin = best.c.asin; }
      }
    } catch (e) {
      none++; row.error = e.message.slice(0, 80);
    }
    results.push(row);
    if ((i + 1) % 20 === 0 || i === items.length - 1) log(`  進捗 ${i + 1}/${items.length} (high:${high} med:${med} low:${low} err:${none})`);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2), "utf8");
  log(`\n📊 結果: high ${high} / medium ${med} / low ${low} / error ${none}  → ${OUT_JSON}`);

  if (UPSERT) {
    const writable = results.filter((r) => (r.confidence === "high" || r.confidence === "medium") && r.asin);
    log(`\n💾 asin_map へ upsert: ${writable.length} 件 (high+medium)`);
    const rows = writable.map((r) => ({
      key: r.key, asin: r.asin, title: r.title || null, image_url: r.image_url || null,
      price: r.price != null ? r.price : null, confidence: r.confidence, source: "paapi",
      notes: `q="${r.query}" score=${r.score} ${r.reasons || ""}`,
    }));
    const n = await upsertAsinMap(rows);
    log(`  ✅ ${n}/${rows.length} 件 upsert 完了`);
  } else {
    log("\n[DRY] 書き込み無し。--upsert で asin_map に反映。");
  }
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
