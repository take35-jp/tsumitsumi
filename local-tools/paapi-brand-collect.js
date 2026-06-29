#!/usr/bin/env node
/**
 * おすすめツールブランド特集用の商品収集スクリプト。
 * Amazon Creators API (searchItems) で各ブランドの商品を検索し、
 * ASIN・タイトル・画像・価格・アフィリンクを public/brand-tools.json に書き出す。
 * ページ（public/brand-tools.html）はこのJSONを fetch して描画する。
 *
 *   node local-tools/paapi-brand-collect.js            # 収集して public/brand-tools.json を更新
 *   node local-tools/paapi-brand-collect.js --dry      # 収集結果を表示するだけ（書き込み無し）
 *   node local-tools/paapi-brand-collect.js --max 80   # 1ブランドあたりの最大件数（既定60）
 *
 * 必要な local-tools/.env（paapi-paint-search.js と同じ）:
 *   AMAZON_PAAPI_ACCESS_KEY / AMAZON_PAAPI_SECRET_KEY / AMAZON_PARTNER_TAG
 *
 * ※ Creators API は概ね 1TPS 制限。検索間に 1.2 秒の間隔を入れている。
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = path.join(__dirname, ".env");
const env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
// ローカルは .env を優先、無ければ環境変数（GitHub Actions の Secrets）から取得＝CIでも動く。
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1] || process.env[k];
const CID = get("AMAZON_PAAPI_ACCESS_KEY");
const SEC = get("AMAZON_PAAPI_SECRET_KEY");
const TAG = get("AMAZON_PARTNER_TAG");

const TOKEN_URL = "https://api.amazon.co.jp/auth/o2/token";
const SEARCH_URL = "https://creatorsapi.amazon/catalog/v1/searchItems";
const MARKETPLACE = "www.amazon.co.jp";

const ARGV = process.argv.slice(2);
const DRY = ARGV.includes("--dry");
const MAX = ARGV.includes("--max") ? parseInt(ARGV[ARGV.indexOf("--max") + 1], 10) : 60;

const OUT_JSON = path.join(__dirname, "..", "public", "brand-tools.json");

// ブランド設定。queries＝検索語（広く拾うため複数）、match＝タイトルに含まれれば自社製品とみなす語。
const BRANDS = [
  {
    key: "plamo-kojo",
    name: "プラモ向上委員会",
    blurb: "切削・研磨・マスキングなど、痒い所に手が届くアイテムを展開する日本のモデリングツールブランド。コスパと使い勝手のバランスがよく、ステップアップにも定番。",
    match: ["プラモ向上委員会"],
    queries: [
      "プラモ向上委員会",
      "プラモ向上委員会 ヤスリ",
      "プラモ向上委員会 ニッパー",
      "プラモ向上委員会 スポンジ研磨",
      "プラモ向上委員会 マスキングテープ",
      "プラモ向上委員会 接着剤",
      "プラモ向上委員会 ピンセット",
      "プラモ向上委員会 デザインナイフ",
      "プラモ向上委員会 持ち手",
      "プラモ向上委員会 塗装",
      "プラモ向上委員会 トレイ",
      "プラモ向上委員会 コンテナ",
      "プラモ向上委員会 ランナー",
      "プラモ向上委員会 スジ彫り",
      "プラモ向上委員会 ニッパー サステナ",
      "plamokojo",
    ],
  },
  {
    key: "dspiae",
    name: "DSPIAE（ディスペイ）",
    blurb: "ニッパーや電動ヤスリ（ペンサンダー）など、精密モデリングツールで人気のブランド。電動工具のラインナップが豊富で、作業の効率と仕上がりを底上げしてくれる。",
    match: ["dspiae", "ディスペイ"],
    queries: [
      "DSPIAE",
      "DSPIAE ニッパー",
      "DSPIAE 電動ヤスリ",
      "DSPIAE ペンサンダー",
      "DSPIAE ピンセット",
      "DSPIAE デザインナイフ",
      "DSPIAE 筆",
      "DSPIAE カッティングマット",
      "DSPIAE スポンジヤスリ",
      "DSPIAE ハンドピース",
      "DSPIAE 接着剤",
      "DSPIAE 定規",
      "DSPIAE 超硬",
      "DSPIAE ブレード",
      "ディスペイ 工具",
      "ディスペイ ニッパー",
    ],
  },
  {
    key: "godhand",
    name: "ゴッドハンド",
    blurb: "「アルティメットニッパー」や「神ヤスリ」で知られる国産プレミアムツールブランド。切れ味・仕上がりにこだわるモデラーの定番。",
    match: ["ゴッドハンド", "godhand"],
    queries: [
      "ゴッドハンド",
      "ゴッドハンド ニッパー",
      "ゴッドハンド アルティメットニッパー",
      "ゴッドハンド 神ヤスリ",
      "ゴッドハンド 神ヤスリPRO",
      "ゴッドハンド スポンジヤスリ",
      "ゴッドハンド ピンセット",
      "ゴッドハンド パワーピンセット",
      "ゴッドハンド やすり",
      "ゴッドハンド ブレードワン",
      "ゴッドハンド スピンブレード",
      "ゴッドハンド デザインナイフ",
      "ゴッドハンド メンテナンス",
      "ゴッドハンド 接着剤",
      "ゴッドハンド 持ち手",
      "GodHand ニッパー",
      "GodHand 工具",
    ],
  },
  {
    key: "argofile",
    name: "アルゴファイル",
    blurb: "精密ヤスリや電動リューターを展開するツールメーカー。研磨・切削・仕上げ工程をワンランク引き上げてくれる。",
    match: ["アルゴファイル", "argofile"],
    queries: [
      "アルゴファイル",
      "アルゴファイル ヤスリ",
      "アルゴファイル 電動",
      "アルゴファイル リューター",
      "アルゴファイル ハンドピース",
      "アルゴファイル 研磨",
      "アルゴファイル ダイヤモンド",
      "アルゴファイル 軸付",
      "アルゴファイル ビット",
      "アルゴファイル サンディング",
      "アルゴファイル 替刃",
      "アルゴファイルジャパン",
      "ARGOFILE 工具",
    ],
  },
];

const HARD_BAD = /中古|訳あり|ジャンク|used|未使用に近い|難あり|互換品|非純正/i;
const norm = (s) => String(s || "").toLowerCase().replace(/[\s　・()（）「」【】［］\[\].,、。/\-]/g, "");

async function getToken() {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: CID, client_secret: SEC, scope: "creatorsapi::default" }).toString(),
  });
  if (!r.ok) throw new Error("token " + r.status + " " + (await r.text()).slice(0, 120));
  return (await r.json()).access_token;
}

async function search(tok, keywords) {
  const r = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", "x-marketplace": MARKETPLACE },
    body: JSON.stringify({
      keywords, itemCount: 10,
      resources: ["itemInfo.title", "images.primary.medium", "images.primary.large", "offersV2.listings.price"],
      partnerTag: TAG, partnerType: "Associates",
    }),
  });
  if (!r.ok) throw new Error("search " + r.status + " " + (await r.text()).slice(0, 160));
  const data = await r.json();
  return data.searchResult?.items || [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 既存 brand-tools.json の手動並び順（adminで保存した順）を読み込む。
// { brandKey: [asin, asin, ...] } を返す。収集後にこの順を保持する（手動順が自動更新で消えないように）。
function loadExistingOrder() {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
    const map = {};
    for (const b of (prev.brands || [])) map[b.key] = (b.items || []).map((i) => i.asin);
    return map;
  } catch (e) { return {}; }
}
// admin で削除した商品の ASIN（再収集で復活させない）
function loadExcluded() {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
    return new Set(Array.isArray(prev.excludedAsins) ? prev.excludedAsins : []);
  } catch (e) { return new Set(); }
}

(async () => {
  if (!CID || !SEC || !TAG) {
    console.error("local-tools/.env に AMAZON_PAAPI_ACCESS_KEY / AMAZON_PAAPI_SECRET_KEY / AMAZON_PARTNER_TAG を設定してください。");
    process.exit(1);
  }
  const tok = await getToken();
  console.log("token OK");

  let first = true;
  const prevOrder = loadExistingOrder(); // admin保存の手動順を保持するため
  const excluded = loadExcluded(); // adminで削除した商品は再追加しない
  const out = { generatedAt: new Date().toISOString(), partnerTag: TAG, excludedAsins: [...excluded], brands: [] };

  for (const b of BRANDS) {
    const seen = new Map(); // asin -> item
    for (const q of b.queries) {
      if (!first) await sleep(1200); // 1TPS 安全マージン
      first = false;
      let items = [];
      try { items = await search(tok, q); } catch (e) { console.log(`  検索失敗 "${q}": ${e.message}`); continue; }
      for (const c of items) {
        if (!c.asin || seen.has(c.asin) || excluded.has(c.asin)) continue;
        const title = c.itemInfo?.title?.displayValue || "";
        const nt = norm(title);
        if (HARD_BAD.test(title)) continue;
        // タイトルにブランド名（いずれか）が含まれるものだけ採用＝特集の純度を担保
        if (!b.match.some((m) => nt.includes(norm(m)))) continue;
        const amt = c.offersV2?.listings?.[0]?.price?.money?.amount;
        seen.set(c.asin, {
          asin: c.asin,
          title,
          image: c.images?.primary?.large?.url || c.images?.primary?.medium?.url || null,
          price: (amt != null) ? amt : null,
          url: `https://www.amazon.co.jp/dp/${encodeURIComponent(c.asin)}/?tag=${encodeURIComponent(TAG)}`,
        });
      }
      console.log(`  ${b.name} / "${q}" → 累計 ${seen.size} 件`);
    }
    // 画像のある商品を優先し、価格ありを次点で前に（初回や新規商品の既定順）
    let items = [...seen.values()]
      .sort((x, y) => (!!y.image - !!x.image) || (!!y.price - !!x.price))
      .slice(0, b.max || MAX); // ブランド個別の上限 b.max があれば優先
    // adminで保存済みの手動順があれば、その順を保持（既存ASINは保存順、新規は末尾）。
    const order = prevOrder[b.key];
    if (order && order.length) {
      const rank = new Map(order.map((asin, i) => [asin, i]));
      items.sort((x, y) => (rank.has(x.asin) ? rank.get(x.asin) : 1e9) - (rank.has(y.asin) ? rank.get(y.asin) : 1e9));
    }
    out.brands.push({ key: b.key, name: b.name, blurb: b.blurb, items });
    console.log(`✅ ${b.name}: ${items.length} 件（画像あり ${items.filter((i) => i.image).length}）`);
  }

  if (DRY) {
    console.log("\n[DRY] 書き込み無し。--dry を外すと public/brand-tools.json を更新します。");
    return;
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n💾 ${OUT_JSON} を更新しました（${out.brands.reduce((a, b) => a + b.items.length, 0)} 件）。`);
  console.log("   git add public/brand-tools.json && commit & push で本番反映されます。");
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
