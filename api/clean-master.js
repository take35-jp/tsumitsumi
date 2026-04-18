// api/clean-master.js
// Supabaseのproductsテーブルを整備する
// GET /api/clean-master?dry=1&batch=200&offset=0

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

// ---------- プラモデル判定 ----------
function isPlamodel(name) {
  const n = name || "";
  if (/\bCD\b|ブルーレイ|DVD|Blu-ray/.test(n)) return false;
  if (/攻略本|小説|漫画|コミック|同人/.test(n)) return false;
  if (/ぬいぐるみ|タオル|Tシャツ|キーホルダー|バッジ|缶バッジ|マグカップ|ポーチ/.test(n)) return false;
  if (/食玩|ガチャ|ガシャ|カプセル|フィギュア(?!ライズ)/.test(n)) return false;
  return true;
}

// ---------- ノイズ除去 ----------
function removeNoise(name) {
  let n = name || "";

  // 先頭のショップ型番コード（H-4573... 等）
  n = n.replace(/^H-[\dA-Z]{8,}\s*/i, "");

  // 括弧系ノイズ
  n = n.replace(/【[^】]*】/g, "");
  n = n.replace(/『中古[^』]*』/g, "");
  n = n.replace(/『[^』]*在庫[^』]*』/g, "");
  n = n.replace(/《[^》]*》/g, "");
  // 「」括弧を外して中身を残す（閉じていない場合も含む）
  n = n.replace(/「([^」]*)」/g, "$1");
  n = n.replace(/「[^」]*$/g, "");
  n = n.replace(/^[^「]*」/g, "");
  // HTMLエンティティ変換
  n = n.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  n = n.replace(/\[[^\]]*在庫[^\]]*\]/g, "");
  n = n.replace(/\[[^\]]*発売済[^\]]*\]/g, "");
  n = n.replace(/\[[^\]]*BANDAI[^\]]*\]/gi, "");
  n = n.replace(/（[^\)]*中古[^\)]*）/g, "");

  // {PTM}等のノイズ
  n = n.replace(/{[A-Z]+}/g, "");
  // 作品名の『』括弧除去
  n = n.replace(/『([^』]*)』/g, "$1");
  // 残ったバンダイ
  n = n.replace(/バンダイ/g, "");

  // 末尾の管理コード類（ZP... や数字コード）
  n = n.replace(/\s*（[A-Z]{2}\d{6,}）/g, "");
  n = n.replace(/\s*\([A-Z]{2}\d{6,}\)/g, "");

  // メーカー・ブランド名ノイズ
  n = n.replace(/BANDAI SPIRITS/gi, "");
  n = n.replace(/バンダイスピリッツ/g, "");
  n = n.replace(/バンダイ\s*スピリッツ/g, "");
  n = n.replace(/スピリッツ/g, "");
  n = n.replace(/BSP\(\d+\)/g, "");
  n = n.replace(/\bBANDAI\b/gi, "");
  n = n.replace(/バンダイ/g, "");

  // 商品状態・流通ノイズ
  n = n.replace(/送料無料/g, "");
  n = n.replace(/即納/g, "");
  n = n.replace(/在庫あり/g, "");
  n = n.replace(/新品[・\s]?未開封/g, "");
  n = n.replace(/新品/g, "");
  n = n.replace(/未開封/g, "");
  n = n.replace(/再販/g, "");
  n = n.replace(/再生産/g, "");
  n = n.replace(/メール便可/g, "");
  n = n.replace(/代引き?不可/g, "");
  n = n.replace(/プレミアムバンダイ限定/g, "");
  n = n.replace(/プレバン限定/g, "");
  n = n.replace(/イベント限定/g, "");
  n = n.replace(/返品種別[A-Z]/g, "");
  n = n.replace(/限定品/g, "");

  // 「プラモデル」「ガンプラ」「プラモ」単体ノイズ（商品名の一部でないもの）
  n = n.replace(/\s+プラモデル\s*$/g, "");
  n = n.replace(/\s+ガンプラ\s*$/g, "");
  n = n.replace(/^ガンプラ\s+/g, "");
  n = n.replace(/\s+プラモ\s*$/g, "");
  n = n.replace(/組み立て式/g, "");
  n = n.replace(/プラスチックモデルキット/g, "");

  // 型番 [数字] や No.xx
  n = n.replace(/\s*\[\d+\]\s*/g, " ");
  n = n.replace(/\s*No\.\d+\s*/g, " ");

  // 数字のみのトークン（商品番号）
  n = n.replace(/\b\d{7,}\b/g, "");

  // 残った特殊文字クリーンアップ
  n = n.replace(/\[\s*\]/g, "");
  n = n.replace(/\(\s*\)/g, "");
  n = n.replace(/\s{2,}/g, " ").trim();
  n = n.replace(/^[\s\-・\/]+|[\s\-・\/]+$/g, "").trim();

  // 最終バンダイ念押し除去
  n = n.replace(/バンダイ/g, "").replace(/BANDAI/gi, "");
  n = n.replace(/\s{2,}/g, " ").trim();

  return n;
}

