// api/clean-master.js
// Supabaseのproductsテーブルを整備する
// GET /api/clean-master?dry=1&batch=100&offset=0
// dry=1 → 実際には更新せず確認のみ
// action=delete-nonplamo → プラモデル以外を削除

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

// ---------- プラモデル判定 ----------
// falseならDB削除対象
function isPlamodel(name) {
  const n = name || "";
  // 明らかにプラモでないもの
  if (/\bCD\b|DVD|Blu-ray|ブルーレイ|VHS/.test(n)) return false;
  if (/フィギュア(?!ライズ)|ぬいぐるみ|タオル|Tシャツ|グッズ/.test(n)) return false;
  if (/食玩|ガチャ|ガシャ|カプセル/.test(n)) return false;
  if (/攻略本|小説|漫画|コミック/.test(n)) return false;
  if (/デカール(?!.*プラモ)/.test(n) && !/プラモデル/.test(n)) return false;
  // 明らかにプラモのキーワードがあれば通す
  if (/プラモデル|プラモ|ガンプラ|1\/\d+|HG|MG|RG|PG|SD|EG|HGUC|MGSD/.test(n)) return true;
  if (/フィギュアライズ|Figure-rise|30MM|30MS|30MF|30MP/.test(n)) return true;
  if (/ゾイド|ZOIDS|ミニ四駆|コトブキヤ|タミヤ|ハセガワ|アオシマ|フジミ/.test(n)) return true;
  if (/フレームアームズ|ヘキサギア|メガミデバイス|マシーネンクリーガー/.test(n)) return true;
  if (/ウルトラマン.*プラ|仮面ライダー.*プラ|ポケプラ/.test(n)) return true;
  // グレー: 何も引っかからなければ除外しない（安全側）
  return true;
}

// ---------- ノイズ除去 ----------
function removeNoise(name) {
  let n = name || "";
  // ショップ固有タグ
  n = n.replace(/^H-[\dA-Z]{13,}/i, "").trim();
  n = n.replace(/【[^】]*】/g, "");
  n = n.replace(/『[^』]*』/g, "");
  n = n.replace(/\[[^\]]*再?販[^\]]*\]/g, "");
  n = n.replace(/〈[^〉]*〉/g, "");
  n = n.replace(/（[^）]*中古[^）]*）/g, "");
  n = n.replace(/『中古[^』]*』/g, "").trim();
  // ショップ名・送料・在庫等
  const noise = [
    /BANDAI SPIRITS/gi, /バンダイスピリッツ/g, /バンダイ スピリッツ/g,
    /BSP\(\d+\)/g, /ガンプラ$/g,
    /送料無料/g, /即納/g, /在庫あり/g, /新品/g, /未開封/g,
    /再販/g, /再生産/g, /メール便可/g, /代引き不可/g,
    /プレミアムバンダイ限定/g, /プレバン限定/g, /イベント限定/g,
    /返品種別[A-Z]/g,
    /組み立て式/g, /プラスチックモデルキット/g,
  ];
  for (const w of noise) n = n.replace(w, "");
  // 型番っぽいもの除去（行頭の数字-数字）
  n = n.replace(/^\d{4,}-\d+\s+/, "");
  // 連続スペース整理
  n = n.replace(/\s{2,}/g, " ").trim();
  // 末尾の記号
  n = n.replace(/[　\s\/・]+$/, "").trim();
  return n;
}

// ---------- グレード・スケール抽出 ----------
function extractGradeAndScale(name) {
  let grade = "";
  let scale = "";

  // グレード
  if (/\bMGSD\b/i.test(name))      grade = "MGSD";
  else if (/\bMGEX\b/i.test(name)) grade = "MGEX";
  else if (/\bPG\b/i.test(name))   grade = "PG";
  else if (/\bRG\b/i.test(name))   grade = "RG";
  else if (/\bHGUC\b/i.test(name)) grade = "HGUC";
  else if (/\bHGCE\b/i.test(name)) grade = "HGCE";
  else if (/\bHGBD\b/i.test(name)) grade = "HGBD";
  else if (/\bHGAC\b/i.test(name)) grade = "HGAC";
  else if (/\bHGGT\b/i.test(name)) grade = "HGGT";
  else if (/\bHG\b/i.test(name))   grade = "HG";
  else if (/\bEG\b/i.test(name))   grade = "EG";
  else if (/\bMG\b/i.test(name))   grade = "MG";
  else if (/\bRE\/100\b/i.test(name)) grade = "RE/100";
  else if (/\bSD\b/i.test(name))   grade = "SD";
  else if (/\bBB戦士\b/i.test(name)) grade = "BB戦士";

  // スケール
  const scaleMatch = name.match(/1\/(144|100|72|60|48|35|32|24|12)\b/);
  if (scaleMatch) scale = `1/${scaleMatch[1]}`;

  return { grade, scale };
}

