// 週1で各メーカーの新商品を自動取得し、cleanName・スケール/シリーズ補完・希望小売価格取得まで一気通貫で実行する。
//
// スケジュール（JST 3:00 / cron は UTC 18:00）
//   日: アオシマ・フジミ・その他スケール系
//   月: バンダイ（ガンプラ）
//   火: バンダイ（ガンプラ以外）
//   水: タミヤ
//   木: ハセガワ
//   金: コトブキヤ
//   土: グッドスマイル / マックスファクトリー
//
// 手動テスト:
//   GET /api/auto-seed?dry=1            … 今日の曜日に応じた候補をログ表示（DB書き込みなし）
//   GET /api/auto-seed?day=1&dry=1      … 月曜日扱いで dry run
//   GET /api/auto-seed?day=1            … 月曜日扱いで本実行

import { cleanName, guessScale, guessSeries, guessSeriesForMaker } from '../lib/product-helpers.js';

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const YAHOO_CLIENT_ID = process.env.YAHOO_CLIENT_ID;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

// 曜日（JST）→ メーカープラン
const SCHEDULE = {
  0: {
    label: '日: アオシマ・フジミ・その他',
    plans: [
      { maker: 'アオシマ', queries: ['アオシマ プラモデル'] },
      { maker: 'フジミ', queries: ['フジミ プラモデル'] },
      { maker: 'ピットロード', queries: ['ピットロード プラモデル'] },
      { maker: 'ファインモールド', queries: ['ファインモールド プラモデル'] },
      { maker: 'ウェーブ', queries: ['ウェーブ プラモデル'] },
    ],
  },
  1: {
    label: '月: バンダイ（ガンプラ）',
    plans: [
      { maker: 'バンダイ', queries: ['バンダイ HG ガンプラ', 'バンダイ MG', 'バンダイ RG', 'バンダイ PG', 'バンダイ EG'] },
    ],
  },
  2: {
    label: '火: バンダイ（ガンプラ以外）',
    plans: [
      {
        maker: 'バンダイ',
        queries: [
          'バンダイ 30MM',
          'バンダイ 30MS',
          'バンダイ Figure-rise',
          'バンダイ ポケプラ',
          'バンダイ ウルトラマン プラモデル',
          'バンダイ 仮面ライダー プラモデル',
          'バンダイ エヴァ プラモデル',
        ],
      },
    ],
  },
  3: {
    label: '水: タミヤ',
    plans: [
      { maker: 'タミヤ', queries: ['タミヤ プラモデル', 'タミヤ 1/35', 'タミヤ 1/24', 'タミヤ ミニ四駆'] },
    ],
  },
  4: {
    label: '木: ハセガワ',
    plans: [
      { maker: 'ハセガワ', queries: ['ハセガワ プラモデル', 'ハセガワ 1/72', 'ハセガワ 1/48', 'ハセガワ マクロス'] },
    ],
  },
  5: {
    label: '金: コトブキヤ',
    plans: [
      {
        maker: 'コトブキヤ',
        queries: [
          'コトブキヤ フレームアームズ',
          'コトブキヤ フレームアームズ・ガール',
          'コトブキヤ M.S.G',
          'コトブキヤ メガミデバイス',
          'コトブキヤ ヘキサギア',
          'コトブキヤ プラモデル',
        ],
      },
    ],
  },
  6: {
    label: '土: グッドスマイル / マックスファクトリー',
    plans: [
      { maker: 'グッドスマイルカンパニー', queries: ['MODEROID プラモデル', 'Good Smile プラモデル'] },
      { maker: 'マックスファクトリー', queries: ['PLAMAX プラモデル', 'マックスファクトリー プラモデル'] },
    ],
  },
};

function getJstDayOfWeek() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.getUTCDay(); // 0=日, 6=土
}

