#!/usr/bin/env node
/* ============================================================
 * asin-crossref.js
 * 既存 gears_catalog (Supabase) と paint/topcoat大全 (HTMLローカル)
 * を照合して、ASIN を自動マッピングする。
 *
 * 【安全性】
 *   - ネットアクセスは Supabase READ のみ（自分のDB読み取り）
 *   - Amazon・楽天・Yahoo 等への接触なし
 *   - --upsert を付けないと書き込みもしない（dry-run）
 *
 * 【使い方】
 *   1. local-tools/.env に SUPABASE_URL, SUPABASE_ANON_KEY を設定
 *   2. node local-tools/asin-crossref.js              # dry-run（マッチ件数のみ表示）
 *   3. node local-tools/asin-crossref.js --json       # JSON 出力
 *   4. node local-tools/asin-crossref.js --upsert     # asin_map に書き込み
 *      ※ --upsert は SUPABASE_SERVICE_ROLE_KEY が必要
 * ============================================================ */

const fs = require('fs');
const path = require('path');

// .env 読み込み（簡易）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oxtfwmcdtngvicrcjyue.supabase.co';
const ANON_KEY    = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON_KEY) {
  console.error('ERROR: SUPABASE_ANON_KEY が local-tools/.env にありません');
  process.exit(1);
}

// ---------- パス ----------
const REPO_ROOT = path.resolve(__dirname, '..');
const PAINT_HTML   = path.join(REPO_ROOT, 'public/paint/index.html');
const TOPCOAT_HTML = path.join(REPO_ROOT, 'public/topcoat/index.html');

// ---------- ユーティリティ ----------
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s　\-/・()（）「」【】［］\[\]]/g, '');
}

// 安定ID生成（loader.js 側でも同じロジックを使う想定）
function makeKey(p, ns) {
  const str = `${p.mfr || ''}|${p.lineup || ''}|${p.code || ''}|${p.name || ''}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return `${ns}-${p.mfr || 'x'}-${Math.abs(hash).toString(36)}`;
}

// HTML からデータ配列(`const NAME = [...]`)を抽出
function extractDataArray(htmlPath, arrayName) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const re = new RegExp(`const ${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];`);
  const m = html.match(re);
  if (!m) throw new Error(`配列 ${arrayName} を ${htmlPath} で見つけられませんでした`);
  // eval は信頼できる自分のソースのみ対象。JSオブジェクト・配列リテラル前提。
  return eval(`[${m[1]}]`); // eslint-disable-line no-eval
}

// ---------- Supabase REST ----------
async function fetchGearsCatalog() {
  const url = `${SUPABASE_URL}/rest/v1/gears_catalog?id=eq.main&select=data`;
  const r = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`gears_catalog fetch failed: ${r.status}`);
  const rows = await r.json();
  if (!rows[0] || !rows[0].data) return [];
  const products = (rows[0].data.sections || []).flatMap(s => s.products || []);
  return products;
}

async function upsertAsinMap(rows) {
  if (!SERVICE_KEY) {
    console.error('ERROR: --upsert には SUPABASE_SERVICE_ROLE_KEY が必要です');
    process.exit(1);
  }
  // 100件ずつ分割
  const CHUNK = 100;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/asin_map`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      console.error(`Upsert failed (chunk ${i}-${i + chunk.length}): ${r.status} ${await r.text()}`);
      continue;
    }
    total += chunk.length;
  }
  return total;
}

