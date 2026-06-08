#!/usr/bin/env node
/**
 * gears_catalog Supabase に撮影機材セクションを upsert する。
 * 既存セクションは保持し、photo-smartphone / photo-camera だけ置き換える。
 * ASIN は本ファイル内で固定マッピング、image は null（PA-API取得後にbulk update想定）。
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
  // "photo-cam-booth-3": ユーザー手動指定待ち
  "photo-cam-tripod-1": "B013SJZVIU",
  "photo-cam-tripod-2": "B0053CEPQU",
  "photo-cam-tripod-3": "B0BBTDPP2W",
  "photo-cam-acc-1":    "B0CHNY19K3",
  "photo-cam-acc-2":    "B0CJ53HQ5Z",
};

// gears.json を読み、ASIN マッピングを適用
const gearsJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "gears.json"), "utf8"));
const photoSections = gearsJson.sections.filter(s => s.id === "photo-smartphone" || s.id === "photo-camera");

let total = 0;
let mapped = 0;
photoSections.forEach(sec => {
  sec.products.forEach(p => {
    total++;
    if (ASIN_MAP[p.id]) {
      p.asin = ASIN_MAP[p.id];
      p.price = null;
      mapped++;
    }
  });
});

console.log(`撮影セクション: ${photoSections.length}個、商品 ${total}件中 ${mapped}件にASIN紐付け完了`);

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
