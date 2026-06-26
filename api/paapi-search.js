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

// 正規品らしさの採点（local-tools/paapi-paint-search.js の scoreCandidate 軽量版）。
// 検索上位に紛れる転売・非正規・中古・無関係品（溶剤/筆等）を下げ、正規の塗料/トップコートを先頭にする。
function normTitle(s) {
  return String(s || "").toLowerCase().replace(/[\s　・()（）「」【】［］\[\].,、。/\-]/g, "");
}
const HARD_BAD = /中古|訳あり|ジャンク|used|未使用に近い|難あり/i; // 完全除外対象
const SOFT_BAD = [
  { re: /溶剤|うすめ液|薄め液|シンナー|クリーナー|リムーバー|洗浄|スポイト|かくはん|撹拌|マスキング|ツール|工具|筆|刷毛/, p: 40 }, // 塗料本体でない関連品
  { re: /オリジナルロゴ|オリジナルパッケージ|オリジナル包装|詰替|詰め替え|小分け|分売|量り売り|まとめ売り/, p: 25 }, // 転売・非正規っぽい表記
];
function scoreCandidate(keywords, title) {
  const t = normTitle(title);
  if (!t) return -999;
  let s = 0;
  for (const tok of String(keywords).split(/[\s　]+/)) { // キーワードのトークン一致で加点（"C1"/"ホワイト"/"Mr.カラー" 等）
    const n = normTitle(tok);
    if (n.length >= 2 && t.includes(n)) s += 3;
  }
  if (HARD_BAD.test(title)) s -= 100;
  for (const b of SOFT_BAD) if (b.re.test(title)) s -= b.p;
  return s;
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
    const items = await searchItems(token, keywords, TAG, 6); // 多めに取得して採点・並べ替え
    let scored = items
      .filter((c) => c.asin)
      .map((c) => ({ c, score: scoreCandidate(keywords, c.itemInfo?.title?.displayValue) }));
    // 明確にNG（中古/転売/関連品）を除外。ただし全滅するなら元の並びを残す（検索リンクより直リンクを優先）。
    const kept = scored.filter((x) => x.score > -40);
    const use = (kept.length ? kept : scored).sort((a, b) => b.score - a.score);
    const results = use.map(({ c }) => ({
      asin: c.asin,
      title: c.itemInfo?.title?.displayValue || "",
      image: c.images?.primary?.large?.url || c.images?.primary?.medium?.url || null,
      price: c.offersV2?.listings?.[0]?.price?.money?.amount ?? null,
      url: `https://www.amazon.co.jp/dp/${encodeURIComponent(c.asin)}/?tag=${encodeURIComponent(TAG)}`,
    }));
    return res.status(200).json({ keywords, count: results.length, results });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