// ---------- マッチングロジック ----------
function findMatch(product, gearsWithAsin) {
  const pName   = normalize(product.name);
  const pCode   = normalize(product.code);
  const pMfr    = normalize(product.mfr);
  const pLineup = normalize(product.lineup);

  let best = null;

  for (const g of gearsWithAsin) {
    const gName = normalize(g.name);

    let score = 0;
    let reasons = [];

    // メーカー名チェック（弱マッチでも判別に使う）
    const mfrTokens = {
      gsi: ['gsi', 'クレオス', 'mr.', 'mrカラー', 'mr.カラー'],
      gaia: ['ガイア', 'ガイアノーツ', 'gaia'],
      tamiya: ['タミヤ', 'tamiya'],
      finishers: ['finisher', 'フィニッシャー'],
    };
    const tokens = mfrTokens[product.mfr] || [];
    const mfrHit = tokens.some(t => gName.includes(normalize(t)));
    if (mfrHit) { score += 2; reasons.push('mfr'); }

    // コードヒット（商品コード一致は強シグナル）
    if (pCode && pCode.length >= 2 && gName.includes(pCode)) {
      score += 5; reasons.push('code');
    }

    // 商品名 prefix マッチ
    if (pName.length >= 4) {
      const head = pName.slice(0, Math.min(10, pName.length));
      if (gName.includes(head)) { score += 4; reasons.push('name-head'); }
      // 全名一致
      if (gName.includes(pName)) { score += 2; reasons.push('name-full'); }
    }

    // ラインナップキーワード
    const lineupKeys = ['サーフェイサー', 'クリア', 'プレミアム', 'GX', 'メタル', 'カラー'];
    for (const k of lineupKeys) {
      if (pLineup.includes(normalize(k)) && gName.includes(normalize(k))) { score += 1; }
    }

    if (score >= 6 && (!best || score > best.score)) {
      best = { gears: g, score, reasons };
    }
  }

  if (!best) return null;
  return {
    gears: best.gears,
    confidence: best.score >= 9 ? 'high' : 'medium',
    reason: best.reasons.join('+'),
    score: best.score,
  };
}

// ---------- main ----------
async function main() {
  const flagJson   = process.argv.includes('--json');
  const flagUpsert = process.argv.includes('--upsert');

  console.log('▶ paint大全 を読み込み中...');
  const paints = extractDataArray(PAINT_HTML, 'PAINTS');
  console.log(`  ${paints.length} 件`);

  console.log('▶ トップコート大全 を読み込み中...');
  const topcoats = extractDataArray(TOPCOAT_HTML, 'ITEMS');
  console.log(`  ${topcoats.length} 件`);

  console.log('▶ Supabase gears_catalog を取得中...');
  const gears = await fetchGearsCatalog();
  const withAsin = gears.filter(g => g.asin);
  console.log(`  ${gears.length} 件 / うち ASIN登録済 ${withAsin.length} 件`);

  console.log('\n▶ マッチング処理中...');
  const matches = [];
  const items = [
    ...paints.map(p => ({ p, ns: 'paint' })),
    ...topcoats.map(p => ({ p, ns: 'topcoat' })),
  ];

  for (const { p, ns } of items) {
    const m = findMatch(p, withAsin);
    if (m) {
      matches.push({
        key:         makeKey(p, ns),
        asin:        m.gears.asin,
        title:       m.gears.name,
        image_url:   m.gears.image || null,
        confidence:  m.confidence,
        source:      'gears_crossref',
        notes:       `${p.mfr}/${p.lineup}/${p.code} ${p.name} ⇆ ${m.gears.name} [${m.reason} score=${m.score}]`,
      });
    }
  }

  const high = matches.filter(m => m.confidence === 'high').length;
  const med  = matches.filter(m => m.confidence === 'medium').length;
  console.log(`\n▼ マッチ結果`);
  console.log(`  HIGH (高信頼): ${high} 件`);
  console.log(`  MEDIUM       : ${med} 件`);
  console.log(`  合計マッチ   : ${matches.length} 件 / 候補 ${items.length} 件`);

  if (flagJson) {
    const outPath = path.join(__dirname, 'asin-matches.json');
    fs.writeFileSync(outPath, JSON.stringify(matches, null, 2), 'utf8');
    console.log(`\n→ JSON出力: ${outPath}`);
  }

  if (flagUpsert) {
    console.log('\n▶ asin_map に書き込み中...');
    const n = await upsertAsinMap(matches);
    console.log(`  ${n} / ${matches.length} 件 upsert 完了`);
  } else {
    console.log('\n💡 --json でJSON出力 / --upsert でSupabase asin_mapに書き込み');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
