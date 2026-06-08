#!/usr/bin/env node
/**
 * gears_catalog Supabase に撮影機材セクションを upsert する。
 * 既存セクションは保持し、photo-smartphone / photo-camera だけ置き換える。
 * ASIN は本ファイル内で固定マッピング、IMAGE_MAP に Yahoo!ショッピング画像URLを保有
 * （PA-API取得後にAmazon純正画像へbulk update想定）。
 *
 * 使い方:
 *   node local-tools/upsert-photo-asins.js          # dry-run（差分のみ表示）
 *   node local-tools/upsert-photo-asins.js --apply  # 実書き込み
 */
const fs = require("fs");
const path = require("path");

const ENV_PATH = "C:/Users/taker/Documents/GitHub/tsumitsumi/local-tools/.env";
const env = fs.readFileSync(ENV_PATH, "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1];

const SUPABASE_URL = get("SUPABASE_URL");
const SERVICE_ROLE = get("SUPABASE_SERVICE_ROLE_KEY");
const APPLY = process.argv.includes("--apply");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が読み取れません");
  process.exit(1);
}

// === ASIN マッピング（手動確認済み） ===
const ASIN_MAP = {
  // 📱 スマホ
  "photo-sp-light-1":   "B077Z61TPN",
  "photo-sp-light-2":   "B078YL2TB3",
  "photo-sp-light-3":   "B0F59KNRDX",
  "photo-sp-booth-1":   "B07Z673F7K",
  "photo-sp-booth-2":   "B0DMZX2177",
  "photo-sp-booth-3":   "B07VKQYQQ9",  // PVC 60×130cm 黒1枚+白1枚 両面
  "photo-sp-tripod-1":  "B09KT6444P",
  "photo-sp-tripod-2":  "B0169SORBO",
  "photo-sp-tripod-3":  "B0BBQ9TW1R",
  "photo-sp-acc-1":     "B07CG58KGG",
  "photo-sp-acc-2":     "B072NB86HM",
  "photo-sp-acc-3":     "B00UWPRZWY",

  // 📷 一眼/ミラーレス
  "photo-cam-led-1":    "B08M5GPMMX",
  "photo-cam-led-2":    "B0BW5YSY6K",
  "photo-cam-led-3":    "B0C5XH9VLD",
  "photo-cam-strobe-1": "B09H6WW88W",
  "photo-cam-strobe-2":  "B07S62F223", // Canon
  "photo-cam-strobe-2s": "B07TCGB4CD", // Sony
  "photo-cam-strobe-2n": "B08462H8JK", // Nikon
  "photo-cam-strobe-2f": "B084K5B2T1", // Fujifilm
  "photo-cam-strobe-3": "B00OFLFD2U",
  "photo-cam-booth-1":  "B0BZ3WJ6J9",
  "photo-cam-booth-2":  "B00I4JO9TC",
  "photo-cam-booth-3":  "B0DN47VXQG",  // Good-three-directions フィギュア用 50×50ジオラマシート
  "photo-cam-tripod-1": "B013SJZVIU",
  "photo-cam-tripod-2": "B0053CEPQU",
  "photo-cam-tripod-3": "B0BBTDPP2W",
  "photo-cam-acc-1":    "B0CHNY19K3",
  "photo-cam-acc-2":    "B0CJ53HQ5Z",
};