// ---------- グレード・スケール抽出 ----------
function extractGradeAndScale(name) {
  let grade = "";
  let scale = "";

  if (/\bMGSD\b/i.test(name))         grade = "MGSD";
  else if (/\bMGEX\b/i.test(name))    grade = "MGEX";
  else if (/\bPG\b/i.test(name))      grade = "PG";
  else if (/\bRG\b/i.test(name))      grade = "RG";
  else if (/\bHGUC\b/i.test(name))    grade = "HGUC";
  else if (/\bHGCE\b/i.test(name))    grade = "HGCE";
  else if (/\bHGBD\b/i.test(name))    grade = "HGBD";
  else if (/\bHGAC\b/i.test(name))    grade = "HGAC";
  else if (/\bHGGT\b/i.test(name))    grade = "HGGT";
  else if (/\bHGBO\b/i.test(name))    grade = "HGBO";
  else if (/\bHG\b/i.test(name))      grade = "HG";
  else if (/\bEG\b/i.test(name))      grade = "EG";
  else if (/\bRE\/100\b/i.test(name)) grade = "RE/100";
  else if (/\bMG\b/i.test(name))      grade = "MG";
  else if (/\bSD\b/i.test(name))      grade = "SD";
  else if (/BB戦士/i.test(name))      grade = "BB戦士";

  const scaleMatch = name.match(/1\/(144|100|72|60|48|35|32|24|12)\b/);
  if (scaleMatch) scale = `1/${scaleMatch[1]}`;

  return { grade, scale };
}

// ---------- シリーズ推定（元の名前で判定） ----------
function guessSeries(name) {
  const n = name || "";
  if (/30MM|30 Minutes Missions/i.test(n))          return "30 Minutes Missions";
  if (/30MS|30 Minutes Sisters/i.test(n))            return "30 Minutes Sisters";
  if (/30MF|30 Minutes Fantasy/i.test(n))            return "30 Minutes Fantasy";
  if (/30MP|30 Minutes Preference/i.test(n))         return "30 Minutes Preference";
  if (/Figure-rise|フィギュアライズ/i.test(n))         return "Figure-rise Standard";
  if (/ポケプラ|ポケモン|ポケットモンスター/i.test(n))   return "ポケプラ";
  if (/ゾイドワイルド/i.test(n))                       return "ゾイドワイルド";
  if (/ゾイド|ZOIDS/i.test(n))                         return "ゾイド";
  if (/ウルトラマン/i.test(n))                          return "ウルトラマン（バンダイ）";
  if (/仮面ライダー/i.test(n))                          return "仮面ライダー（バンダイ）";
  if (/エヴァ|エヴァンゲリオン|EVA/i.test(n))           return "新世紀エヴァンゲリオン";
  if (/マクロス/i.test(n))                              return "マクロス（バンダイ）";
  if (/スターウォーズ|STAR WARS/i.test(n))             return "スターウォーズ（バンダイ）";
  if (/ミニ四駆/i.test(n))                              return "ミニ四駆";
  if (/フレームアームズガール|FA:G/i.test(n))           return "フレームアームズ・ガール";
  if (/フレームアームズ|Frame Arms/i.test(n))           return "フレームアームズ";
  if (/ヘキサギア|Hexa Gear/i.test(n))                 return "ヘキサギア";
  if (/メガミデバイス/i.test(n))                        return "メガミデバイス";
  if (/アーマードコア|ARMORED CORE/i.test(n))          return "アーマードコア（コトブキヤ）";
  if (/創彩少女庭園/i.test(n))                          return "創彩少女庭園";
  if (/マシーネンクリーガー|Ma\.K\./i.test(n))          return "マシーネンクリーガー";
  if (/MODEROID/i.test(n))                              return "MODEROID";
  if (/タミヤ.*1\/35|1\/35.*戦車/i.test(n))            return "タミヤ 戦車・AFV";
  if (/タミヤ.*1\/700|1\/700.*タミヤ/i.test(n))         return "タミヤ 艦船";
  if (/タミヤ.*飛行|飛行機.*タミヤ/i.test(n))            return "タミヤ 飛行機";
  if (/タミヤ.*バイク|バイク.*タミヤ/i.test(n))           return "タミヤ バイク";
  if (/タミヤ.*カー|カー.*タミヤ/i.test(n))              return "タミヤ 自動車";
  if (/タミヤ|TAMIYA/i.test(n))                         return "タミヤ";
  if (/ハセガワ.*飛行|飛行機.*ハセガワ/i.test(n))         return "ハセガワ 飛行機";
  if (/ハセガワ.*艦/i.test(n))                           return "ハセガワ 艦船";
  if (/ハセガワ|HASEGAWA/i.test(n))                      return "ハセガワ";
  if (/アオシマ.*艦/i.test(n))                           return "アオシマ 艦船";
  if (/アオシマ/i.test(n))                               return "アオシマ";
  if (/フジミ.*艦/i.test(n))                             return "フジミ 艦船";
  if (/フジミ/i.test(n))                                  return "フジミ";
  if (/ピットロード/i.test(n))                            return "ピットロード";
  return "ガンプラ";
}

