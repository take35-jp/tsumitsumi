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
  // 各商品にセクションタイトルを添付（カテゴリ判定用）
  const products = [];
  for (const s of (rows[0].data.sections || [])) {
    for (const p of (s.products || [])) {
      products.push({ ...p, _section: s.title || '' });
    }
  }
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

// ---------- マッチングロジック (厳格版 v3) ----------
// 設計方針:
//   1. gears は「塗料系セクション」のみを対象 (工具/接着剤を除外)
//   2. メーカー一致を必須 (gsi の塗料が gaia の商品にマッチしない)
//   3. 商品固有キーワード (NAZCA・メカサフ・エヴォ等) の一致が必要
//   4. 色が両者に検出できる場合、一致しないマッチを拒否 (バリエーション識別)
//   5. specific token は重複排除して数える

// 色や粒度を表すだけのジェネリック語（これだけのマッチは無効）
const GENERIC_TOKENS = new Set([
  'ホワイト','ブラック','グレー','シルバー','ゴールド','レッド','ブルー','イエロー',
  'グリーン','ピンク','オレンジ','パープル','ブラウン','クリア','クリアー','クリヤー',
  'メタリック','光沢','半光沢','つや消し','フラット','セミグロス','透明','色',
  'ステンレス','アルミ','カッパー','ブロンズ','ダーク','ライト',
  'カラー','塗料','スプレー',
]).values ? new Set([
  'ホワイト','ブラック','グレー','シルバー','ゴールド','レッド','ブルー','イエロー',
  'グリーン','ピンク','オレンジ','パープル','ブラウン','クリア','クリアー','クリヤー',
  'メタリック','光沢','半光沢','つや消し','フラット','セミグロス','透明','色',
  'ステンレス','アルミ','カッパー','ブロンズ','ダーク','ライト',
  'カラー','塗料','スプレー',
]) : new Set();

// メーカートークン定義
const MFR_TOKENS = {
  gsi:       ['gsi', 'クレオス', 'mr.', 'mrカラー', 'mr.カラー', 'creos'],
  gaia:      ['ガイア', 'ガイアノーツ', 'gaia', 'gaianotes'],
  tamiya:    ['タミヤ', 'tamiya'],
  finishers: ['finisher', 'フィニッシャー'],
};

function isPaintSection(sectionTitle) {
  const t = normalize(sectionTitle);
  return t.includes('塗料') || t.includes('サーフェイサー') || t.includes('溶剤')
      || t.includes('クリア') || t.includes('うすめ液');
}

// 色判定: 商品名から「特定の色」を抽出。一般色のみ・別商品を区別するための識別子。
// 長い色名から先にチェック (オキサイドレッド を レッド に誤ヒットさせないため)
const COLOR_WORDS_JP = [
  'オキサイドレッド','シャンパンゴールド','スーパーヘヴィ','メタルブラック',
  'ピンクサフ','ピンク','ホワイト','ブラック','グレー','シルバー','ゴールド',
  'レッド','ブルー','イエロー','グリーン','オレンジ','パープル','ブラウン',
  'カッパー','ブロンズ','ヘヴィ','ライト','プレミアム',
];
function detectColor(text) {
  const norm = normalize(text);
  for (const c of COLOR_WORDS_JP) {
    if (norm.includes(normalize(c))) return c;
  }
  return null;
}

function isMfrMatch(productMfr, gearsName) {
  const tokens = MFR_TOKENS[productMfr] || [];
  const gn = normalize(gearsName);
  return tokens.some(t => gn.includes(normalize(t)));
}

// 「商品固有キーワード」を product から抽出
// (商品名から、ジェネリック語を除いた、識別力のあるトークン)
function extractSpecificTokens(productName) {
  // カタカナ・英数の塊で分割
  const chunks = productName
    .replace(/[（）()「」【】［\]/・,。 　]/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 2);
  return chunks.filter(c => !GENERIC_TOKENS.has(c));
}

function findMatch(product, gearsWithAsin) {
  const pName   = normalize(product.name);
  const pCode   = normalize(product.code);
  const pLineup = normalize(product.lineup);

  // 商品固有キーワード（重複排除）
  const specificRaw = extractSpecificTokens(product.name)
    .concat(extractSpecificTokens(product.lineup))
    .map(normalize)
    .filter(t => t.length >= 3);
  const specific = [...new Set(specificRaw)];

  // ソース側の色（バリエーション識別用）
  const sourceColor = detectColor(product.name + ' ' + product.lineup);

  let best = null;

  for (const g of gearsWithAsin) {
    // 1. セクションフィルター
    if (!isPaintSection(g._section)) continue;

    // 2. メーカー一致を必須
    if (!isMfrMatch(product.mfr, g.name)) continue;

    const gName = normalize(g.name);

    // 3. 色がソース両方に検出できる場合、一致を必須にする
    const targetColor = detectColor(g.name);
    if (sourceColor && targetColor && sourceColor !== targetColor) {
      continue; // 色違いは別バリエーション → マッチ拒否
    }

    let score = 0;
    let reasons = ['mfr'];

    // 4. コード一致（強い）
    if (pCode && pCode.length >= 2 && gName.includes(pCode)) {
      score += 5; reasons.push('code');
    }

    // 5. 商品固有キーワードの一致（必須・最低1つ）
    let specificHits = 0;
    for (const s of specific) {
      if (gName.includes(s)) specificHits++;
    }
    if (specificHits === 0) continue;
    score += specificHits * 3;
    reasons.push(`spec×${specificHits}`);

    // 6. 色一致ボーナス（両者で同じ色が検出できた場合）
    if (sourceColor && targetColor && sourceColor === targetColor) {
      score += 5;
      reasons.push('color:' + sourceColor);
    }

    // 7. 名前 prefix
    if (pName.length >= 6) {
      const head = pName.slice(0, 8);
      const headRaw = product.name.slice(0, 4);
      const isGenericHead = GENERIC_TOKENS.has(headRaw);
      if (gName.includes(head)) {
        score += isGenericHead ? 1 : 3;
        reasons.push(isGenericHead ? 'head(generic)' : 'head');
      }
    }

    // 8. ソース側のみ色が検出される(=色違いバリエーション)で、ターゲットに色なし → 不一致扱いで減点
    //    例: 「ピンクサフ」← gears「メカサフ ライト」(ライトはCOLOR_WORDS_JPに入れたので targetColor検出される)
    if (sourceColor && !targetColor) {
      score -= 2;
      reasons.push('no-target-color');
    }

    if (score >= 9 && (!best || score > best.score)) {
      best = { gears: g, score, reasons };
    }
  }

  if (!best) return null;
  return {
    gears: best.gears,
    confidence: best.score >= 13 ? 'high' : 'medium',
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