// ---------- シリーズ推定 ----------
function guessSeries(name) {
  const n = name || "";
  if (/30MM|30 Minutes Missions/i.test(n))         return "30 Minutes Missions";
  if (/30MS|30 Minutes Sisters/i.test(n))           return "30 Minutes Sisters";
  if (/30MF|30 Minutes Fantasy/i.test(n))           return "30 Minutes Fantasy";
  if (/30MP|30 Minutes Preference/i.test(n))        return "30 Minutes Preference";
  if (/Figure-rise|フィギュアライズ/i.test(n))        return "Figure-rise Standard";
  if (/ポケモン|ポケットモンスター|ポケプラ/i.test(n)) return "ポケプラ";
  if (/ゾイドワイルド/i.test(n))                    return "ゾイドワイルド";
  if (/ゾイド|ZOIDS/i.test(n))                      return "ゾイド";
  if (/ウルトラマン/i.test(n))                       return "ウルトラマン（バンダイ）";
  if (/仮面ライダー/i.test(n))                       return "仮面ライダー（バンダイ）";
  if (/エヴァ|エヴァンゲリオン|EVA/i.test(n))        return "新世紀エヴァンゲリオン";
  if (/マクロス/i.test(n))                           return "マクロス（バンダイ）";
  if (/スターウォーズ|STAR WARS/i.test(n))          return "スターウォーズ（バンダイ）";
  if (/ミニ四駆/i.test(n))                           return "ミニ四駆";
  if (/フレームアームズガール|FA:G/i.test(n))        return "フレームアームズ・ガール";
  if (/フレームアームズ|Frame Arms/i.test(n))        return "フレームアームズ";
  if (/ヘキサギア|Hexa Gear/i.test(n))              return "ヘキサギア";
  if (/メガミデバイス/i.test(n))                     return "メガミデバイス";
  if (/アーマードコア|ARMORED CORE/i.test(n))       return "アーマードコア（コトブキヤ）";
  if (/創彩少女庭園/i.test(n))                       return "創彩少女庭園";
  if (/マシーネンクリーガー|Ma\.K\./i.test(n))       return "マシーネンクリーガー";
  if (/MODEROID/i.test(n))                           return "MODEROID";
  if (/タミヤ.*戦車|戦車.*タミヤ|1\/35.*戦車|戦車.*1\/35/i.test(n)) return "タミヤ 戦車・AFV";
  if (/タミヤ.*艦|艦.*タミヤ|1\/700.*艦/i.test(n))  return "タミヤ 艦船";
  if (/タミヤ.*飛行|飛行.*タミヤ/i.test(n))         return "タミヤ 飛行機";
  if (/タミヤ.*バイク|バイク.*タミヤ/i.test(n))      return "タミヤ バイク";
  if (/タミヤ.*カー|カー.*タミヤ/i.test(n))          return "タミヤ 自動車";
  if (/タミヤ|TAMIYA/i.test(n))                      return "タミヤ";
  if (/ハセガワ.*飛行|飛行.*ハセガワ/i.test(n))      return "ハセガワ 飛行機";
  if (/ハセガワ.*艦|艦.*ハセガワ/i.test(n))          return "ハセガワ 艦船";
  if (/ハセガワ|HASEGAWA/i.test(n))                  return "ハセガワ";
  if (/アオシマ.*艦|艦.*アオシマ/i.test(n))          return "アオシマ 艦船";
  if (/アオシマ/i.test(n))                            return "アオシマ";
  if (/フジミ.*艦|艦.*フジミ/i.test(n))              return "フジミ 艦船";
  if (/フジミ/i.test(n))                              return "フジミ";
  if (/ピットロード/i.test(n))                        return "ピットロード";
  if (/ガンダム|Gundam|ガンプラ/i.test(n))            return "ガンプラ";
  return "ガンプラ"; // バンダイデフォルト
}

