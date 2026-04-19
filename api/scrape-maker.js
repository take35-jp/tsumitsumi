// api/scrape-maker.js
// タミヤ・ハセガワ・コトブキヤ・アオシマ・フジミの公式サイトから
// 希望小売価格を取得してSupabaseのretail_priceに格納するAPI
//
// 使い方:
//   GET /api/scrape-maker?token=tsumitsumi-cron-2026&maker=タミヤ&limit=50
//   maker: タミヤ / ハセガワ / コトブキヤ / アオシマ / フジミ

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
const TOKEN = "tsumitsumi-cron-2026";

// メーカー別のサイトマップURL
const MAKER_CONFIG = {
  タミヤ: {
    sitemapUrl: 'https://www.tamiya.com/japan/sitemap.xml',
    itemPattern: /tamiya\.com\/japan\/products\/\d+/,
    priceSelector: async (html) => {
      // タミヤ: <p class="price">¥X,XXX（税込）</p>
      const m = html.match(/class="price[^"]*"[^>]*>([^<]*¥[\d,]+[^<]*)/);
      if (m) {
        const p = m[1].match(/[\d,]+/)?.[0]?.replace(/,/g,'');
        return p ? parseInt(p) : null;
      }
      // 別パターン: 税込 X,XXX円
      const m2 = html.match(/税込[^\d]*([\d,]+)円/);
      if (m2) return parseInt(m2[1].replace(/,/g,''));
      return null;
    },
    nameSelector: (html) => {
      const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return m?.[1]?.trim();
    }
  },
  ハセガワ: {
    sitemapUrl: 'https://www.hasegawa-model.co.jp/sitemap.xml',
    itemPattern: /hasegawa-model\.co\.jp\/products\//,
    priceSelector: async (html) => {
      const m = html.match(/[\d,]+円\s*[\(（]税込[\)）]/);
      if (m) return parseInt(m[0].match(/[\d,]+/)?.[0]?.replace(/,/g,''));
      return null;
    },
    nameSelector: (html) => {
      const m = html.match(/<h1[^>]*class="[^"]*product[^"]*"[^>]*>([^<]+)<\/h1>/i)
        || html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return m?.[1]?.trim();
    }
  },
  コトブキヤ: {
    sitemapUrl: 'https://www.kotobukiya.co.jp/sitemap_index.xml',
    itemPattern: /kotobukiya\.co\.jp\/product\//,
    priceSelector: async (html) => {
      const m = html.match(/[\d,]+円\s*[\(（]税込[\)）]/)
        || html.match(/税込\s*[\d,]+円/);
      if (m) return parseInt((m[0].match(/[\d,]+/) || [])[0]?.replace(/,/g,''));
      return null;
    },
    nameSelector: (html) => {
      const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return m?.[1]?.trim();
    }
  },
  アオシマ: {
    sitemapUrl: 'https://www.aoshima-bk.co.jp/sitemap.xml',
    itemPattern: /aoshima-bk\.co\.jp\/product\//,
    priceSelector: async (html) => {
      const m = html.match(/[\d,]+円\s*[\(（]税込[\)）]/);
      if (m) return parseInt((m[0].match(/[\d,]+/) || [])[0]?.replace(/,/g,''));
      return null;
    },
    nameSelector: (html) => {
      const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return m?.[1]?.trim();
    }
  },
  フジミ: {
    sitemapUrl: 'https://www.fujimimodel.co.jp/sitemap.xml',
    itemPattern: /fujimimodel\.co\.jp\/products\//,
    priceSelector: async (html) => {
      const m = html.match(/[\d,]+円\s*[\(（]税込[\)） ]/);
      if (m) return parseInt((m[0].match(/[\d,]+/) || [])[0]?.replace(/,/g,''));
      return null;
    },
    nameSelector: (html) => {
      const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return m?.[1]?.trim();
    }
  }
};

async function getSitemapUrls(sitemapUrl, itemPattern) {
  try {
    const r = await fetch(sitemapUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TsumiTsumi/1.0)' } });
    if (!r.ok) return [];
    const xml = await r.text();
    
    // サイトマップインデックスの場合は再帰
    const subSitemaps = [...xml.matchAll(/<loc>([^<]+sitemap[^<]+\.xml[^<]*)<\/loc>/gi)].map(m=>m[1]);
    if (subSitemaps.length > 0) {
      const allUrls = [];
      for (const sub of subSitemaps.slice(0, 10)) {
        const subR = await fetch(sub, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (subR.ok) {
          const subXml = await subR.text();
          const urls = [...subXml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m=>m[1]);
          allUrls.push(...urls.filter(u => itemPattern.test(u)));
        }
      }
      return allUrls;
    }
    
    // 通常のサイトマップ
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m=>m[1]);
    return urls.filter(u => itemPattern.test(u));
  } catch(e) {
    return [];
  }
}

async function savePrice(name, price, makerName) {
  if (!name || !price) return false;
  const clean = name.replace(/\s+/g,' ').trim();
  const bIdx = clean.search(/[(（\[【]/);
  const core = bIdx > 4 ? clean.slice(0, bIdx).trim() : clean.slice(0, 25);
  const patterns = [core.slice(0,22), core.slice(0,16), core.slice(0,11)].filter(k=>k.length>=4);
  
  for (const k of patterns) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?name=ilike.*${encodeURIComponent(k)}*&retail_price=is.null&maker=eq.${encodeURIComponent(makerName)}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    if (rows?.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ retail_price: price })
      });
      return true;
    }
  }
  return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.query.token !== TOKEN) return res.status(401).json({ error: 'unauthorized' });
  
  const makerName = req.query.maker || 'タミヤ';
  const limit = Math.min(parseInt(req.query.limit || '50'), 100);
  const offset = parseInt(req.query.offset || '0');
  const config = MAKER_CONFIG[makerName];
  
  if (!config) return res.status(400).json({ error: `unknown maker: ${makerName}`, available: Object.keys(MAKER_CONFIG) });

  try {
    // サイトマップからURL取得
    const allUrls = await getSitemapUrls(config.sitemapUrl, config.itemPattern);
    const urls = allUrls.slice(offset, offset + limit);
    
    if (!urls.length) return res.status(200).json({ message: '処理完了またはURLなし', total: allUrls.length, offset });

    let updated = 0, notFound = 0, noPrice = 0;
    const results = [];

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TsumiTsumi/1.0)' } });
        if (!r.ok) { noPrice++; continue; }
        const html = await r.text();
        const price = await config.priceSelector(html);
        const name = config.nameSelector(html);
        
        if (price && price > 0 && price % 10 === 0) { // 端数なしチェック
          const saved = await savePrice(name, price, makerName);
          if (saved) { updated++; results.push({ name: name?.slice(0,30), price }); }
          else notFound++;
        } else {
          noPrice++;
        }
      } catch(e) { noPrice++; }
      await sleep(200);
    }

    return res.status(200).json({
      maker: makerName,
      updated, notFound, noPrice,
      total: allUrls.length,
      offset, processed: urls.length,
      nextOffset: offset + limit < allUrls.length ? offset + limit : null,
      results: results.slice(0, 10)
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