function fetchWithTimeout(url, opts, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...(opts || {}), signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchYahooItems(query, page = 1, results = 100) {
  const start = (page - 1) * results + 1;
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&query=${encodeURIComponent(query)}&results=${results}&start=${start}&output=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Yahoo API error: ${r.status}`);
  return r.json();
}

async function getExistingJans(jans) {
  if (jans.length === 0) return new Set();
  const list = jans.join(',');
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/products?jan=in.(${list})&select=jan`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const d = await r.json();
  return new Set((d || []).map((x) => x.jan));
}

async function upsertProducts(products) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/products`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(products),
  });
  return r.status;
}

// retail_price が NULL の商品を新しい順に取得（累積分の追い込み用）
async function fetchNullPriceItems(limit = 100) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=id,jan,name&retail_price=is.null&order=id.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}

async function patchProductPrice(jan, price) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ retail_price: price, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

// 希望小売価格取得（admin-search.js と同じロジックを内蔵してHTTPホップを避ける）
async function tryHobbySearch(jan) {
  const searchUrl = 'https://www.1999.co.jp/search?word=' + encodeURIComponent(jan);
  try {
    const r = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS });
    if (!r.ok) return null;
    const html = await r.text();
    const linkRe = /<a[^>]*class="c-card__(?:th|info)-links"[^>]*href="\/(\d{6,})"/g;
    const candidates = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      if (candidates.indexOf(m[1]) === -1) candidates.push(m[1]);
    }
    if (candidates.length === 0) return null;
    for (let i = 0; i < Math.min(candidates.length, 3); i++) {
      const id = candidates[i];
      try {
        const pr = await fetchWithTimeout('https://www.1999.co.jp/' + id, { headers: BROWSER_HEADERS });
        if (!pr.ok) continue;
        const ph = await pr.text();
        const gtin = ph.match(/"gtin13"\s*:\s*"(\d{13})"/);
        if (!gtin || gtin[1] !== jan) continue;
        const sticker = ph.match(/<div[^>]+id="masterBody_stickerPrice"[^>]*>\s*<del>\s*メーカー希望小売価格[：:]\s*&yen;([\d,]+)\s*\(税込\)\s*<\/del>/);
        if (sticker) {
          const p = parseInt(sticker[1].replace(/,/g, ''), 10);
          if (p > 0) return p;
        }
        const elem = ph.match(/c-product-detail__info-price-element[^>]*>¥<span>([\d,]+)<\/span>/);
        if (elem) {
          const p = parseInt(elem[1].replace(/,/g, ''), 10);
          if (p > 0) return p;
        }
      } catch (_) { /* try next */ }
      await new Promise((r2) => setTimeout(r2, 250));
    }
  } catch (_) {}
  return null;
}

async function tryYahooFixed(jan) {
  if (!YAHOO_CLIENT_ID) return null;
  const url = `https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch?appid=${YAHOO_CLIENT_ID}&jan_code=${encodeURIComponent(jan)}&results=10`;
  try {
    const r = await fetchWithTimeout(url, {});
    if (!r.ok) return null;
    const data = await r.json();
    const hits = (data && data.hits) || [];
    for (const h of hits) {
      const fp = h && h.priceLabel && h.priceLabel.fixedPrice;
      if (fp && fp > 0) return fp;
    }
  } catch (_) {}
  return null;
}

async function fetchRetailPrice(jan) {
  const p1 = await tryHobbySearch(jan);
  if (p1) return p1;
  const p2 = await tryYahooFixed(jan);
  if (p2) return p2;
  return null;
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const PRICE_BUDGET_MS = 50000; // 50秒で価格取得を打ち切る
  const PRICE_RATE_LIMIT_MS = 1000;

  const dayOverride = req.query.day !== undefined ? parseInt(req.query.day, 10) : null;
  const dry = req.query.dry === '1';
  const day = dayOverride !== null && dayOverride >= 0 && dayOverride <= 6
    ? dayOverride
    : getJstDayOfWeek();

  const sched = SCHEDULE[day];
  if (!sched) return res.status(500).json({ error: 'no schedule for day', day });

  const summary = {
    day,
    label: sched.label,
    dry,
    queriesRun: 0,
    candidates: 0,
    newJans: 0,
    inserted: 0,
    backlogFetched: 0,
    queueSize: 0,
    pricesAttempted: 0,
    pricesFound: 0,
    elapsedMs: 0,
    errors: [],
  };

  try {
    // 1. 各クエリで Yahoo 検索 → cleanName・guessSeries・guessScale を適用 → 候補プール
    const allCandidates = [];
    const seen = new Set();
    for (const plan of sched.plans) {
      for (const q of plan.queries) {
        try {
          const data = await fetchYahooItems(q, 1, 100);
          summary.queriesRun++;
          const items = data?.hits || [];
          for (const item of items) {
            const jan = item.janCode;
            if (!jan || jan.length < 8 || seen.has(jan)) continue;
            seen.add(jan);
            const rawName = item.name || '';
            const name = cleanName(rawName);
            if (!name) continue;
            const series = guessSeries(name) || guessSeriesForMaker(name, plan.maker);
            const scale = guessScale(name);
            const image_url = item.image?.medium || item.image?.small || '';
            allCandidates.push({ jan, name, image_url, series, scale, maker: plan.maker });
          }
        } catch (e) {
          summary.errors.push(`query "${q}": ${e.message}`);
        }
      }
    }
    summary.candidates = allCandidates.length;

    if (allCandidates.length === 0) {
      summary.elapsedMs = Date.now() - startTime;
      return res.status(200).json({ ...summary, message: '候補なし' });
    }

    // 2. 既存 JAN を除外
    const jans = allCandidates.map((c) => c.jan);
    const existing = await getExistingJans(jans);
    const newProducts = allCandidates.filter((c) => !existing.has(c.jan));
    summary.newJans = newProducts.length;

    if (dry) {
      summary.elapsedMs = Date.now() - startTime;
      return res.status(200).json({ ...summary, sample: newProducts.slice(0, 10) });
    }

    // 3. 一括 upsert（新規がある場合のみ）
    if (newProducts.length > 0) {
      const status = await upsertProducts(newProducts);
      summary.inserted = newProducts.length;
      summary.upsertStatus = status;
    }

    // 4. 価格取得キューを組む：今日の新規 + 累積分（DB の retail_price=NULL 新しい順100件）
    const newJanSet = new Set(newProducts.map((p) => p.jan));
    const backlog = await fetchNullPriceItems(100);
    const backlogFiltered = backlog.filter((x) => !newJanSet.has(x.jan));
    summary.backlogFetched = backlogFiltered.length;
    const priceQueue = [
      ...newProducts.map((p) => ({ jan: p.jan, name: p.name })),
      ...backlogFiltered,
    ];
    summary.queueSize = priceQueue.length;

    // 5. 希望小売価格を順次取得（タイムアウト管理）
    for (const item of priceQueue) {
      const elapsed = Date.now() - startTime;
      if (elapsed > PRICE_BUDGET_MS) {
        summary.errors.push(`price budget exceeded at ${summary.pricesAttempted}/${priceQueue.length}`);
        break;
      }
      summary.pricesAttempted++;
      try {
        const price = await fetchRetailPrice(item.jan);
        if (price) {
          await patchProductPrice(item.jan, price);
          summary.pricesFound++;
        }
      } catch (e) {
        summary.errors.push(`price ${item.jan}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, PRICE_RATE_LIMIT_MS));
    }

    summary.elapsedMs = Date.now() - startTime;
    return res.status(200).json(summary);
  } catch (e) {
    summary.elapsedMs = Date.now() - startTime;
    return res.status(500).json({ ...summary, error: e.message });
  }
}