// ---------- 商品名フォーマット ----------
// ルール: グレード スケール コア名
function formatName(rawName) {
  const cleaned = removeNoise(rawName);
  const { grade, scale } = extractGradeAndScale(cleaned);

  // コア名：グレード・スケール・ノイズをさらに除去
  let core = cleaned;
  // グレード除去
  core = core.replace(/\bMGSD\b|\bMGEX\b|\bPG\b|\bRG\b|\bHGUC\b|\bHGCE\b|\bHGBD\b|\bHGAC\b|\bHGGT\b|\bHGBO\b|\bHG\b|\bEG\b|\bRE\/100\b|\bMG\b|\bSD\b|BB戦士/gi, "");
  // スケール除去
  core = core.replace(/1\/(144|100|72|60|48|35|32|24|12)\s*スケール/g, "");
  core = core.replace(/1\/(144|100|72|60|48|35|32|24|12)\b/g, "");
  // 残ったプラモ・ガンプラ単語
  core = core.replace(/\s*プラモデル\s*/g, " ");
  core = core.replace(/\s*ガンプラ\s*/g, " ");
  core = core.replace(/\[\s*\]/g, "");
  core = core.replace(/\(\s*\)/g, "");
  core = core.replace(/\s{2,}/g, " ").trim();
  core = core.replace(/^[\s\-・\/]+|[\s\-・\/]+$/g, "").trim();

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
  const action = req.query.action || "clean";

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,series,scale&limit=${batch}&offset=${offset}&order=id.asc`,
      { headers }
    );
    const products = await fetchRes.json();
    if (!Array.isArray(products)) throw new Error(JSON.stringify(products));

    // プラモ以外削除
    if (action === "delete-nonplamo") {
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
        await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${p.id}`, { method: "DELETE", headers });
        deleted++;
      }
      return res.status(200).json({ offset, batch, deleted, remaining: products.length - deleted });
    }

    // クリーニング
    const updates = [];
    for (const p of products) {
      const newName   = formatName(p.name);
      const newSeries = guessSeries(p.name);
      const { scale } = extractGradeAndScale(p.name);
      const newScale  = p.scale || scale || "";
      const changed = newName !== p.name || newSeries !== p.series || newScale !== p.scale;
      if (changed) {
        updates.push({ id: p.id, oldName: p.name, newName, oldSeries: p.series, newSeries, oldScale: p.scale, newScale });
      }
    }

    if (dry) {
      return res.status(200).json({
        offset, batch, total: products.length,
        willUpdate: updates.length,
        samples: updates.slice(0, 10),
      });
    }

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
      offset, batch, total: products.length, updated, hasMore: products.length === batch,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
