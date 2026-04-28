// /api/rakuten-books.js (v4 - debug mode対応)
// ?debug=1 を付けると httpbin.org に echo して送信ヘッダーを確認できる
// それ以外は通常通り楽天APIを呼ぶ

const https = require('https');

const RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID;
const RAKUTEN_ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY;
const ENDPOINT = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601";
const REFERER = "https://tsumitsumi.vercel.app/";

const TRUSTED_SHOPS = [
  "book", "rakutenkobo", "amiami", "surugaya-a-too",
  "yodobashi", "joshin", "biccamera",
];

// 共通の https GET (Referer と User-Agent をカスタムヘッダーで送る)
function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'Referer': REFERER,
        'User-Agent': 'tsumitsumi/1.0 (+https://tsumitsumi.vercel.app)',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          body: data,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ======== デバッグモード ========
  // ?debug=1 で httpbin.org に echo して送信ヘッダーを確認
  if (req.query.debug === "1") {
    try {
      const debugRes = await httpsGet("https://httpbin.org/headers");
      const debugData = JSON.parse(debugRes.body);
      return res.status(200).json({
        mode: "debug",
        echo_status: debugRes.status,
        sent_headers: debugData.headers || {},
        referer_received: debugData.headers?.Referer || null,
        user_agent_received: debugData.headers?.['User-Agent'] || null,
      });
    } catch (e) {
      return res.status(500).json({ mode: "debug", error: e.message });
    }
  }

  // ======== 通常モード ========
  if (!RAKUTEN_APP_ID) {
    return res.status(500).json({ error: "RAKUTEN_APP_ID not configured" });
  }
  if (!RAKUTEN_ACCESS_KEY) {
    return res.status(500).json({ error: "RAKUTEN_ACCESS_KEY not configured" });
  }

  const { jan } = req.query;
  if (!jan || !/^\d{8,14}$/.test(jan)) {
    return res.status(400).json({ error: "Invalid jan parameter" });
  }

  try {
    const params = new URLSearchParams({
      applicationId: RAKUTEN_APP_ID,
      accessKey: RAKUTEN_ACCESS_KEY,
      keyword: jan,
      hits: "30",
      format: "json",
    });

    const httpsRes = await httpsGet(`${ENDPOINT}?${params.toString()}`);
    if (!httpsRes.ok) {
      return res.status(502).json({ error: "Rakuten API error", status: httpsRes.status, body: httpsRes.body });
    }
    const data = JSON.parse(httpsRes.body);

    const rawItems = (data.Items || []).map(w => w.Item || w).filter(Boolean);

    const exactMatches = rawItems.filter(it => {
      const haystack = `${it.itemName || ""}${it.itemCaption || ""}${it.itemCode || ""}`;
      return haystack.includes(jan);
    });

    const trustedItems = rawItems.filter(it => TRUSTED_SHOPS.includes(it.shopCode));

    let estimatedRetailPrice = null;
    const sourcePool = trustedItems.length > 0 ? trustedItems : rawItems;
    if (sourcePool.length > 0) {
      const prices = sourcePool
        .map(it => it.itemPrice)
        .filter(p => typeof p === "number" && p > 0)
        .sort((a, b) => a - b);
      if (prices.length > 0) {
        const mid = Math.floor(prices.length / 2);
        estimatedRetailPrice = prices.length % 2 === 0
          ? Math.round((prices[mid - 1] + prices[mid]) / 2)
          : prices[mid];
      }
    }

    return res.status(200).json({
      jan,
      estimatedRetailPrice,
      trustedItemsCount: trustedItems.length,
      totalItemsCount: rawItems.length,
      exactMatchCount: exactMatches.length,
      trustedItems: trustedItems.slice(0, 10),
      otherItems: rawItems
        .filter((it) => !TRUSTED_SHOPS.includes(it.shopCode))
        .slice(0, 5),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