// === 画像URL マッピング（Yahoo!ショッピングから取得・PA-API取得後に純正画像へ更新予定） ===
// NO_MATCH や信頼性低い商品は省略（loader.jsで📦プレースホルダー表示にフォールバック）
const Y = "https://item-shopping.c.yimg.jp/i/j/";
const IMAGE_MAP = {
  // 📱 スマホ
  "photo-sp-light-1":   Y + "mahy_b077z61tpn",                     // Neewer NL-660
  "photo-sp-light-2":   Y + "jnh_hy8114he70-2tbnhs1",              // GODOX LEDM150
  "photo-sp-light-3":   Y + "itempost_1-fullspec-2883",            // Neewer 18in リングライト
  "photo-sp-booth-1":   Y + "gdoshop_5002940615-001",              // PULUZ 30cm
  "photo-sp-booth-2":   Y + "microdirect_21kdsmvb0l-r-1",          // Neewer 40cm LP40
  "photo-sp-booth-3":   Y + "333step_s-b07vkqyqq9-20260117",       // PVC 黒+白 60×130cm
  "photo-sp-tripod-1":  Y + "okaidoku44_wss-56vu2wrlqtx3",         // SmallRig三脚
  "photo-sp-tripod-2":  Y + "vitec_8024221643640-56e-ol",          // Manfrotto PIXI
  "photo-sp-tripod-3":  Y + "inskk_800890",                        // スマホアームスタンド
  "photo-sp-acc-1":     Y + "inskk_800864",                        // スマホ マクロレンズ
  // "photo-sp-acc-2": 30cmレフ板の確実な画像なし（PA-API待ち）
  "photo-sp-acc-3":     Y + "hatuki_hbk0064253",                   // HAKUBA ブロアー

  // 📷 一眼
  "photo-cam-led-1":    Y + "trade-journey_b08ld3zhnb",            // Neewer 660 PRO 2灯
  // "photo-cam-led-2": GODOX SL60II-D 画像なし
  "photo-cam-led-3":    Y + "trade-journey_b085mzwmxt",            // GODOX VL150 II
  // "photo-cam-strobe-1": GODOX TT600 画像なし
  "photo-cam-strobe-2":  Y + "trade-journey_b07s1skfnr",           // X2T-C Canon
  "photo-cam-strobe-2s": Y + "syh_810",                            // X2T-S Sony
  "photo-cam-strobe-2n": Y + "y-sofmap_4961360038644",             // X2T-N Nikon
  "photo-cam-strobe-2f": Y + "trade-journey_b07sgbc28x",           // X2T-F Fuji
  "photo-cam-strobe-3": Y + "re-style5151_sr8-05-89",              // Neewer TT560
  "photo-cam-booth-1":  Y + "stk-shop_77033651",                   // 80cm撮影テント
  "photo-cam-booth-2":  Y + "bbest_bgc610",                        // 背景紙ロール(代用)
  // "photo-cam-booth-3": ジオラマシート 画像なし
  "photo-cam-tripod-1": Y + "vitec_8024221647761-56e-ol",          // Manfrotto MK290XTA3
  "photo-cam-tripod-2": Y + "kirelab-net_rmnsdcc34b1997",          // Velbon EX-440
  // "photo-cam-tripod-3": Hemmotopクランプ 画像信頼性低
  "photo-cam-acc-1":    Y + "bestclick_t0705",                     // レフ板60cm 5in1
  "photo-cam-acc-2":    Y + "zebrand-shop_2bjdy5k1yn",             // グレーカード
};

// gears.json を読み、ASIN マッピングを適用
const gearsJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "gears.json"), "utf8"));
const photoSections = gearsJson.sections.filter(s => s.id === "photo-smartphone" || s.id === "photo-camera");

let total = 0;
let mappedAsin = 0;
let mappedImg = 0;
photoSections.forEach(sec => {
  sec.products.forEach(p => {
    total++;
    if (ASIN_MAP[p.id]) {
      p.asin = ASIN_MAP[p.id];
      p.price = null;
      mappedAsin++;
    }
    if (IMAGE_MAP[p.id]) {
      p.image = IMAGE_MAP[p.id];
      mappedImg++;
    }
  });
});

console.log(`撮影セクション: ${photoSections.length}個、商品 ${total}件中`);
console.log(`  ASIN紐付け: ${mappedAsin}件 / 画像紐付け: ${mappedImg}件`);

// Supabaseから既存データ取得
(async () => {
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: "Bearer " + SERVICE_ROLE,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const getRes = await fetch(`${SUPABASE_URL}/rest/v1/gears_catalog?id=eq.main&select=data`, { headers });
  if (!getRes.ok) {
    console.error("Supabase GET 失敗:", getRes.status, await getRes.text());
    process.exit(1);
  }
  const rows = await getRes.json();
  let currentData;
  if (rows.length === 0 || !rows[0].data) {
    console.log("既存データなし。新規作成します。");
    currentData = {
      meta: { schemaVersion: 1, associateTag: "tsumitsumi232-22", lastUpdated: new Date().toISOString().slice(0, 10) },
      sections: [],
    };
  } else {
    currentData = rows[0].data;
    console.log(`既存セクション数: ${currentData.sections.length}件`);
  }

  // 既存の photo-* セクションを除去し、新版を追加
  const filtered = (currentData.sections || []).filter(s => s.id !== "photo-smartphone" && s.id !== "photo-camera");
  const newData = {
    ...currentData,
    meta: { ...currentData.meta, lastUpdated: new Date().toISOString().slice(0, 10) },
    sections: [...filtered, ...photoSections],
  };

  console.log(`新セクション総数: ${newData.sections.length}件`);
  console.log("追加するphoto商品サンプル:");
  photoSections[0].products.slice(0, 3).forEach(p => {
    console.log(`  ${p.id} → ASIN: ${p.asin || "(none)"}`);
  });

  if (!APPLY) {
    console.log("\n[DRY RUN] 書き込みはしません。--apply で実書き込み。");
    return;
  }

  // UPSERT (Prefer: resolution=merge-duplicates with ON CONFLICT id)
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/gears_catalog?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ id: "main", data: newData }]),
  });

  if (!upsertRes.ok) {
    console.error("UPSERT 失敗:", upsertRes.status, await upsertRes.text());
    process.exit(1);
  }
  const result = await upsertRes.json();
  console.log("✅ UPSERT 成功:", result[0]?.id);
})();