// ---------- 商品名フォーマット ----------
// ルール: グレード 1/スケール 商品名コア  ※グレードなしならスケール 商品名
function formatName(rawName) {
  const cleaned = removeNoise(rawName);
  const { grade, scale } = extractGradeAndScale(cleaned);

  // コア名：グレード・スケール表記を除いた部分
  let core = cleaned;
  // グレード除去
  core = core.replace(/\bMGSD\b|\bMGEX\b|\bPG\b|\bRG\b|\bHGUC\b|\bHGCE\b|\bHGBD\b|\bHGAC\b|\bHGGT\b|\bHG\b|\bEG\b|\bMG\b|\bRE\/100\b|\bSD\b|\bBB戦士\b/gi, "");
  // スケール除去
  core = core.replace(/1\/(144|100|72|60|48|35|32|24|12)\b/g, "");
  // 型番除去（[数字]）
  core = core.replace(/\[\d+\]/g, "");
  // 連番 No.xx 除去
  core = core.replace(/No\.\d+\s*/g, "");
  // 末尾ゴミ除去
  core = core.replace(/\s{2,}/g, " ").replace(/^[\s\-・\/]+|[\s\-・\/]+$/g, "").trim();

  // 組み立て
  const parts = [];
  if (grade) parts.push(grade);
  if (scale) parts.push(scale);
  if (core) parts.push(core);

  return parts.join(" ").replace(/\s{2,}/g, " ").trim() || cleaned;
}

// ---------- メインハンドラ ----------
export default async function handler(req, res) {
  const dry    = req.query.dry === "1";
  const batch  = parseInt(req.query.batch || "200", 10);
  const offset = parseInt(req.query.offset || "0", 10);
  const action = req.query.action || "clean"; // clean | delete-nonplamo

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // バッチ取得
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,series,scale&limit=${batch}&offset=${offset}&order=id.asc`,
      { headers }
    );
    const products = await fetchRes.json();
    if (!Array.isArray(products)) throw new Error(JSON.stringify(products));

    if (action === "delete-nonplamo") {
      // プラモデル以外を削除
      const toDelete = products.filter(p => !isPlamodel(p.name));
      if (dry) {
        return res.status(200).json({
          offset, batch, total: products.length,
          willDelete: toDelete.length,
          samples: toDelete.slice(0, 10).map(p => ({ id: p.id, name: p.name })),
        });
      }
      let deleted = 0;
      for (const p of toDelete) {
        await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${p.id}`, {
          method: "DELETE", headers,
        });
        deleted++;
      }
      return res.status(200).json({ offset, batch, deleted, remaining: products.length - deleted });
    }

    // clean: 商品名・series・scale を整備
    const updates = [];
    for (const p of products) {
      const newName   = formatName(p.name);
      const newSeries = guessSeries(p.name);
      const { grade, scale } = extractGradeAndScale(p.name);
      const newScale  = p.scale || scale || "";

      // 変化があるもののみ更新対象
      const changed = newName !== p.name || newSeries !== p.series || newScale !== p.scale;
      if (changed) {
        updates.push({
          id: p.id,
          oldName: p.name,
          newName,
          oldSeries: p.series,
          newSeries,
          oldScale: p.scale,
          newScale,
        });
      }
    }

    if (dry) {
      return res.status(200).json({
        offset, batch, total: products.length,
        willUpdate: updates.length,
        samples: updates.slice(0, 10),
      });
    }

    // 実際に更新
    let updated = 0;
    for (const u of updates) {
      await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${u.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: u.newName, series: u.newSeries, scale: u.newScale }),
      });
      updated++;
    }

    return res.status(200).json({
      offset, batch, total: products.length,
      updated,
      hasMore: products.length === batch,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
