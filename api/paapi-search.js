// api/paapi-search.js
//
// Amazon Creators API（searchItems）で JAN または商品名から商品を検索し、
// ASIN・商品画像・価格・タイトルを返す。マイパレット（塗料在庫）の
// 「Amazon商品リンク（/dp/{ASIN}）」生成に使う。
//
// ※ local-tools/paapi-paint-search.js と同じ token + searchItems 方式を Vercel Function 化したもの。
//    大全→asin_map のオフライン投入とは別に、アプリ実行時に1件だけ解決する用途。
//
// 必要な環境変数（Vercel に設定する。値は local-tools/.env と同じ）:
//   AMAZON_PAAPI_ACCESS_KEY  ... Creators API の client_id
//   AMAZON_PAAPI_SECRET_KEY  ... Creators API の client_secret
//   AMAZON_PARTNER_TAG       ... アソシエイトタグ（例 tsumitsumi232-22）

export const config = { runtime: "nodejs" };

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const MARKETPLACE = "www.amazon.co.jp";

// トークンは約1時間有効。サーバレスインスタンスが再利用される間はモジュールスコープでキャッシュ。
let _token = null;
let _tokenExp = 0;

async function getToken(cid, sec) {
  const now = Date.now();
  if (_token && now < _tokenExp - 60000) return _token;
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cid,
      client_secret: sec,
      scope: "creatorsapi::default",
    }).toString(),
  });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json();
  _token = j.access_token;
  _tokenExp = now + (j.expires_in ? j.expires_in * 1000 : 3000000);
  return _token;
}

async function searchItems(token, keywords, tag, itemCount) {
  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({
      keywords,
      itemCount: itemCount || 3,
      resources: ["itemInfo.title", "images.primary.medium", "images.primary.large", "offersV2.listings.price"],
      partnerTag: tag,
      partnerType: "Associates",
    }),
  });
  if (!r.ok) throw new Error("search " + r.status + " " + (await r.text()).slice(0, 160));
  const data = await r.json();
  return data.searchResult?.items || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const CID = process.env.AMAZON_PAAPI_ACCESS_KEY;
  const SEC = process.env.AMAZON_PAAPI_SECRET_KEY;
  const TAG = process.env.AMAZON_PARTNER_TAG;
  if (!CID || !SEC || !TAG) {
    return res.status(500).json({ error: "PA-APIの認証情報が未設定です（Vercelに AMAZON_PAAPI_ACCESS_KEY / AMAZON_PAAPI_SECRET_KEY / AMAZON_PARTNER_TAG を設定してください）" });
  }

  // jan 優先（精度が高い）。無ければ q（商品名等のキーワード）。
  const jan = (req.query.jan || "").toString().replace(/[^0-9]/g, "");
  const q = (req.query.q || "").toString().trim();
  const keywords = jan || q;
  if (!keywords) return res.status(400).json({ error: "jan または q が必要です" });

  try {
    const token = await getToken(CID, SEC);
    const items = await searchItems(token, keywords, TAG, 3);
    const results = items.map((c) => ({
      asin: c.asin,
      title: c.itemInfo?.title?.displayValue || "",
      image: c.images?.primary?.large?.url || c.images?.primary?.medium?.url || null,
      price: c.offersV2?.listings?.[0]?.price?.money?.amount ?? null,
      url: `https://www.amazon.co.jp/dp/${encodeURIComponent(c.asin)}/?tag=${encodeURIComponent(TAG)}`,
    })).filter((x) => x.asin);
    return res.status(200).json({ keywords, count: results.length, results });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
