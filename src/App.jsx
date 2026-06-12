import { useState, useRef, useEffect, useMemo } from "react";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

// ====== IndexedDB ストレージ（kits の overflow 受け皿）======
// localStorage は 5MB 上限なので、写真が増えると保存できなくなる。
// IDB は数百MB〜数GB扱えるので、移行の受け皿として利用する。
// ※ Phase 1 ではヘルパーを定義するだけで、まだ呼び出さない。
//    Phase 2 以降で読込→書込の順で組み込む。
async function kitsIdbLoad() {
  try {
    const v = await idbGet("tsumitsumi_kits");
    return Array.isArray(v) ? v : null;
  } catch (e) {
    // IDB 不在/破損/プライベートモード等：null を返して localStorage 経路に任せる
    return null;
  }
}
async function kitsIdbSave(kits) {
  try {
    await idbSet("tsumitsumi_kits", kits);
    return true;
  } catch (e) {
    // QuotaExceeded 等。呼び出し側で false を見たら何もしない（localStorage 側でカバー）
    return false;
  }
}

// ====== Phase 4.C.1.a: 写真の Blob 保存インフラ（追加のみ・まだ未使用）======
// 設計：kit.photoUrl は文字列のまま。"idb-blob:<id>" の sentinel を入れた場合は IDB に Blob 本体がある。
// 既存の base64 / http URL はそのままでも動く（KitImage が両対応）。
const IDB_PHOTO_PREFIX = "tsumitsumi_photo_";
const IDB_PHOTO_URL_PREFIX = "idb-blob:";
function isIdbBlobUrl(url) { return typeof url === "string" && url.startsWith(IDB_PHOTO_URL_PREFIX); }
function idbBlobUrlToId(url) { return isIdbBlobUrl(url) ? url.slice(IDB_PHOTO_URL_PREFIX.length) : null; }
function idToIdbBlobUrl(id) { return IDB_PHOTO_URL_PREFIX + id; }
function makePhotoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function kitsIdbPhotoSet(id, blob) {
  try { await idbSet(IDB_PHOTO_PREFIX + id, blob); return true; } catch { return false; }
}
async function kitsIdbPhotoGet(id) {
  try { const v = await idbGet(IDB_PHOTO_PREFIX + id); return v instanceof Blob ? v : null; } catch { return null; }
}
async function kitsIdbPhotoDelete(id) {
  try { await idbDel(IDB_PHOTO_PREFIX + id); } catch {}
}

// 完成写真の取得（後方互換）。新形式 completedPhotos[] があればそれ、
// 無ければ旧形式 completedPhotoUrl(単一) を1枚アルバムとして返す。最大6枚。
const MAX_COMPLETED_PHOTOS = 6;
function getCompletedPhotos(kit) {
  if (kit && Array.isArray(kit.completedPhotos) && kit.completedPhotos.length) {
    return kit.completedPhotos.filter(Boolean).slice(0, MAX_COMPLETED_PHOTOS);
  }
  if (kit && kit.completedPhotoUrl) return [kit.completedPhotoUrl];
  return [];
}

// 写真 src を解決するラッパー。"idb-blob:..." なら IDB から Blob を取り object URL 化。
// それ以外（http / data: / 空）はそのまま <img> に流す。
// src が idb-blob で IDB に Blob が無い場合（孤児化・データ消失）は、真っ白ではなく
// 📦 プレースホルダを表示してユーザーに「画像が無い」状態を明示する。
function KitImage({ src, style, alt, onError }) {
  const [resolved, setResolved] = useState(() => (src && !isIdbBlobUrl(src)) ? src : null);
  const [missing, setMissing] = useState(false); // idb-blob だが Blob が IDB に無い場合 true
  useEffect(() => {
    setMissing(false);
    if (!src) { setResolved(null); return; }
    if (!isIdbBlobUrl(src)) { setResolved(src); return; }
    let objectUrl = null;
    let cancelled = false;
    (async () => {
      const id = idbBlobUrlToId(src);
      const blob = await kitsIdbPhotoGet(id);
      if (cancelled) return;
      if (!blob) { setResolved(null); setMissing(true); return; }
      objectUrl = URL.createObjectURL(blob);
      setResolved(objectUrl);
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  if (!resolved) {
    // Blob が見つからなかった場合（IDBから消失等）はプレースホルダを表示
    if (missing) {
      return (
        <div style={{ ...style, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 22 }}>
          <span title="画像データが見つかりません（再アップロードしてください）">📦</span>
        </div>
      );
    }
    return null;
  }
  return <img src={resolved} style={style} alt={alt || ""} onError={onError} />;
}

const SERIES_OPTIONS = [
  // ── バンダイ ガンプラ ──
  "ガンプラ",
  "SMP",
  "R3",
  // ── バンダイ キャラクター ──
  "ポケプラ",
  "Figure-rise Standard", "Figure-rise Bust", "Figure-rise Mechanics",
  "ウルトラマン（バンダイ）", "仮面ライダー（バンダイ）",
  "スターウォーズ（バンダイ）", "マクロス（バンダイ）",
  // ── バンダイ 30min ──
  "30 Minutes Missions", "30 Minutes Sisters", "30 Minutes Fantasy", "30 Minutes Preference",
  // ── スパロボ ──
  "スパロボ",
    // ── バンダイ リアルロボット ──
  "機動警察パトレイバー", "聖戦士ダンバイン", "重戦機エルガイム",
  "機甲戦記ドラグナー", "装甲騎兵ボトムズ", "太陽の牙ダグラム",
  "戦闘メカザブングル", "蒼き流星SPTレイズナー", "銀河漂流バイファム",
  "機甲界ガリアン", "伝説巨神イデオン",
  "超獣機神ダンクーガ", "新世紀エヴァンゲリオン", "交響詩篇エウレカセブン",
  // ── コトブキヤ ──
  "フレームアームズ", "フレームアームズ・ガール", "ヘキサギア",
  "メガミデバイス", "アーマーガールズプロジェクト",
  "アーマードコア（コトブキヤ）", "バーチャロン（コトブキヤ）",
  "創彩少女庭園", "スタチュー（コトブキヤ）",
  // ── グッドスマイルカンパニー / ボークス ──
  "MODEROID", "PLAMATEA",
  "ドルフィードリーム",
  // ── タカラトミー ──
  "ゾイド", "トランスフォーマー", "ダイアクロン",
  // ── ウェーブ ──
  "マシーネンクリーガー", "ボトムズ（ウェーブ）", "マクロス（ウェーブ）",
  // ── FSS ──
  "FSS（ファイブスター物語）",
  // ── タミヤ ──
  "タミヤ 戦車・AFV", "タミヤ 艦船", "タミヤ 飛行機",
  "タミヤ 自動車", "タミヤ バイク", "タミヤ ミリタリーフィギュア",
  "ミニ四駆",
  // ── ハセガワ ──
  "ハセガワ 飛行機", "ハセガワ 艦船", "ハセガワ 自動車・バイク",
  "ハセガワ キャラクター", "マシーネンクリーガー（ハセガワ）",
  // ── フジミ ──
  "フジミ 艦船", "フジミ 自動車", "フジミ 飛行機",
  "フジミ 城", "フジミ キャラクター",
  // ── アオシマ ──
  "アオシマ 艦船", "アオシマ 自動車", "アオシマ バイク",
  "アオシマ キャラクター",
  // ── その他スケール系メーカー ──
  "ピットロード", "ファインモールド",
  "ドラゴン", "トランペッター", "タコム", "ブロンコ",
  "レベル（ドイツ）", "エアフィックス", "ズベズダ",
  // ── ジャンル別（メーカー混在） ──
  "戦車・AFV", "艦船", "飛行機", "自動車", "バイク",
  "城・建築", "SF・宇宙船", "恐竜・生物",
  // ── ガレージキット系 ──
  "ガレージキット", "レジンキット",
  // ── その他 ──
  "その他",
];
const SCALE_OPTIONS = ["1/1700", "1/550", "1/144", "1/100", "1/72", "1/60", "1/48", "1/35", "1/32", "1/24", "1/20", "1/12", "EG", "HG", "RG", "MG", "RE/100", "MGSD", "PG", "SD", "フルメカニクス",  "ノンスケール", "その他", "デカール"];

// 忍者AdMax 表示フラグ。AdSense 審査中は false にして、他広告ネットワークの広告枠が
// 審査の妨げにならないようにする。承認後に true に戻す。
const ADS_ENABLED = false;

// Amazonアソシエイト・トラッキングID（仮承認済み・2026/05/25）
// 180日以内に3件の売上を発生させないと本承認されないので、まずは流入を確保する。
const AMAZON_ASSOC_TAG = "tsumitsumi232-22";
// JAN（13桁）優先、なければ商品名で検索する Amazon アフィリエイト URL を組み立てる。
function makeAmazonAffUrl(kit) {
  const q = (kit && (kit.jan || kit.name)) || "";
  if (!q) return null;
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}&tag=${AMAZON_ASSOC_TAG}`;
}

const RANKS = [
  { min: 2000, label: "全てを積み、全てを手放した。", color: "#1f2937" },
  { min: 1800, label: "創世ノツミ神", color: "#fde047" },
  { min: 1600, label: "多次元宇宙のツミ神", color: "#c026d3" },
  { min: 1400, label: "小宇宙のツミ神", color: "#a855f7" },
  { min: 1200, label: "七大陸ノツミ神", color: "#059669" },
  { min: 1000, label: "天照大積ミ神", color: "#fbbf24" },
  { min: 900, label: "最早、積み神様", color: "#ec4899" },
  { min: 800, label: "神界の積み人", color: "#4338ca" },
  { min: 700, label: "天界の積み人", color: "#0ea5e9" },
  { min: 600, label: "地獄門の積み人", color: "#831843" },
  { min: 500, label: "地獄の一丁目の積み人", color: "#7c3aed" },
  { min: 300, label: "ルナティックツミニスト", color: "#dc2626" },
  { min: 200, label: "ヘルモードツミニスト", color: "#ea580c" },
  { min: 150, label: "ハードモードツミニスト", color: "#d97706" },
  { min: 100, label: "特級ツミニスト", color: "#ca8a04" },
  { min: 80,  label: "上級ツミニスト", color: "#16a34a" },
  { min: 50,  label: "中級ツミニスト", color: "#2563eb" },
  { min: 20,  label: "ビギナーツミニスト", color: "#6b7280" },
  { min: 0,   label: "ツミニスト見習い", color: "#9ca3af" },
];

function getRank(total) {
  return RANKS.find(r => total >= r.min) || RANKS[RANKS.length - 1];
}

function formatDate(str) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${y}/${m}/${d}`;
}

const CONDITION_OPTIONS = ["未開封", "素組状態", "欠品有り", "制作途中"];

const emptyForm = {
  name: "", series: "", scale: "", purchaseDate: "", price: "", retailPrice: "",
  count: 1, rating: 0, photo: null, photoUrl: "", completedPhotoUrl: "", completedPhotos: [], completed: false, memo: "", jan: "",
  condition: "", conditionNote: "", tags: [],
};
// 毎回新規オブジェクトを返す(配列・オブジェクトの参照共有を避ける)
const makeEmptyForm = () => ({
  name: "", series: "", scale: "", purchaseDate: "", price: "", retailPrice: "",
  count: 1, rating: 0, photo: null, photoUrl: "", completedPhotoUrl: "", completedPhotos: [], completed: false, memo: "", jan: "",
  condition: "", conditionNote: "", tags: [],
});

// 画像をBase64に圧縮変換（最大800px・JPEG品質0.7）
function compressImageToBase64(file, maxPx = 320, quality = 0.5) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.width, h = img.height;
      // 長辺を maxPx に収める
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      // 目標50KB以下になるまで品質を下げる
      let result = canvas.toDataURL("image/jpeg", quality);
      let q = quality;
      while (result.length > 68000 && q > 0.2) {
        q -= 0.05;
        result = canvas.toDataURL("image/jpeg", q);
      }
      resolve(result);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// 画像を Blob に圧縮変換（base64 版と同じロジック・サイズ約30%軽い）
function compressImageToBlob(file, maxPx = 320, quality = 0.5) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const toBlob = (q) => new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", q));
      let q = quality;
      let blob = await toBlob(q);
      // base64 で 68000 char 上限 ≒ 51000 bytes binary
      while (blob && blob.size > 51000 && q > 0.2) {
        q -= 0.05;
        blob = await toBlob(q);
      }
      resolve(blob || null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// 商品名から SERIES_OPTIONS のいずれかを推測（マッチしなければ ""）
function guessSeriesFromName(name) {
  if (!name) return "";
  // === コトブキヤ系（長いものから順に） ===
  if (/フレームアームズ・ガール|フレームアームズガール|FA:G/i.test(name)) return "フレームアームズ・ガール";
  if (/フレームアームズ|Frame Arms/i.test(name)) return "フレームアームズ";
  if (/ヘキサギア|Hexa Gear|HEXA GEAR/i.test(name)) return "ヘキサギア";
  if (/メガミデバイス|MEGAMI DEVICE/i.test(name)) return "メガミデバイス";
  if (/アーマーガールズ/i.test(name)) return "アーマーガールズプロジェクト";
  if (/アーマードコア|ARMORED CORE/i.test(name)) return "アーマードコア（コトブキヤ）";
  if (/バーチャロン/i.test(name)) return "バーチャロン（コトブキヤ）";
  if (/創彩少女庭園/i.test(name)) return "創彩少女庭園";
  // === グッスマ / Max Factory / ボークス ===
  if (/MODEROID/i.test(name)) return "MODEROID";
  if (/PLAMATEA/i.test(name)) return "PLAMATEA";
  if (/ドルフィードリーム/i.test(name)) return "ドルフィードリーム";
  // === バンダイ 30min ===
  if (/30MF|30 Minutes Fantasy/i.test(name)) return "30 Minutes Fantasy";
  if (/30MP|30 Minutes Preference/i.test(name)) return "30 Minutes Preference";
  if (/30MS|30 Minutes Sisters/i.test(name)) return "30 Minutes Sisters";
  if (/30MM|30 Minutes Missions/i.test(name)) return "30 Minutes Missions";
  // === バンダイ キャラクター ===
  if (/Figure-rise\s+Mechanics/i.test(name)) return "Figure-rise Mechanics";
  if (/Figure-rise\s+Bust/i.test(name)) return "Figure-rise Bust";
  if (/Figure-rise/i.test(name)) return "Figure-rise Standard";
  if (/ポケモン|ポケプラ|Pokemon/i.test(name)) return "ポケプラ";
  if (/ウルトラマン/i.test(name)) return "ウルトラマン（バンダイ）";
  if (/仮面ライダー/i.test(name)) return "仮面ライダー（バンダイ）";
  if (/スターウォーズ|STAR WARS/i.test(name)) return "スターウォーズ（バンダイ）";
  if (/マクロス|バルキリー|VF-/i.test(name)) return "マクロス（バンダイ）";
  // === バンダイ SMP / R3（短い略称なので境界で限定） ===
  if (/(^|[\s\-_／/])SMP([\s\-_／/]|$)|Shokugan Modeling/i.test(name)) return "SMP";
  if (/(^|[\s\-_／/])R3([\s\-_／/]|$)|Real Robot Revolution/i.test(name)) return "R3";
  // === タカラトミー ===
  if (/ゾイド|ZOIDS/i.test(name)) return "ゾイド";
  if (/トランスフォーマー|Transformers/i.test(name)) return "トランスフォーマー";
  if (/ダイアクロン/i.test(name)) return "ダイアクロン";
  // === マシーネン ===
  if (/マシーネンクリーガー|Ma\.K\.|Maschinen Krieger|S\.F\.3\.D/i.test(name)) return "マシーネンクリーガー";
  // === バンダイ リアルロボット ===
  if (/パトレイバー/i.test(name)) return "機動警察パトレイバー";
  if (/ダンバイン|オーラバトラー/i.test(name)) return "聖戦士ダンバイン";
  if (/エルガイム/i.test(name)) return "重戦機エルガイム";
  if (/ドラグナー/i.test(name)) return "機甲戦記ドラグナー";
  if (/ボトムズ|スコープドッグ|アーマードトルーパー/i.test(name)) return "装甲騎兵ボトムズ";
  if (/ダグラム/i.test(name)) return "太陽の牙ダグラム";
  if (/ザブングル/i.test(name)) return "戦闘メカザブングル";
  if (/レイズナー/i.test(name)) return "蒼き流星SPTレイズナー";
  if (/バイファム/i.test(name)) return "銀河漂流バイファム";
  if (/ガリアン/i.test(name)) return "機甲界ガリアン";
  if (/イデオン/i.test(name)) return "伝説巨神イデオン";
  if (/ダンクーガ/i.test(name)) return "超獣機神ダンクーガ";
  if (/エヴァンゲリオン|エヴァ|EVA/i.test(name)) return "新世紀エヴァンゲリオン";
  if (/エウレカセブン/i.test(name)) return "交響詩篇エウレカセブン";
  // === FSS / スパロボ ===
  if (/ファイブスター|F\.S\.S\.|FSS/i.test(name)) return "FSS（ファイブスター物語）";
  if (/スパロボ|スーパーロボット大戦/i.test(name)) return "スパロボ";
  // === タミヤ ミニ四駆 ===
  if (/ミニ四駆|ミニ4駆/i.test(name)) return "ミニ四駆";
  // === ガンプラ最終フォールバック（ガンダム系・グレード表記） ===
  if (/\bPG\b|\bMGSD\b|\bMGEX\b|\bMG\b|\bRG\b|\bHGUC\b|\bHGCE\b|\bHG\b|\bEG\b|\bSD\b|ガンダム|Gundam|RE\/100|フルメカニクス|FULL\s*MECHANICS/i.test(name)) return "ガンプラ";
  // === ジャンル別フォールバック（メーカー不明な場合） ===
  if (/戦車|AFV|装甲車/i.test(name)) return "戦車・AFV";
  if (/戦艦|駆逐艦|空母|護衛艦|巡洋艦|潜水艦|艦船/i.test(name)) return "艦船";
  if (/戦闘機|爆撃機|輸送機|航空機|ヘリ|飛行機/i.test(name)) return "飛行機";
  if (/オートバイ|バイク|モーターサイクル/i.test(name)) return "バイク";
  if (/恐竜|ティラノ|ステゴ|プテラノドン/i.test(name)) return "恐竜・生物";
  return "";
}
// 商品名から SCALE_OPTIONS のいずれかを推測（マッチしなければ ""）
function guessScaleFromName(name) {
  if (!name) return "";
  // グレード（長いものから・順序が重要）
  if (/\bMGSD\b/i.test(name)) return "MGSD";
  if (/\bMGEX\b/i.test(name)) return "MG"; // MGEX は MG にフォールバック（SCALE_OPTIONS に無いため）
  if (/RE\/100/i.test(name)) return "RE/100";
  if (/フルメカニクス|FULL\s*MECHANICS/i.test(name)) return "フルメカニクス";
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHGUC\b|\bHGCE\b|\bHGAC\b|\bHGFC\b/i.test(name)) return "HG";
  if (/\bHG\b/i.test(name)) return "HG";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/\bEG\b/i.test(name)) return "EG";
  if (/\bSD\b|BB戦士/i.test(name)) return "SD";
  // 数値スケール（\b で部分一致を防止）
  if (/1\/1700\b/.test(name)) return "1/1700";
  if (/1\/550\b/.test(name)) return "1/550";
  if (/1\/144\b/.test(name)) return "1/144";
  if (/1\/100\b/.test(name)) return "1/100";
  if (/1\/72\b/.test(name)) return "1/72";
  if (/1\/60\b/.test(name)) return "1/60";
  if (/1\/48\b/.test(name)) return "1/48";
  if (/1\/35\b/.test(name)) return "1/35";
  if (/1\/32\b/.test(name)) return "1/32";
  if (/1\/24\b/.test(name)) return "1/24";
  if (/1\/20\b/.test(name)) return "1/20";
  if (/1\/12\b/.test(name)) return "1/12";
  // デカール（最後・他にスケール表記が無い場合）
  if (/デカール|decal/i.test(name)) return "デカール";
  return "";
}

async function fetchProductByJAN(jan) {
  try {
    // 商品情報 + 希望小売価格を並行取得
    const [searchRes, priceRes] = await Promise.all([
      fetch(`/api/search?jan=${jan}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/price?jan=${jan}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const retailPrice = priceRes?.price ? String(priceRes.price) : "";

    if (searchRes?.name) {
      return {
        name: searchRes.name,
        photoUrl: searchRes.photoUrl || "",
        price: retailPrice || searchRes.price || "", // 希望小売価格優先
        series: searchRes.series || guessSeriesFromName(searchRes.name),
        scale: searchRes.scale || guessScaleFromName(searchRes.name),
        _priceSource: priceRes?.source || "",
      };
    }
  } catch (_) {}
  return null;
}

// ---- Barcode Scanner ----
function BarcodeScanner({ onDetected, onClose, continuous = false }) {
  const isIPhone = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const [error, setError] = useState("");
  const [debugInfo, setDebugInfo] = useState("起動中...");
  const [tapFlash, setTapFlash] = useState(false);
  const videoRef = useRef();       // div container
  const videoElRef = useRef();     // actual video element
  const detectedRef = useRef(false);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const inputRef = useRef();
  const [imgSrc, setImgSrc] = useState(null);
  const [scanning, setScanning] = useState(false);

  const handleTap = () => {
    setTapFlash(true);
    setTimeout(() => setTapFlash(false), 300);
  };

  useEffect(() => {
    if (!isIPhone) return;

    let cancelled = false;
    let quaggaStarted = false;

    // ==================
    // カメラストリーム取得
    // ==================
    const getStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        });
        return stream;
      } catch (_) {
        // exact失敗時はfallback
        return await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      }
    };

    // ==================
    // video要素のセットアップ
    // ==================
    const setupVideo = (stream) => new Promise((resolve) => {
      // 既存のvideoを再利用 or 新規作成
      let video = videoElRef.current;
      if (!video) {
        video = document.createElement("video");
        videoElRef.current = video;
      }
      video.style.cssText = "width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;display:block;";
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");

      if (videoRef.current && !videoRef.current.contains(video)) {
        videoRef.current.appendChild(video);
      }

      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play()
          .then(() => resolve(video))
          .catch(() => resolve(video));
      };
      video.onerror = () => resolve(video);
      // 最大2秒待つ
      setTimeout(() => resolve(video), 2000);
    });

    // ==================
    // ZBar WASMスキャン
    // ==================
    const runZBar = async (video) => {
      const zbar = window.zbarWasm;
      if (!zbar || !zbar.scanImageData) {
        throw new Error("ZBar not available");
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let frameCount = 0;
      let lastTs = 0;

      return new Promise((resolve, reject) => {
        // resolve 後に tick が走り続けて WASM 呼び出しが累積する問題（連続スキャンモードで
        // ループ毎に新しい tick が追加され、旧 tick が停止せず CPU 食い尽くす → 画面フリーズ）
        // を防ぐため、done フラグで tick チェーンを明示的に止める。
        let done = false;
        // tick は内部で await zbar.scanImageData を呼ぶが、その完了を待たずに
        // 次フレームの rAF を予約していたため、iOS で1スキャン>150ms になると WASM 呼び出しが
        // 並列に積み上がってメインスレッドを食い尽くす（=フリーズ）。
        // inflight フラグで「同時に走る WASM スキャンは1つだけ」に制限する。
        let inflight = false;
        const tick = async (ts) => {
          if (done || cancelled || detectedRef.current) return;
          animRef.current = requestAnimationFrame(tick);

          if (inflight) return;                  // 前のスキャンがまだ走っているフレームはスキップ
          if (ts - lastTs < 150) return;
          lastTs = ts;
          frameCount++;

          const vw = video.videoWidth;
          const vh = video.videoHeight;

          if (frameCount % 5 === 0) {
            setDebugInfo(`ZBar: ${vw}x${vh} (${frameCount}f)`);
          }

          if (vw === 0 || vh === 0) return;

          inflight = true;
          try {
            canvas.width = vw;
            canvas.height = vh;
            ctx.drawImage(video, 0, 0, vw, vh);
            const imageData = ctx.getImageData(0, 0, vw, vh);
            const symbols = await zbar.scanImageData(imageData);

            if (symbols && symbols.length > 0 && !done && !detectedRef.current) {
              const raw = symbols[0].decode();
              if (raw && raw.length >= 8) {
                done = true; // この tick チェーンを停止
                setDebugInfo(`✅ ZBar検出: ${raw}`);
                resolve(raw);
                return;
              }
            }
          } catch (e) {
            // WASM エラー - 継続
          } finally {
            inflight = false;
          }
        };
        animRef.current = requestAnimationFrame(tick);
      });
    };

    // ==================
    // Quaggaスキャン（フォールバック）
    // ==================
    const runQuagga = () => new Promise((resolve, reject) => {
      const loadScript = () => new Promise((res, rej) => {
        if (window.Quagga) { res(); return; }
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js";
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });

      loadScript().then(() => {
        window.Quagga.init({
          inputStream: {
            name: "Live", type: "LiveStream",
            target: videoRef.current,
            constraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          decoder: {
            readers: ["ean_reader", "ean_8_reader", "code_128_reader"],
            multiple: false,
          },
          locate: true,
          frequency: 10,
          locator: { patchSize: "large", halfSample: false },
        }, (err) => {
          if (err) { reject(err); return; }
          quaggaStarted = true;
          window.Quagga.start();
          setDebugInfo("Quagga スキャン中...");

          // ズーム設定
          const vid = videoRef.current?.querySelector("video");
          if (vid?.srcObject) {
            streamRef.current = vid.srcObject;
            const track = vid.srcObject.getVideoTracks()[0];
            setTimeout(() => {
              try { track?.applyConstraints({ advanced: [{ zoom: 1.5 }] }).catch(() => {}); } catch (_) {}
            }, 500);
          }
        });

        let lastCode = null, sameCount = 0;
        window.Quagga.onDetected((result) => {
          if (cancelled || detectedRef.current) return;
          const code = result?.codeResult?.code;
          if (!code) return;
          if (code === lastCode) {
            sameCount++;
            setDebugInfo(`Quagga: ${code} (${sameCount}/2)`);
            if (sameCount >= 2) {
              if (continuous) {
                // 連続モード：2秒クールダウン後にリセット
                detectedRef.current = true;
                onDetected(code);
                setTimeout(() => {
                  detectedRef.current = false;
                  lastCode = null;
                  sameCount = 0;
                  setDebugInfo("次のバーコードをスキャン...");
                }, 2000);
              } else {
                resolve(code);
              }
            }
          } else {
            lastCode = code; sameCount = 1;
            setDebugInfo(`Quagga: ${code} (1/2)`);
          }
        });
      }).catch(reject);
    });

    // ==================
    // メイン処理
    // ==================
    const main = async () => {
      try {
        setDebugInfo("カメラ起動中...");
        const stream = await getStream();
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        // ZBar WASMを試みる
        const zbarReady = window.__zbarReady && window.zbarWasm;
        if (zbarReady) {
          setDebugInfo("ZBar WASM 準備完了");
          try {
            const video = await setupVideo(stream);
            // ズーム1.5倍
            const track = stream.getVideoTracks()[0];
            try { track?.applyConstraints({ advanced: [{ zoom: 1.5 }] }).catch(() => {}); } catch (_) {}

            const firstCode = await runZBar(video);
            if (!cancelled) {
              // 1回スキャンも連続スキャンも、検出後は同じループを回す。
              // - 1回スキャンで「追加する」 → handleJanDetected が setShowScanner(false)
              //   を呼ぶ → unmount で cleanup → cancelled=true → ループ自然終了。
              // - 1回スキャンで「キャンセル」 → handleJanDetected は何もせず return →
              //   cancelled は false のまま → カメラを維持して次のバーコードを待つ。
              // - 連続スキャン → ハンドラがキューに追加して return → ループ継続。
              // 旧コードでは単発時に直後にカメラを stop() していたため、キャンセル後に
              // 「カメラに戻る」とき映像が止まったままフリーズして見えた。
              const scanLoop = async () => {
                let code = firstCode;
                while (!cancelled) {
                  // ハンドラ完了まで次のスキャンを開始しない（React state / WASM 競合防止）
                  try { await onDetected(code); } catch {}
                  if (cancelled) break;
                  // iOS Safari がモーダル裏で <video> を止めていたら再開させる
                  if (video.paused) {
                    try { await video.play(); } catch {}
                  }
                  setDebugInfo("次のバーコードへ移動してください");
                  // 同じバーコードを連射しないための小休止
                  await new Promise((r) => setTimeout(r, 800));
                  if (cancelled) break;
                  setDebugInfo("次のバーコードをスキャン...");
                  try {
                    code = await runZBar(video);
                  } catch { break; }
                }
              };
              scanLoop();
            }
            return;
          } catch (e) {
            setDebugInfo(`ZBar失敗(${String(e).slice(0,20)})→Quagga`);
            stream.getTracks().forEach(t => t.stop());
          }
        } else {
          setDebugInfo(`ZBar未対応→Quagga (${window.__zbarError || "loading"})`);
        }

        // Quaggaフォールバック
        const code = await runQuagga();
        if (!cancelled) {
          onDetected(code);
          if (continuous) {
            // 連続モード：Quaggaを止めずに継続
            setDebugInfo("次のバーコードをスキャン...");
            // Quaggaはそのまま動き続けるのでonDetectedハンドラで対応
          } else {
            detectedRef.current = true;
            if (quaggaStarted) { try { window.Quagga.stop(); } catch (_) {} }
          }
        }

      } catch (e) {
        if (!cancelled) {
          setDebugInfo(`エラー: ${String(e).slice(0,50)}`);
          setError("カメラを起動できませんでした。手動でJANコードを入力してください。");
        }
      }
    };

    main();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (quaggaStarted && window.Quagga) { try { window.Quagga.stop(); } catch (_) {} }
    };
  }, []);

  // Android: 写真撮影→BarcodeDetector
  const readBarcode = async (file) => {
    setScanning(true);
    setError("");
    try {
      const detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      const img = new Image();
      await new Promise(r => { img.onload = r; img.src = URL.createObjectURL(file); });
      for (const scale of [1, 0.5, 2, 1.5]) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const results = await detector.detect(await createImageBitmap(canvas));
        if (results.length > 0) { setScanning(false); onDetected(results[0].rawValue); return; }
      }
      setScanning(false);
      setError("読み取れませんでした。\nバーコード部分だけをアップで明るい場所で撮影してください。");
    } catch (e) {
      setScanning(false);
      setError("読み取りエラー。手動でJANコードを入力してください。");
    }
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImgSrc(URL.createObjectURL(file));
    setError("");
    readBarcode(file);
    e.target.value = "";
  };

  const handleRetake = () => {
    setImgSrc(null); setError(""); setScanning(false);
    setTimeout(() => inputRef.current?.click(), 100);
  };

  // iPhone: ライブスキャン画面
  if (isIPhone) {
    return (
      <div style={sc.wrap}>
        <div style={sc.header}>
          <span style={sc.title}>📷 バーコードをスキャン</span>
          <button style={sc.closeBtn} onClick={onClose}>✕ 閉じる</button>
        </div>
        {error ? (
          <div style={sc.errorBox}>{error}</div>
        ) : (
          <div style={{ ...sc.videoWrap, outline: tapFlash ? "3px solid rgba(255,255,255,0.8)" : "none" }} onClick={handleTap}>
            <div ref={videoRef} style={{ width: "100%", height: "100%", position: "relative", background: "#000" }} />
            <div style={sc.dimOverlay}><div style={sc.frame} /></div>
            <div style={sc.hint}>バーコードを枠内に合わせてください</div>
            <div style={{ position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.85)", background: "rgba(0,0,0,0.5)", padding: "4px 8px" }}>
              v1.29 | スキャン中...
            </div>
          </div>
        )}
        <div style={sc.dividerRow}><span style={sc.dividerText}>または手動で入力</span></div>
        <ManualInput onDetected={onDetected} />
      </div>
    );
  }

  // Android: 写真撮影→BarcodeDetector
  return (
    <div style={sc.wrap}>
      <div style={sc.header}>
        <span style={sc.title}>📷 バーコードをスキャン</span>
        <button style={sc.closeBtn} onClick={onClose}>✕ 閉じる</button>
      </div>
      {!imgSrc ? (
        <div>
          <div style={sc.shootBox} onClick={() => inputRef.current?.click()}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 6 }}>バーコードを撮影する</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>タップしてカメラを起動</div>
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 8, lineHeight: 1.8 }}>
            💡 バーコード部分だけをアップで・明るい場所で撮影してください
          </div>
        </div>
      ) : (
        <div>
          <img src={imgSrc} style={{ width: "100%", borderRadius: 12, objectFit: "contain", maxHeight: 200, marginBottom: 10 }} alt="" />
          {scanning && <div style={sc.scanningBox}>🔍 バーコードを解析中...</div>}
          {error && (
            <div style={sc.errorBox}>
              <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{error}</div>
              <button style={sc.retakeBtn} onClick={handleRetake}>📷 撮り直す</button>
            </div>
          )}
          {!scanning && !error && (
            <button style={sc.retakeBtn2} onClick={handleRetake}>📷 撮り直す</button>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFile} />
      <div style={sc.dividerRow}><span style={sc.dividerText}>または手動で入力</span></div>
      <ManualInput onDetected={onDetected} />
    </div>
  );
}

function ManualInput({ onDetected }) {
  const [val, setVal] = useState("");

  const handleChange = (e) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 13);
    setVal(v);
    if (v.length === 13) onDetected(v);
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const digits = pasted.replace(/[^0-9]/g, "").slice(0, 13);
    setVal(digits);
    if (digits.length >= 8) setTimeout(() => onDetected(digits), 100);
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 1.7, background: "#f8f9fa", borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>📱 バーコード数字のコピー方法</div>
        <div>① カメラでバーコード<strong>下の数字</strong>を映す</div>
        <div>② 数字が認識されたらタップ→コピー</div>
        <div>③ 下の入力欄に貼り付けると自動検索</div>
      </div>
      <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
        <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none" }}
          placeholder="JANコード（13桁）" inputMode="numeric" value={val}
          onChange={handleChange} onPaste={handlePaste} />
        <button style={{ padding: "10px 16px", background: val.length >= 8 ? "#111" : "#d1d5db", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: val.length >= 8 ? "pointer" : "default" }}
          onClick={() => val.length >= 8 && onDetected(val)}>検索</button>
      </div>
    </div>
  );
}

const sc = {
  wrap: { background: "#fff", borderRadius: "0 0 20px 20px", width: "100%", maxWidth: 480, padding: "20px 20px 28px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "#f3f4f6", border: "none", fontSize: 13, cursor: "pointer", color: "#374151", padding: "6px 14px", borderRadius: 20, fontWeight: 600 },
  videoWrap: { position: "relative", background: "#111", borderRadius: 14, overflow: "hidden", aspectRatio: "4/3", marginBottom: 4 },
  dimOverlay: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  frame: { width: "80%", aspectRatio: "2.5/1", border: "2.5px solid #fff", borderRadius: 10, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" },
  hint: { position: "absolute", bottom: 28, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.9)", fontSize: 12 },
  tapHint: { position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", color: "#4ade80", fontSize: 11, fontWeight: 600 },
  shootBox: { background: "#f8f9fa", border: "2px dashed #d1d5db", borderRadius: 16, padding: "36px 20px", textAlign: "center", cursor: "pointer", marginBottom: 8 },
  scanningBox: { background: "#f0fdf4", color: "#166534", borderRadius: 10, padding: "12px 16px", fontSize: 13, textAlign: "center", marginBottom: 10 },
  errorBox: { background: "#fee2e2", color: "#b91c1c", borderRadius: 12, padding: "14px 16px", fontSize: 13, marginBottom: 10 },
  retakeBtn: { display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  retakeBtn2: { width: "100%", padding: "10px 0", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 8 },
  dividerRow: { display: "flex", alignItems: "center", margin: "16px 0 12px" },
  dividerText: { fontSize: 12, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 20, padding: "3px 12px", margin: "0 auto" },
};

// ---- Kit Name Input with Suggestions ----
function KitNameInput({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // 候補名を「グレード 1/スケール キット名」に整形
  const formatCandidateName = (name) => {
    if (!name) return '';
    let n = name;
    // 余計な記号・カッコ内を削除
    n = n.replace(/『[^』]*』/g, '');
    n = n.replace(/「[^」]*」/g, '');
    n = n.replace(/【[^】]*】/g, '');
    n = n.replace(/\[[^\]]*\]/g, '');
    n = n.replace(/（[^）]*）/g, '');
    n = n.replace(/\([^)]*\)/g, '');
    n = n.replace(/[★☆◆◇■□▲▼●○※†‡♪]/g, '');
    // ノイズワード削除
    const noise = ['BANDAI SPIRITS', 'バンダイスピリッツ', 'バンダイ', 'BANDAI',
      'プラモデル', '色分け済み', '再販', '新品', '在庫品', '未開封'];
    noise.forEach(w => { n = n.replace(new RegExp(w, 'g'), ''); });
    // 連続スペース整理
    n = n.replace(/\s+/g, ' ').trim();
    // 末尾の記号を削除
    n = n.replace(/[\s\-_,、。・]+$/, '').trim();
    return n;
  };

  const search = async (q) => {
    if (q.length < 2) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
      const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/products?and=(${q.trim().split(/\s+/).filter(Boolean).map(w=>'name.ilike.*'+encodeURIComponent(w)+'*').join(',')})&select=name,scale,image_url,jan,series&limit=10&order=name.asc`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.map(d => ({
          name: d.name,
          scale: d.scale,
          photoUrl: d.image_url,
          jan: d.jan,
          series: d.series,
        })));
      }
    } catch (_) {}
    setLoading(false);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 600);
  };

  const handleSelect = (item) => {
    onChange(item.name);
    onSelect(item);
    setSuggestions([]);
  };

  return (
    <div>
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <input style={{ ...suggS.input }}
          placeholder="例: νガンダム、ザク"
          value={value}
          onChange={handleChange}
        />
        {loading && <span style={{ position: "absolute", right: 10, fontSize: 11, color: "#9ca3af" }}>検索中...</span>}
      </div>
      {suggestions.length > 0 && (
        <div style={suggS.list}>
          {suggestions.map((item, i) => (
            <div key={i} style={suggS.item} onClick={() => handleSelect(item)}>
              {item.photoUrl && <KitImage src={item.photoUrl} style={suggS.thumb} />}
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                {item.scale && (
                  <span style={{ display: "inline-block", background: "#eff6ff", color: "#1d4ed8", borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 700, marginBottom: 3 }}>
                    {item.scale}
                  </span>
                )}
                <div style={suggS.name}>{formatCandidateName(item.name)}</div>
              </div>
            </div>
          ))}
          <div style={{ padding: "8px 12px", fontSize: 11, color: "#9ca3af", textAlign: "center", cursor: "pointer" }}
            onClick={() => setSuggestions([])}>閉じる</div>
        </div>
      )}
    </div>
  );
}

const suggS = {
  input: { width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, color: "#111", background: "#fafafa", boxSizing: "border-box", outline: "none" },
  list: { background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", marginTop: 4, overflow: "hidden" },
  item: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" },
  thumb: { width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 },
  name: { fontSize: 13, color: "#111", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  scale: { fontSize: 11, color: "#4f8ef7", fontWeight: 600, marginTop: 2 },
};

// ---- Help Modal ----
// ---- Browse Modal（グレード別一覧から一括登録）----
function BrowseModal({ onBulkAdd, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedItems, setSelectedItems] = useState({}); // key: "name_jan", value: item
  const [searched, setSearched] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");

  const getKey = (item) => `${item.name}_${item.jan}`;

  const search = async (p, q) => {
    setLoading(true);
    setSearched(true);
    try {
      const query = q !== undefined ? q : browseQuery;
      const url = query.trim()
        ? `/api/browse?page=${p}&q=${encodeURIComponent(query.trim())}`
        : `/api/browse?page=${p}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (item) => {
    const key = getKey(item);
    setSelectedItems(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = item;
      return next;
    });
  };

  const handleBulkAdd = () => {
    const list = Object.values(selectedItems);
    if (list.length === 0) return;
    onBulkAdd(list);
    onClose();
  };

  const selectedCount = Object.keys(selectedItems).length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: "16px 16px 0 0", padding: 20, width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>📋 リストから一括登録</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input
            type="text"
            value={browseQuery}
            onChange={(e) => setBrowseQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); search(1, browseQuery); } }}
            placeholder="例: バンダイ HG ガンダム（スペース区切りでAND検索）"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #d1d5db", fontSize: 14 }}
          />
          <button
            onClick={() => { setPage(1); search(1, browseQuery); }}
            style={{ padding: "10px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            🔍 検索
          </button>
        </div>

        <div style={{ background: "#fff8e1", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.7, wordBreak: "break-word" }}>
            ⚠ 注意：登録される情報は商品名・画像のみです。購入日・価格・状態などの詳細は登録後に個別に編集してください。
          </div>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 20, color: "#6b7280" }}>読み込み中...</div>}

        {!loading && searched && items.length === 0 && (
          <div style={{ textAlign: "center", padding: 20, color: "#6b7280" }}>該当する商品が見つかりません</div>
        )}

        {!loading && items.length > 0 && (
          <>
            <div style={{ marginBottom: 12 }}>
              {items.map((item) => {
                const key = getKey(item);
                const isSelected = !!selectedItems[key];
                return (
                  <div key={key} onClick={() => toggleSelect(item)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: isSelected ? "#dcfce7" : "#fff", border: "1.5px solid", borderColor: isSelected ? "#22c55e" : "#e5e7eb", borderRadius: 10, marginBottom: 6, cursor: "pointer" }}>
                    {item.image_url && <img src={item.image_url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      {item.scale && <div style={{ fontSize: 11, color: "#6b7280" }}>{item.scale}</div>}
                    </div>
                    {isSelected && <span style={{ color: "#22c55e", fontSize: 18, fontWeight: 700 }}>✓</span>}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
              <button
                disabled={page <= 1}
                style={{ padding: "6px 16px", border: "1.5px solid #d1d5db", background: page <= 1 ? "#f3f4f6" : "#fff", borderRadius: 8, fontSize: 13, cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}
                onClick={() => { const p = page - 1; setPage(p); search(p); }}>← 前へ</button>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{page} / {Math.ceil(total / 20) || 1} ページ ({total}件)</span>
              {page * 20 < total && (
                <button style={{ padding: "6px 16px", border: "1.5px solid #d1d5db", background: "#fff", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
                  onClick={() => { const p = page + 1; setPage(p); search(p); }}>次へ →</button>
              )}
            </div>

            {/* 一括登録ボタン */}
            {selectedCount > 0 && (
              <button style={{ width: "100%", padding: "14px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
                onClick={handleBulkAdd}>
                ✓ {selectedCount}件をまとめて登録
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
// ---- Backup Modal ----
function BackupModal({ kits, onImport, onClose }) {
  const fileRef = useRef();
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(""); // "ok" | "err"

  const handleExport = async () => {
    try {
      // Phase 4.C.2: idb-blob URL は base64 にインライン化して、別端末でも復元できるようにする
      const inlineBlobUrl = async (url) => {
        if (!isIdbBlobUrl(url)) return url;
        const b = await kitsIdbPhotoGet(idbBlobUrlToId(url));
        if (!b) return ""; // blob 不在（壊れた参照）の場合は空に
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result || "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(b);
        });
      };
      const inlinedKits = await Promise.all(kits.map(async (k) => ({
        ...k,
        photoUrl: await inlineBlobUrl(k.photoUrl),
        completedPhotoUrl: await inlineBlobUrl(k.completedPhotoUrl),
      })));
      const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), kits: inlinedKits }, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tsumitsumi_backup_${new Date().toLocaleDateString("ja-JP").replace(/\//g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("バックアップファイルをダウンロードしました！");
      setMsgType("ok");
    } catch (e) {
      setMsg("バックアップの作成に失敗しました");
      setMsgType("err");
    }
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const imported = data.kits || data;
        if (!Array.isArray(imported)) throw new Error();
        onImport(imported);
        setMsg(`${imported.length}件のデータをインポートしました！`);
        setMsgType("ok");
      } catch {
        setMsg("ファイルの読み込みに失敗しました。正しいバックアップファイルを選択してください。");
        setMsgType("err");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>💾 バックアップ</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

      {msg && (
        <div style={{ background: msgType === "ok" ? "#f0fdf4" : "#fee2e2", color: msgType === "ok" ? "#166534" : "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, wordBreak: "break-word" }}>
          {msg}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#f8f9fa", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>📤 エクスポート（バックアップ）</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 }}>現在の積みプラデータをJSONファイルとして保存します。iCloudやGoogleドライブに保存しておくと安心です。</div>
          <button
            style={{ width: "100%", padding: "12px 0", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            onClick={handleExport}>
            ダウンロード（{kits.length}件）
          </button>
        </div>

        <div style={{ background: "#f8f9fa", borderRadius: 12, padding: "16px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>📥 インポート（復元）</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 }}>バックアップファイルからデータを復元します。現在のデータは上書きされます。</div>
          <button
            style={{ width: "100%", padding: "12px 0", background: "#fff", color: "#111", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            onClick={() => fileRef.current.click()}>
            ファイルを選択
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
        </div>
      </div>

      <div style={{ background: "#fff8e1", borderRadius: 10, padding: "12px 14px", marginTop: 4 }}>
        <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.7, wordBreak: "break-word" }}>
          ⚠️ <strong>注意：</strong>SafariとChromeなど、ブラウザの種類が異なるとデータは別々に保存されます。異なるブラウザへ移行する場合は、必ずエクスポートしてからインポートしてください。
        </div>
      </div>

      {/* 広告（運営費補填用・AdSense審査中は ADS_ENABLED=false で非表示） */}
      {ADS_ENABLED && (
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>広告</div>
          <iframe src="/admax-banner.html" title="ad" loading="lazy" width="320" height="100" frameBorder="0" scrolling="no" style={{ border: "none", display: "inline-block", maxWidth: "100%" }} />
        </div>
      )}
    </div>
  );
}


// ---- Bulk Tag Badge ----
function BulkTagBadge({ tag, onApply, onRemove }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 20, padding: "3px 4px 3px 10px", fontSize: 11, fontWeight: 600, userSelect: "none", WebkitUserSelect: "none" }}>
      <span onClick={onApply} style={{ color: "#166534", cursor: "pointer" }}>#{tag}</span>
      <button onClick={onRemove} title="選択キットから外す"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 20, padding: "0 8px", background: "#ef4444", borderRadius: 20, color: "#fff", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>
        解除
      </button>
    </div>
  );
}

// ---- Tag Input ----
function TagInput({ tags, onChange, allTags = [] }) {
  const [input, setInput] = useState("");

  const addTag = (val) => {
    const tag = val.trim();
    if (!tag || tags.includes(tag)) { setInput(""); return; }
    onChange([...tags, tag]);
    setInput("");
  };

  const removeTag = (tag) => {
    onChange(tags.filter(t => t !== tag));
  };

  const suggestions = input.trim()
    ? allTags.filter(t => t.includes(input.trim()) && !tags.includes(t)).slice(0, 5)
    : allTags.filter(t => !tags.includes(t)).slice(0, 5);

  return (
    <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fafafa" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: tags.length > 0 ? 8 : 0 }}>
        {tags.map(tag => (
          <span key={tag}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "#f0fdf4",
              color: "#166534",
              borderRadius: 20, padding: "5px 6px 5px 12px", fontSize: 13, fontWeight: 600,
              userSelect: "none", WebkitUserSelect: "none",
            }}
          >
            #{tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              aria-label={`タグ「${tag}」を削除`}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, minWidth: 24, minHeight: 24,
                background: "#ef4444", border: "none", borderRadius: "50%",
                color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                flexShrink: 0, lineHeight: 1, padding: 0,
                touchAction: "manipulation",
              }}>
              ×
            </button>
          </span>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {suggestions.map(t => (
            <button key={t} onClick={() => addTag(t)}
              style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 20, padding: "2px 10px", fontSize: 11, color: "#374151", cursor: "pointer" }}>
              ＋{t}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          style={{ flex: 1, border: "none", background: "none", outline: "none", fontSize: 13, color: "#111" }}
          placeholder="タグを入力してEnter（例：プレバン限定品）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(input); } }}
        />
        <button
          style={{ background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
          onClick={() => addTag(input)}>追加</button>
      </div>
    </div>
  );
}

// ---- 全バージョン履歴モーダル ----
function AllVersionsModal({ onClose }) {
  const versions = [
    { ver: "v1.32", date: "2026/06/13", isNew: true, items: ["完成写真を最大6枚まで登録可能に", "完成タブを「完成品アルバム」に刷新（サムネをタップで写真ギャラリーを表示）", "完成済みキットのカードに「📸シェア」ボタンを追加（その完成品の写真を1枚の画像にまとめてXシェア）"] },
    { ver: "v1.31", date: "2026/06/13", isNew: false, items: ["完成済みキットの「完成アルバム」シェア機能を追加（完成写真を大きく見せるリッチな画像を生成してXに投稿。表紙＋ショーケース・称号入り）"] },
    { ver: "v1.30", date: "2026/05/30", isNew: false, items: ["積みプラ数のランクの上限を更新"] },
    { ver: "v1.29", date: "2026/05/25", isNew: false, items: ["キット詳細に「Amazonで関連商品を見る」ボタンを追加（運営費補填のためアフィリエイトリンクを利用）"] },
    { ver: "v1.28", date: "2026/05/25", isNew: false, items: ["時間が経つと一部キットの登録画像が消えて 📦 マークだけ残る不具合の根本対策（ブラウザのストレージ永続化を要求）"] },
    { ver: "v1.27", date: "2026/05/24", isNew: false, items: ["1回スキャンで登録済みJANをキャンセルした後にカメラが固まる問題を、スキャナーを一瞬閉じて再起動する方式で確実に解消"] },
    { ver: "v1.26", date: "2026/05/24", isNew: false, items: ["1回スキャンで登録済みJANをキャンセルしたあとカメラ画面が止まる不具合を修正（即時に再撮影できる）"] },
    { ver: "v1.25", date: "2026/05/24", isNew: false, items: ["連続バーコードスキャン時の同一JAN確認ダイアログをアプリ内モーダル化（iOSでカメラが固まる不具合を解消）", "1回スキャンで登録済みJANを読み込んでキャンセルしたとき、既存キット詳細を開かずカメラ撮影に戻るよう変更"] },
    { ver: "v1.24", date: "2026/05/24", isNew: false, items: ["連続バーコードスキャンのフリーズ対策（並列WASMスキャン抑止・カメラ自動復帰）", "登録済み箱画像の保存先が壊れたときに「📦」プレースホルダを表示（真っ白にならないよう改善）"] },
    { ver: "v1.23", date: "2026/05/24", isNew: false, items: ["スケール選択肢に「✏️ 自由入力」を追加（独自表記やマイナースケールも登録可）", "称号行に「📦 プラモを預ける」リンクを追加（トランクルームのご案内）", "Xシェアの複数ページ画像を全部保存できるよう改善（プレビュー表示・個別保存ボタン・対応端末で一括共有）", "Xシェアの「✕ 閉じる」ボタンを大きく押しやすく", "キット数が多い方の入力遅延・もたつきを大幅改善"] },
    { ver: "v1.22", date: "2026/05/20", isNew: false, items: ["完成写真を登録したキットはサムネイルに完成写真を優先表示", "運営費補填のためモーダル内に控えめなバナー広告を追加（共有・Xシェア・キット詳細・ヘルプ・バックアップ）"] },
    { ver: "v1.21", date: "2026/05/12", isNew: false, items: ["起動時に一瞬古い表示が出るチラつきを解消（読込完了までローディング表示）"] },
    { ver: "v1.20", date: "2026/05/12", isNew: false, items: ["重要: 再起動時に一部キットの画像が消えるデータ消失バグを修正（保存処理の初期化順序を改善）"] },
    { ver: "v1.19", date: "2026/05/12", isNew: false, items: ["スケール・シリーズの自動補完を強化（全てのスケール選択肢に対応・SMP/R3 等のシリーズ自動判定にも対応）"] },
    { ver: "v1.18", date: "2026/05/12", isNew: false, items: ["完成済みキットの「完成」ボタンを「完成を解除」表示に変更（未完成に戻せることを明示）"] },
    { ver: "v1.17", date: "2026/05/12", isNew: false, items: ["スケール選択肢に 1/20・1/12 を追加", "シリーズ選択肢に SMP・R3 を追加", "キット詳細画面に「複製」ボタンを追加（登録情報をそのままコピーして新規キットを作成）"] },
    { ver: "v1.16", date: "2026/05/12", isNew: false, items: ["スケール選択肢に 1/35・1/550・1/1700 を追加", "完成チェック時に状態（未開封・素組状態・欠品有り・制作途中）を自動でクリア", "連続バーコードスキャンで同じJANを再読み込みすると確認ダイアログが繰り返し表示される不具合を修正"] },
    { ver: "v1.15", date: "2026/05/11", isNew: false, items: ["使われていない一括操作ボタンを整理（「定価を一括取得」「画像を整理して容量を節約」を削除）"] },
    { ver: "v1.14", date: "2026/05/11", isNew: false, items: ["総額表示が選択中のタブに連動（積みプラ・完成・総計それぞれの合計を表示）"] },
    { ver: "v1.13", date: "2026/05/11", isNew: false, items: ["保存容量の上限を5MBから大幅に拡張（数百MB〜数GB級・容量警告も解消）", "複数タブで自動同期（片方で追加・編集するともう一方にも即反映）", "写真の保存方式を最適化し、容量を約30%節約", "ヘルプに「写真を新形式に変換」ボタンを追加（既存写真も最適化可能）", "バックアップ・復元を新形式の写真に対応"] },
    { ver: "v1.12", date: "2026/05/10", isNew: false, items: ["総額表示から完成済みキットを除外"] },
    { ver: "v1.11", date: "2026/05/03", isNew: false, items: ["ダークモード（ライト/ダーク切り替え）に対応"] },
    { ver: "v1.10", date: "2026/05/02", isNew: false, items: ["ランクを「天照大積ミ神」「神界の積み人」など上位帯まで追加・既存ラベル調整", "タグの作成・編集・削除ができる「タグ編集」画面を追加（件数・希望小売価格合計も表示）", "一括編集モードのタグ操作を「解除」ボタンに統一", "並び順から「手動順」を削除し、登録順をデフォルトに統一", "ヘルプに「画像を整理して容量を節約」ボタンを追加"] },
    { ver: "v1.09", date: "2026/05/02", isNew: false, items: ["金額の編集が総額に反映されない不具合を修正"] },
    { ver: "v1.08", date: "2026/05/02", isNew: false, items: ["並び順・表示モードの永続化機能を追加", "更新履歴の文言を簡潔化"] },
    { ver: "v1.07", date: "2026/05/02", isNew: false, items: ["プライバシーポリシーを独立ページに分離", "アフィリエイト広告表記を追加"] },
    { ver: "v1.05", date: "2026/05/02", isNew: false, items: ["商品画像の補完取得機能を追加"] },
    { ver: "v1.04", date: "2026/05/01", isNew: false, items: ["価格欄が勝手に埋まる不具合を修正", "新規登録時に前回タグが残る不具合を修正", "タグ削除ボタンを改善"] },
    { ver: "v1.03", date: "2026/05/01", isNew: false, items: ["価格訂正報告のバリデーションを強化"] },
    { ver: "v1.02", date: "2026/05/01", isNew: false, items: ["価格訂正報告画面にWeb検索ショートカットを追加"] },
    { ver: "v1.01", date: "2026/05/01", isNew: false, items: ["参考価格の自動取得機能を追加"] },
    { ver: "v1.00", date: "2026/05/01", isNew: false, items: ["TSUMITSUMI 正式リリース 🎉", "バーコードスキャン登録", "キット一覧管理機能", "総額表示機能", "一括登録機能", "Xシェア画像生成", "情報誤り報告機能", "バックアップ機能", "グリッド・リスト表示"] },
  ];
  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>📋 すべての更新履歴</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {versions.map((v, i) => (
          <div key={v.ver} style={{ background: v.isNew ? "#f0fdf4" : "#fafafa", border: `1px solid ${v.isNew ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              {v.isNew && <span style={{ background: "#22c55e", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "1px 7px" }}>NEW</span>}
              <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{v.ver}</span>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{v.date}</span>
            </div>
            <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.8 }}>
              {v.items.map((item, j) => <div key={j}>・{item}</div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// メモリ上の kits を実データ量として表示し、quota はブラウザ全体の上限を使う。
// navigator.storage.estimate() の usage はフィンガープリント対策で大幅に丸められるため
// （実 47MB → 報告 2MB のような乖離あり）、used は kits の stringify サイズで実測する。
function StorageGauge({ kits }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let used;
      try {
        used = JSON.stringify(kits || []).length;
      } catch (e) {
        if (!cancelled) setInfo({ error: true });
        return;
      }
      let max = 5 * 1024 * 1024; // フォールバック: localStorage 上限
      let quotaSource = 'localStorage';
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        try {
          const est = await navigator.storage.estimate();
          if (est && typeof est.quota === 'number' && est.quota > 0) {
            max = est.quota;
            quotaSource = 'origin';
          }
        } catch (e) { /* keep fallback */ }
      }
      if (!cancelled) setInfo({ used, max, quotaSource });
    })();
    return () => { cancelled = true; };
  }, [kits]);

  if (!info) return <div style={{ color: '#9ca3af', fontSize: 12 }}>容量を取得中...</div>;
  if (info.error) return <div>容量を取得できませんでした</div>;

  const pct = Math.min(100, Math.round(info.used / info.max * 100));
  const color = pct >= 95 ? '#ef4444' : pct >= 80 ? '#eab308' : '#10b981';

  const fmt = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024).toLocaleString() + ' KB';
  };

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        使用中: {fmt(info.used)} / 約 {fmt(info.max)} ({pct < 1 ? '<1' : pct}%)
      </div>
      <div style={{ height: 8, background: '#1f2937', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: Math.max(pct, 0.5) + '%', height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      {pct >= 80 && (
        <div style={{ marginTop: 8, color, fontSize: 12 }}>
          ⚠️ 容量が逼迫しています。古いキットや画像の削除を検討してください。
        </div>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
        ※ 使用中はキット全件の実サイズ ／ 上限は{info.quotaSource === 'origin' ? 'ブラウザの割当（IndexedDB含む）' : 'localStorage のみ（旧来）'}
      </div>
    </div>
  );
}

function HelpModal({ onClose, onResetUserImages, imageResetLoading, imageResetProgress, resetTargetCount, onMigratePhotos, migrateLoading, migrateProgress, migrateTargetCount, theme, onToggleTheme, kits }) {
  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>❓ ヘルプ・使い方</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

        <div style={hs.section}>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="https://tsumitsumi.vercel.app/manual.html" target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, padding: "14px 12px", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, textDecoration: "none", color: "#166534", fontWeight: 700, textAlign: "center", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
              📖 使い方はコチラ →
            </a>
            <button
              onClick={onToggleTheme}
              type="button"
              aria-label={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
              style={{ flexShrink: 0, padding: "14px 16px", background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 10, color: "#78350f", fontWeight: 700, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
              {theme === "dark" ? "☀️ ライト" : "🌙 ダーク"}
            </button>
          </div>
        </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>💾 保存容量</div>
        <div style={hs.desc}><StorageGauge kits={kits} /></div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>🗜️ 写真を新形式に変換（容量節約）</div>
        <div style={hs.desc}>
          古い形式（base64）で保存された写真を新形式（Blob）に変換します。<br/>
          容量が約30%節約され、写真は同じものが見られます。
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>対象: {migrateTargetCount}件のキット</div>
        <button
          onClick={onMigratePhotos}
          disabled={migrateLoading || migrateTargetCount === 0}
          style={{
            width: "100%", padding: "10px 16px", border: "none", borderRadius: 10,
            background: migrateLoading || migrateTargetCount === 0 ? "#e5e7eb" : "#111",
            color: migrateLoading || migrateTargetCount === 0 ? "#9ca3af" : "#fff",
            fontSize: 13, fontWeight: 700,
            cursor: migrateLoading || migrateTargetCount === 0 ? "not-allowed" : "pointer",
          }}
        >
          {migrateLoading
            ? "処理中... " + migrateProgress.current + "/" + migrateProgress.total + "件"
            : migrateTargetCount === 0
            ? "対象のキットがありません"
            : "▶ 写真を変換する"}
        </button>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>⚠ データについての注意</div>
        <div style={hs.item}><span style={hs.warn}>!</span>データはブラウザ内に保存されます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>Safariの「履歴とデータを消去」でデータが消えます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>SafariとChromeなど別ブラウザ間でデータは共有されません</div>
        <div style={hs.item}><span style={hs.warn}>!</span>機種変更・初期化の際はデータが引き継がれません</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>💾 データのバックアップ・機種変更</div>
        <div style={hs.desc}>データはブラウザ内にのみ保存されるため、機種変更や初期化の前にバックアップをお取りください。</div>
        <div style={hs.item}><span style={hs.num}>1</span>画面右上の「⋯」メニュー（または設定）から「エクスポート」をタップ</div>
        <div style={hs.item}><span style={hs.num}>2</span>ダウンロードされたJSONファイルをiCloudやGoogleドライブに保存</div>
        <div style={hs.item}><span style={hs.num}>3</span>新しい端末で同じURLを開き、「インポート」からファイルを読み込む</div>
        <div style={hs.tip}>💡 定期的にエクスポートしておくと安心です</div>
      </div>
      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>お問い合わせ・バグ報告はこちら</div>
        <a
          href="https://x.com/tsumitsumi_pla"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#000", color: "#fff", borderRadius: 20, padding: "10px 20px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
          𝕏 @tsumitsumi_pla
        </a>
      </div>

      {/* TIPS記事一覧（更新履歴の直前に配置・新しい記事は配列の先頭に追加していく） */}
      <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>📚 プラモ製作 TIPS</span>
          <a href="/tips/" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: "#4f8ef7", textDecoration: "underline" }}>
            すべて見る →
          </a>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { title: "ミラーレス・一眼カメラで撮るプラモデル写真", desc: "本格撮影のためのレンズ選び・絞り・3点照明・LEDとストロボの使い分け・RAW現像まで", url: "/tips/photo-camera.html", date: "2026/06/08" },
            { title: "スマートフォンで撮るプラモデル写真", desc: "完成したキットをスマホで映えさせる撮影テクと、必要な3点機材（ライト・背景・三脚）", url: "/tips/photo-smartphone.html", date: "2026/06/08" },
            { title: "ガンプラのゲート跡が白くなる原因と完全な解決法", desc: "白化が起きる原理と、4つの対処法（ヤスリ・マーカー・塗装・接着剤）を解説", url: "/tips/gate-whitening.html", date: "2026/05/27" },
            { title: "【保存版】ガンプラ初心者が最初に揃える工具5選", desc: "1万円以下で全部そろえる、本当に必要な工具を厳選", url: "/tips/beginner-tools.html", date: "2026/05/27" },
          ].map((t, i) => (
            <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", padding: "10px 12px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, textDecoration: "none", color: "#111" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#9a3412", marginBottom: 2 }}>{t.title}</div>
              <div style={{ fontSize: 11, color: "#9a3412", opacity: 0.85, lineHeight: 1.5 }}>{t.desc}</div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{t.date} 公開</div>
            </a>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 8, lineHeight: 1.6 }}>
          ※ 週2本ペースで新しいTIPSを追加していきます
        </div>
      </div>

      {/* バージョン履歴（最下部・直近3件） */}
      <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>📋 更新履歴</span>
          <button
            style={{ fontSize: 11, color: "#4f8ef7", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => window.__showAllVersions && window.__showAllVersions()}>
            すべて見る
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* v1.32 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ background: "#22c55e", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "1px 7px" }}>NEW</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.32</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/06/13</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・完成写真を最大6枚まで登録可能に<br/>
              ・完成タブを「完成品アルバム」に刷新（サムネをタップで写真ギャラリー）<br/>
              ・完成済みカードに「📸シェア」ボタンを追加（その完成品をXでシェア）
            </div>
          </div>
          {/* v1.31 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.31</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/06/13</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・完成済みキットの「完成アルバム」シェア機能を追加（完成写真を大きく見せるリッチな画像を生成してXに投稿）
            </div>
          </div>
          {/* v1.30 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.30</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/05/30</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・積みプラ数のランクの上限を更新
            </div>
          </div>
        </div>
      </div>

      <div style={hs.section}>
        <div style={hs.sectionTitle}>🔒 プライバシーポリシー</div>
        <div style={hs.desc}>本サービスのプライバシーポリシー、アフィリエイト広告に関する表記、免責事項は別ページにまとめています。</div>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "10px 14px", background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 10, textDecoration: "none", color: "#111", fontSize: 13, fontWeight: 600, textAlign: "center", marginTop: 8 }}>プライバシーポリシーを開く →</a>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, textAlign: "center" }}>当サイトはアフィリエイト広告を利用しています</div>
      </div>

      {/* 広告（運営費補填用・AdSense審査中は ADS_ENABLED=false で非表示） */}
      {ADS_ENABLED && (
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>広告</div>
          <iframe src="/admax-banner.html" title="ad" loading="lazy" width="320" height="100" frameBorder="0" scrolling="no" style={{ border: "none", display: "inline-block", maxWidth: "100%" }} />
        </div>
      )}
    </div>
  );
}

const hs = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 40px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
  section: { marginBottom: 20, borderBottom: "1px solid #f0f0f0", paddingBottom: 16, boxSizing: "border-box", width: "100%" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 10 },
  desc: { fontSize: 13, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, wordBreak: "break-word", overflowWrap: "anywhere" },
  item: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#374151", marginBottom: 6, lineHeight: 1.6, wordBreak: "break-word", overflowWrap: "anywhere" },
  num: { minWidth: 20, height: 20, background: "#111", color: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  warn: { minWidth: 20, height: 20, background: "#f59e0b", color: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  tip: { fontSize: 12, color: "#4f8ef7", background: "#eff6ff", borderRadius: 8, padding: "6px 10px", marginTop: 8, wordBreak: "break-word", overflowWrap: "anywhere", boxSizing: "border-box", whiteSpace: "normal", display: "block" },
};

// ---- App Share Modal ----
function AppShareModal({ onClose }) {
  const url = "https://tsumitsumi.vercel.app";
  const text = "積みプラ管理アプリ「TSUMI TSUMI」🗂️\nバーコードスキャンで簡単登録！\n#積みプラ #ツミツミ #TSUMITSUMI";
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "TSUMI TSUMI", text, url });
      } catch (_) {}
    }
  };

  const buttons = [
    {
      label: "🔗 URLをコピー",
      sub: copied ? "コピーしました！" : url,
      color: "#111",
      action: copyUrl,
    },
    {
      label: "𝕏 Xでシェア",
      sub: "Twitterで紹介する",
      color: "#000",
      action: () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text + "\n" + url)}`, "_blank"),
    },
    {
      label: "📱 共有メニューを開く",
      sub: "LINEやメールなど",
      color: "#4f8ef7",
      action: shareNative,
      hide: !navigator.share,
    },
  ];

  return (
    <div style={as.wrap}>
      <div style={as.header}>
        <span style={as.title}>🗂️ TSUMI TSUMIを共有</span>
        <button style={as.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={as.appCard}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>TSUMI TSUMI</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>PLASTIC MODEL TRACKER</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
          バーコードスキャンで積みプラを<br/>かんたん管理できる無料Webアプリ
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {buttons.filter(b => !b.hide).map((b, i) => (
          <button key={i} style={{ ...as.btn, background: b.color }} onClick={b.action}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{b.label}</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{b.sub}</div>
          </button>
        ))}
      </div>
      {/* 広告（運営費補填用・AdSense審査中は ADS_ENABLED=false で非表示） */}
      {ADS_ENABLED && (
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>広告</div>
          <iframe src="/admax-banner.html" title="ad" loading="lazy" width="320" height="100" frameBorder="0" scrolling="no" style={{ border: "none", display: "inline-block", maxWidth: "100%" }} />
        </div>
      )}
    </div>
  );
}

const as = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 40px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: "#111" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
  appCard: { background: "#f8f9fa", borderRadius: 16, padding: "20px", textAlign: "center", marginBottom: 20 },
  btn: { width: "100%", padding: "14px 16px", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", textAlign: "left" },
};

// ---- タグ編集モーダル ----
function TagEditorModal({ kits, setKits, tagMasterList, setTagMasterList, onClose }) {
  const [newTag, setNewTag] = useState("");
  const [editingTag, setEditingTag] = useState(null);
  const [editValue, setEditValue] = useState("");

  // 単キットの希望小売価格（メイン総額バーと同じ retailPrice → price フォールバック）
  const getKitPrice = (k) => {
    const rp = parseInt((k.retailPrice || "").toString().replace(/[^0-9]/g, ""), 10);
    if (!isNaN(rp) && rp > 0) return rp;
    const p = parseInt((k.price || "").toString().replace(/[^0-9]/g, ""), 10);
    return isNaN(p) ? 0 : p;
  };

  // タグの一覧 / 使用件数 / 希望小売価格の合計（マスター登録のみのタグは件数も価格も0）
  const tagUsage = (() => {
    const m = new Map();
    for (const k of kits) {
      const kitTotalPrice = getKitPrice(k) * (k.count || 1);
      for (const t of (k.tags || [])) {
        const cur = m.get(t) || { count: 0, totalPrice: 0 };
        m.set(t, { count: cur.count + 1, totalPrice: cur.totalPrice + kitTotalPrice });
      }
    }
    for (const t of tagMasterList) {
      if (!m.has(t)) m.set(t, { count: 0, totalPrice: 0 });
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"));
  })();

  const addNewTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (tagUsage.some(([tag]) => tag === t)) { alert("そのタグは既に存在します"); return; }
    setTagMasterList(prev => [...prev, t]);
    setNewTag("");
  };

  const startEdit = (tag) => { setEditingTag(tag); setEditValue(tag); };
  const cancelEdit = () => { setEditingTag(null); setEditValue(""); };

  const saveEdit = (oldTag) => {
    const newName = editValue.trim();
    if (!newName) { alert("タグ名を入力してください"); return; }
    if (newName === oldTag) { cancelEdit(); return; }
    if (tagUsage.some(([t]) => t === newName)) { alert("その名前のタグは既に存在します"); return; }
    setKits(prev => prev.map(k =>
      k.tags?.includes(oldTag)
        ? { ...k, tags: k.tags.map(t => t === oldTag ? newName : t) }
        : k
    ));
    setTagMasterList(prev => prev.map(t => t === oldTag ? newName : t));
    cancelEdit();
  };

  const deleteTag = (tag, count) => {
    const msg = count > 0
      ? `タグ「${tag}」を削除しますか？\n\n${count}件のキットからも削除されます。`
      : `タグ「${tag}」を削除しますか？`;
    if (!window.confirm(msg)) return;
    setKits(prev => prev.map(k =>
      k.tags?.includes(tag)
        ? { ...k, tags: k.tags.filter(t => t !== tag) }
        : k
    ));
    setTagMasterList(prev => prev.filter(t => t !== tag));
  };

  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>🏷️ タグ編集</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>新しいタグを作成</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={{ flex: 1, border: "1.5px solid #e5e7eb", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "#111", outline: "none", minWidth: 0 }}
            placeholder="タグ名（例：プレバン限定品）"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewTag(); } }}
          />
          <button
            style={{ background: "#111", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
            onClick={addNewTag}>＋作成</button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>登録済みのタグ（{tagUsage.length}件）</div>
      {tagUsage.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", fontSize: 13, padding: "20px 0" }}>
          タグはまだありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tagUsage.map(([tag, { count, totalPrice }]) => (
            <div key={tag} style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
              {editingTag === tag ? (
                <>
                  <input
                    style={{ flex: 1, border: "1.5px solid #4f8ef7", borderRadius: 6, padding: "4px 8px", fontSize: 13, color: "#111", outline: "none", minWidth: 0 }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(tag); } else if (e.key === "Escape") cancelEdit(); }}
                    autoFocus
                  />
                  <button
                    style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                    onClick={() => saveEdit(tag)}>保存</button>
                  <button
                    style={{ background: "#fff", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                    onClick={cancelEdit}>取消</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13, color: "#111", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    #{tag}<span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{count}件{totalPrice > 0 ? ` ¥${totalPrice.toLocaleString()}` : ""}</span>
                  </span>
                  <button
                    style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                    onClick={() => startEdit(tag)}>編集</button>
                  <button
                    style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                    onClick={() => deleteTag(tag, count)}>削除</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getCondStyle(condition) {
  switch(condition) {
    case "未開封":     return { background: "#eff6ff", color: "#1d4ed8" };
    case "素組状態":   return { background: "#f0fdf4", color: "#15803d" };
    case "欠品有り":   return { background: "#fff7ed", color: "#c2410c" };
    case "制作途中":   return { background: "#fdf4ff", color: "#7e22ce" };
    default:           return { background: "#f3f4f6", color: "#374151" };
  }
}

// ---- X Share Modal ----
// ---- 画像生成ユーティリティ ----
function getScaleColor(scale) {
  if (!scale) return { bg: "#222", text: "#888" };
  if (/^HG/i.test(scale)) return { bg: "#0f2a0f", text: "#4ade80" };
  if (/^MG/i.test(scale)) return { bg: "#0f1a2a", text: "#60a5fa" };
  if (/^RG/i.test(scale)) return { bg: "#2a0f0f", text: "#f87171" };
  if (/^PG/i.test(scale)) return { bg: "#2a2a0f", text: "#facc15" };
  if (/^MGSD/i.test(scale)) return { bg: "#1a0f2a", text: "#c084fc" };
  if (/^SD/i.test(scale)) return { bg: "#2a1a0f", text: "#fb923c" };
  if (/^RE/i.test(scale)) return { bg: "#0f2a2a", text: "#34d399" };
  return { bg: "#1a1a1a", text: "#aaa" };
}

async function generateShareImages(kits, rank) {
  // 縦向き：W=1200（幅）、1枚の最大高さ=2400
  const W = 1200, COLS = 4, GAP = 2;
  const CARD_W = Math.floor((W - GAP * (COLS - 1)) / COLS); // = 299
  const CARD_H = 140;
  const HEADER_H = 90, FOOTER_H = 56;
  const MAX_H = 2400;
  const MAX_ROWS = Math.floor((MAX_H - HEADER_H - FOOTER_H) / (CARD_H + GAP));
  const PER_PAGE = MAX_ROWS * COLS;

  const pages = [];
  for (let i = 0; i < kits.length; i += PER_PAGE) {
    pages.push(kits.slice(i, i + PER_PAGE));
  }

  // 画像ロードヘルパー（外部URLはプロキシ経由 / idb-blob は IDB から取得）
  const loadImage = async (src) => {
    if (!src) return null;
    if (isIdbBlobUrl(src)) {
      const id = idbBlobUrlToId(src);
      const blob = await kitsIdbPhotoGet(id);
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      });
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      if (src.startsWith("data:")) {
        img.src = src;
      } else {
        img.crossOrigin = "anonymous";
        img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`;
      }
    });
  };

  // 全画像を事前ロード
  const imgCache = {};
  await Promise.all(kits.map(async (k) => {
    const thumb = k.completedPhotoUrl || k.photoUrl;
    if (thumb) imgCache[k.id] = await loadImage(thumb);
  }));

  const blobs = [];
  for (let p = 0; p < pages.length; p++) {
    const pageKits = pages[p];
    const rows = Math.ceil(pageKits.length / COLS);
    const H = HEADER_H + rows * (CARD_H + GAP) + FOOTER_H;

    const canvas = document.createElement("canvas");
    // 縦向き：幅W、高さH（H > W になる）
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");

    // 背景
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // ヘッダー
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, HEADER_H);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, HEADER_H - 1, W, 1);

    ctx.fillStyle = "#ff6b2b";
    ctx.font = "bold 28px 'Arial'";
    ctx.fillText("TSUMI TSUMI", 24, 34);
    ctx.fillStyle = "#555";
    ctx.font = "14px Arial";
    ctx.fillText(rank || "", 24, 58);

    // 件数
    ctx.fillStyle = "#ff6b2b";
    ctx.font = "bold 36px Arial";
    const totalText = `${kits.length}`;
    const tw = ctx.measureText(totalText).width;
    ctx.fillText(totalText, W - 24 - tw, 44);
    ctx.fillStyle = "#555";
    ctx.font = "12px Arial";
    ctx.fillText("積みプラ", W - 24 - 56, 64);

    // ページ番号
    if (pages.length > 1) {
      ctx.fillStyle = "#333";
      ctx.font = "11px Arial";
      ctx.fillText(`${p + 1} / ${pages.length}`, W / 2 - 16, 68);
    }

    // カード描画
    for (let i = 0; i < pageKits.length; i++) {
      const kit = pageKits[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * (CARD_W + GAP);
      const y = HEADER_H + row * (CARD_H + GAP);

      // カード背景
      ctx.fillStyle = "#111111";
      ctx.fillRect(x, y, CARD_W, CARD_H);

      // サムネイル
      const THUMB_W = 90, THUMB_H = 82, THUMB_X = x + 6, THUMB_Y = y + 6;
      ctx.fillStyle = "#1e1e1e";
      ctx.fillRect(THUMB_X, THUMB_Y, THUMB_W, THUMB_H);

      const imgObj = imgCache[kit.id];
      if (imgObj) {
        // アスペクト比を保ちながらセンタークロップ
        const iw = imgObj.naturalWidth, ih = imgObj.naturalHeight;
        const scale = Math.max(THUMB_W / iw, THUMB_H / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = THUMB_X + (THUMB_W - dw) / 2;
        const dy = THUMB_Y + (THUMB_H - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(THUMB_X, THUMB_Y, THUMB_W, THUMB_H);
        ctx.clip();
        ctx.drawImage(imgObj, dx, dy, dw, dh);
        ctx.restore();
      }

      // キット名
      const TEXT_X = x + 102, TEXT_Y = y + 18, TEXT_W = CARD_W - 108;
      ctx.fillStyle = "#e0e0e0";
      ctx.font = "bold 11px Arial";
      // 長いテキストを折り返す
      const name = kit.name || "";
      const words = name;
      const maxChars = Math.floor(TEXT_W / 7);
      const line1 = words.slice(0, maxChars);
      const line2 = words.length > maxChars ? words.slice(maxChars, maxChars * 2) : "";
      const line3 = words.length > maxChars * 2 ? words.slice(maxChars * 2, maxChars * 3) : "";
      ctx.fillText(line1, TEXT_X, TEXT_Y);
      if (line2) { ctx.fillStyle = "#ccc"; ctx.fillText(line2, TEXT_X, TEXT_Y + 15); }
      if (line3) { ctx.fillStyle = "#aaa"; ctx.fillText(line3, TEXT_X, TEXT_Y + 30); }

      // スケールバッジ
      if (kit.scale) {
        const { bg, text } = getScaleColor(kit.scale);
        const BADGE_Y = y + CARD_H - 30;
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(TEXT_X, BADGE_Y, 64, 20, 3);
        ctx.fill();
        ctx.fillStyle = text;
        ctx.font = "bold 11px Arial";
        ctx.fillText(kit.scale, TEXT_X + 6, BADGE_Y + 14);
      }

      // 状態
      if (kit.condition) {
        const BADGE_Y = y + CARD_H - 30;
        ctx.fillStyle = "#555";
        ctx.font = "10px Arial";
        ctx.fillText(kit.condition, TEXT_X + 70, BADGE_Y + 14);
      }

      // 区切り線
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(x + CARD_W, y, GAP, CARD_H);
      ctx.fillRect(x, y + CARD_H, CARD_W + GAP, GAP);
    }

    // フッター
    const FY = H - FOOTER_H;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, FY, W, FOOTER_H);
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, FY, W, 1);
    ctx.fillStyle = "#ff6b2b";
    ctx.font = "bold 14px Arial";
    ctx.fillText("TSUMI TSUMI", 24, FY + 30);
    ctx.fillStyle = "#333";
    ctx.font = "11px Arial";
    ctx.fillText("tsumitsumi.vercel.app", W - 200, FY + 30);

    blobs.push(await new Promise(r => canvas.toBlob(r, "image/png")));
  }
  return blobs;
}

// ---- 完成アルバム画像生成（リッチ・完成写真を大きく見せる） ----
// 表紙1枚 ＋ 2x2ショーケースページ。1080x1350(4:5)でX/Instagram映え。
async function generateAlbumImages(kits, rank, opts = {}) {
  const W = 1080, H = 1350;
  const title = (opts.title || "完成コレクション").slice(0, 24);
  // 新ロゴのブロック配色（ピラミッド型マーク描画用）
  const LOGO_BLOCKS = ["#34b3a0", "#e6b52c", "#8e54b0", "#3f6fc6", "#d75a2b", "#3aa75d"];

  const loadImage = async (src) => {
    if (!src) return null;
    if (isIdbBlobUrl(src)) {
      const id = idbBlobUrlToId(src);
      const blob = await kitsIdbPhotoGet(id);
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      });
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      if (src.startsWith("data:")) { img.src = src; }
      else { img.crossOrigin = "anonymous"; img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`; }
    });
  };

  // 完成写真を事前ロード
  const imgCache = {};
  await Promise.all(kits.map(async (k) => {
    const src = k.completedPhotoUrl || k.photoUrl;
    if (src) imgCache[k.id] = await loadImage(src);
  }));

  // 写真をセンタークロップで矩形に描く
  const drawCover = (ctx, img, dx, dy, dw, dh) => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(dw / iw, dh / ih);
    const w = iw * scale, h = ih * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
    ctx.restore();
  };

  // 新ロゴ風ブロックマーク（小さなピラミッド）を描く
  const drawLogoMark = (ctx, cx, topY, unit) => {
    const g = unit * 0.16; // gap
    const positions = [
      [0, 0],        // teal (top, centered)
      [-1, 1], [1, 1], // yellow, purple
      [-2, 2], [0, 2], [2, 2], // blue, orange, green （-2,0,2 を半ユニットずらして3個）
    ];
    // 実際の見た目: 上1・中2・下3。x位置を行ごとに中央寄せ
    const rows = [[0], [0, 1], [0, 1, 2]];
    let bi = 0;
    rows.forEach((row, r) => {
      const n = row.length;
      row.forEach((_, i) => {
        const x = cx + (i - (n - 1) / 2) * (unit + g);
        const y = topY + r * (unit * 0.62 + g);
        ctx.fillStyle = LOGO_BLOCKS[bi++ % LOGO_BLOCKS.length];
        ctx.beginPath();
        ctx.roundRect(x - unit / 2, y, unit, unit * 0.62, unit * 0.12);
        ctx.fill();
      });
    });
  };

  const blobs = [];

  // ===== 表紙 =====
  {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // 背景コラージュ（完成写真2x2を薄く）
    const bgKits = kits.filter(k => imgCache[k.id]).slice(0, 4);
    if (bgKits.length > 0) {
      const halfW = W / 2, halfH = H / 2;
      bgKits.forEach((k, i) => {
        const dx = (i % 2) * halfW, dy = Math.floor(i / 2) * halfH;
        ctx.globalAlpha = 0.22;
        drawCover(ctx, imgCache[k.id], dx, dy, halfW, halfH);
        ctx.globalAlpha = 1;
      });
      // 暗くするオーバーレイ
      ctx.fillStyle = "rgba(8,8,8,0.74)";
      ctx.fillRect(0, 0, W, H);
    }

    // ロゴマーク
    drawLogoMark(ctx, W / 2, 250, 92);
    // ブランド名
    ctx.fillStyle = "#fff";
    ctx.font = "bold 40px 'Arial'";
    ctx.textAlign = "center";
    ctx.fillText("TSUMI TSUMI", W / 2, 560);

    // タイトル
    ctx.fillStyle = "#ff6b2b";
    ctx.font = "bold 76px 'Arial'";
    ctx.fillText(title, W / 2, 700);

    // 完成数（巨大）
    const total = kits.reduce((s, k) => s + (k.count || 1), 0);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 220px 'Arial'";
    ctx.fillText(String(total), W / 2, 960);
    ctx.fillStyle = "#9ca3af";
    ctx.font = "bold 40px 'Arial'";
    ctx.fillText("体 完成", W / 2, 1030);

    // ランク称号チップ
    if (rank && rank.label) {
      ctx.font = "bold 34px 'Arial'";
      const rw = ctx.measureText(rank.label).width + 56;
      const rx = (W - rw) / 2, ry = 1090;
      ctx.fillStyle = (rank.color || "#666") + "33";
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, 64, 32);
      ctx.fill();
      ctx.fillStyle = rank.color || "#aaa";
      ctx.fillText(rank.label, W / 2, ry + 44);
    }

    // フッター
    ctx.fillStyle = "#555";
    ctx.font = "26px 'Arial'";
    ctx.fillText("tsumitsumi.vercel.app", W / 2, H - 60);
    ctx.textAlign = "left";

    blobs.push(await new Promise(r => canvas.toBlob(r, "image/png")));
  }

  // ===== ショーケース（2x2） =====
  const PER = 4;
  const HEADER = 84, FOOTER = 52, MARGIN = 24, GAP = 16;
  const cardW = Math.floor((W - MARGIN * 2 - GAP) / 2);
  const cardH = Math.floor((H - HEADER - FOOTER - MARGIN - GAP) / 2);

  const pages = [];
  for (let i = 0; i < kits.length; i += PER) pages.push(kits.slice(i, i + PER));

  for (let p = 0; p < pages.length; p++) {
    const pageKits = pages[p];
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // ヘッダー
    ctx.textAlign = "left";
    ctx.fillStyle = "#ff6b2b";
    ctx.font = "bold 34px 'Arial'";
    ctx.fillText(title, MARGIN, 54);
    ctx.fillStyle = "#555";
    ctx.font = "22px 'Arial'";
    ctx.textAlign = "right";
    ctx.fillText("TSUMI TSUMI", W - MARGIN, 54);
    if (pages.length > 1) {
      ctx.fillStyle = "#444";
      ctx.font = "20px 'Arial'";
      ctx.textAlign = "center";
      ctx.fillText(`${p + 1} / ${pages.length}`, W / 2, 54);
    }

    for (let i = 0; i < pageKits.length; i++) {
      const kit = pageKits[i];
      const col = i % 2, row = Math.floor(i / 2);
      const x = MARGIN + col * (cardW + GAP);
      const y = HEADER + row * (cardH + GAP);

      // カード台座
      ctx.fillStyle = "#161616";
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 14);
      ctx.fill();

      // 写真
      const img = imgCache[kit.id];
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cardW, cardH, 14);
      ctx.clip();
      if (img) {
        drawCover(ctx, img, x, y, cardW, cardH);
      } else {
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(x, y, cardW, cardH);
        ctx.fillStyle = "#444";
        ctx.font = "60px 'Arial'";
        ctx.textAlign = "center";
        ctx.fillText("📦", x + cardW / 2, y + cardH / 2);
      }
      // 下部グラデーション（文字可読性）
      const grad = ctx.createLinearGradient(0, y + cardH - 150, 0, y + cardH);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.82)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y + cardH - 150, cardW, 150);
      ctx.restore();

      // キット名（最大2行）
      ctx.textAlign = "left";
      ctx.fillStyle = "#fff";
      ctx.font = "bold 26px 'Arial'";
      const name = kit.name || "";
      const maxChars = Math.floor((cardW - 32) / 15);
      const l1 = name.slice(0, maxChars);
      const l2 = name.length > maxChars ? name.slice(maxChars, maxChars * 2) : "";
      // ※ スケール・評価は載せず、キット名のみ表示（ユーザー要望）
      const nameY = y + cardH - (l2 ? 40 : 18);
      ctx.fillText(l1, x + 16, nameY);
      if (l2) ctx.fillText(l2.length === maxChars && name.length > maxChars * 2 ? l2.slice(0, -1) + "…" : l2, x + 16, nameY + 28);
    }

    // フッター
    ctx.textAlign = "center";
    ctx.fillStyle = "#444";
    ctx.font = "22px 'Arial'";
    ctx.fillText("tsumitsumi.vercel.app", W / 2, H - 18);
    ctx.textAlign = "left";

    blobs.push(await new Promise(r => canvas.toBlob(r, "image/png")));
  }

  return blobs;
}

// ---- 単一キットの完成アルバム画像（最大6枚を1枚にレイアウト） ----
async function generateKitAlbumImage(kit, rank, opts = {}) {
  const W = 1080, H = 1350;
  const photos = getCompletedPhotos(kit);
  const LOGO_BLOCKS = ["#34b3a0", "#e6b52c", "#8e54b0", "#3f6fc6", "#d75a2b", "#3aa75d"];

  const loadImage = async (src) => {
    if (!src) return null;
    if (isIdbBlobUrl(src)) {
      const id = idbBlobUrlToId(src);
      const blob = await kitsIdbPhotoGet(id);
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
      });
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      if (src.startsWith("data:")) { img.src = src; }
      else { img.crossOrigin = "anonymous"; img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`; }
    });
  };
  const drawCover = (ctx, img, dx, dy, dw, dh) => {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(dw / iw, dh / ih);
    const w = iw * scale, h = ih * scale;
    ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
    ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h); ctx.restore();
  };

  const imgs = await Promise.all(photos.map(loadImage));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, H);

  // ヘッダー：ロゴブロック小マーク + ブランド
  const drawLogoMark = (cx, topY, unit) => {
    const g = unit * 0.16, rows = [[0], [0, 1], [0, 1, 2]]; let bi = 0;
    rows.forEach((row, r) => { const n = row.length; row.forEach((_, i) => {
      const x = cx + (i - (n - 1) / 2) * (unit + g); const y = topY + r * (unit * 0.62 + g);
      ctx.fillStyle = LOGO_BLOCKS[bi++ % LOGO_BLOCKS.length];
      ctx.beginPath(); ctx.roundRect(x - unit / 2, y, unit, unit * 0.62, unit * 0.12); ctx.fill();
    }); });
  };
  drawLogoMark(64, 36, 26);
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff"; ctx.font = "bold 26px 'Arial'";
  ctx.fillText("TSUMI TSUMI", 104, 64);
  ctx.fillStyle = "#22c55e"; ctx.font = "bold 22px 'Arial'";
  ctx.textAlign = "right"; ctx.fillText("✓ 完成", W - 32, 64); ctx.textAlign = "left";

  // キット名（必ず1行・収まらなければフォント縮小、それでも長ければ末尾を…で省略）
  const name = kit.name || "";
  const nameMaxW = W - 64; // 左右マージン32ずつ
  let fs = 46;
  ctx.font = `bold ${fs}px 'Arial'`;
  while (ctx.measureText(name).width > nameMaxW && fs > 20) { fs -= 2; ctx.font = `bold ${fs}px 'Arial'`; }
  let shownName = name;
  if (ctx.measureText(shownName).width > nameMaxW) {
    while (shownName.length > 1 && ctx.measureText(shownName + "…").width > nameMaxW) shownName = shownName.slice(0, -1);
    shownName += "…";
  }
  ctx.fillStyle = "#fff";
  ctx.fillText(shownName, 32, 152);
  const gridTop = 188;

  // ※ シェア画像にはスケール・評価は載せず、キット名のみ表示（ユーザー要望）

  // 写真グリッド
  const MARGIN = 32, GAP = 12, FOOTER = 56;
  const areaTop = gridTop + 14, areaH = H - areaTop - FOOTER;
  const n = imgs.length;
  const cols = n <= 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = Math.floor((W - MARGIN * 2 - GAP * (cols - 1)) / cols);
  const cellH = Math.floor((areaH - GAP * (rows - 1)) / rows);
  imgs.forEach((img, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = MARGIN + col * (cellW + GAP), y = areaTop + row * (cellH + GAP);
    ctx.fillStyle = "#161616"; ctx.beginPath(); ctx.roundRect(x, y, cellW, cellH, 12); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, cellW, cellH, 12); ctx.clip();
    if (img) drawCover(ctx, img, x, y, cellW, cellH);
    else { ctx.fillStyle = "#1e1e1e"; ctx.fillRect(x, y, cellW, cellH); ctx.fillStyle = "#444"; ctx.font = "48px 'Arial'"; ctx.textAlign = "center"; ctx.fillText("📦", x + cellW / 2, y + cellH / 2); ctx.textAlign = "left"; }
    ctx.restore();
  });

  // フッター
  ctx.textAlign = "center"; ctx.fillStyle = "#555"; ctx.font = "22px 'Arial'";
  ctx.fillText("tsumitsumi.vercel.app", W / 2, H - 18); ctx.textAlign = "left";

  return [await new Promise(r => canvas.toBlob(r, "image/png"))];
}

function XShareModal({ kits, myXId, setMyXId, onClose }) {
  const pending = kits.filter((k) => !k.completed);
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [generatedBlobs, setGeneratedBlobs] = useState([]); // 生成された画像本体（プレビュー＆個別保存用）
  const toggleSelect = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const targetKits = mode === "all" ? pending : pending.filter((k) => selected.has(k.id));
  const totalPages = Math.max(1, Math.ceil(targetKits.length / 68));

  const buildTweet = () => {
    const id = myXId.trim().replace(/^@/, "");
    const idLine = id ? `DM→ @${id}

` : "";
    return `積みプラ ${targetKits.length}件 を公開中！

${idLine}#積みプラ #ツミツミ #TSUMITSUMI`;
  };

  // モバイル判定（iOS Safari では <a download> がプレビュー画面を開き、戻ると LP に飛ぶ問題を回避）
  const isMobileShare = typeof navigator !== "undefined" && /iPad|iPhone|iPod|Android/i.test(navigator.userAgent || "");
  // ネイティブ共有（Web Share API）対応判定
  const canNativeShareImages = typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";

  const [generatedDataUrls, setGeneratedDataUrls] = useState([]); // プレビュー用 data URL（blob URL より iOS で確実に表示される）
  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });

  const handleGenerateImages = async () => {
    setGenerating(true);
    setGeneratedCount(0);
    setGeneratedBlobs([]);
    setGeneratedDataUrls([]);
    try {
      const blobs = await generateShareImages(targetKits, "");
      setGeneratedCount(blobs.length);
      setGeneratedBlobs(blobs);
      // プレビュー用 data URL を生成（iOS Safari で blob URL が無効化される問題を回避）
      const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
      setGeneratedDataUrls(dataUrls);
      // 自動ダウンロードはデスクトップのみ。iOS Safari では <a download> が PNGプレビュー画面を開き、
      // 戻るボタンを押すと LP に飛んでしまう不具合があるため、モバイルではユーザー操作で保存してもらう。
      if (!isMobileShare && blobs.length > 0) {
        const url = URL.createObjectURL(blobs[0]);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tsumitsumi_01.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      alert("画像生成エラー: " + e.message);
    }
    setGenerating(false);
  };

  // 全画像をまとめてシェア（X等を選択）
  const handleNativeShare = async () => {
    if (generatedBlobs.length === 0) return;
    try {
      const files = generatedBlobs.map((b, i) => new File([b], `tsumitsumi_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      if (navigator.canShare && !navigator.canShare({ files })) {
        alert("このブラウザは画像の共有に対応していません。下の「保存」ボタンで個別に保存してください。");
        return;
      }
      await navigator.share({
        files,
        title: "TSUMITSUMI 積みプラ",
        text: buildTweetForImage(targetKits.length, generatedBlobs.length),
      });
    } catch (e) {
      if (e && e.name !== "AbortError") alert("共有に失敗しました: " + (e.message || e));
    }
  };

  // 個別画像をシェア（iOS では「写真に保存」を共有シートから選択 → プレビュー画面を経由しない）
  const handleSaveOne = async (index) => {
    const blob = generatedBlobs[index];
    if (!blob) return;
    const filename = `tsumitsumi_${String(index + 1).padStart(2, "0")}.png`;
    const file = new File([blob], filename, { type: "image/png" });
    // Web Share API 対応端末では共有シート経由で保存（iOS なら「画像を保存」が選べる）
    if (canNativeShareImages && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    // フォールバック: 旧来のダウンロード（デスクトップ用）
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const buildTweetForImage = (count, pages) => {
    const id = myXId.trim().replace(/^@/, "");
    const idLine = id ? `
DM→ @${id}` : "";
    const pageNote = pages > 1 ? `（全${pages}枚）` : "";
    return `積みプラ ${count}件 を公開中！${pageNote}${idLine}

#積みプラ #ツミツミ #TSUMITSUMI`;
  };

  return (
    <div style={xs.wrap}>
      <div style={xs.header}><span style={xs.title}>𝕏 積みプラをシェア</span><button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button></div>
      {pending.length === 0 ? <div style={xs.empty}>積みプラが登録されていません</div> : (<>
        <label style={xs.label}>あなたのX ID（省略可）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <span style={{ color: "#9ca3af", fontSize: 16 }}>@</span>
          <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none" }}
            placeholder="your_x_id" value={myXId} onChange={(e) => setMyXId(e.target.value.replace(/^@/, ""))} />
        </div>
        <div style={xs.modeRow}>
          <button style={{ ...xs.modeBtn, ...(mode === "all" ? xs.modeBtnActive : {}) }} onClick={() => setMode("all")}>全部シェア</button>
          <button style={{ ...xs.modeBtn, ...(mode === "select" ? xs.modeBtnActive : {}) }} onClick={() => setMode("select")}>選んでシェア</button>
        </div>
        {mode === "select" && (
          <div style={xs.kitList}>
            {pending.map((k) => (
              <div key={k.id} style={{ ...xs.kitRow, background: selected.has(k.id) ? "#f0fdf4" : "#fafafa", border: `1.5px solid ${selected.has(k.id) ? "#22c55e" : "#e5e7eb"}` }} onClick={() => toggleSelect(k.id)}>
                <div style={{ ...xs.checkbox, background: selected.has(k.id) ? "#22c55e" : "#fff", border: `2px solid ${selected.has(k.id) ? "#22c55e" : "#d1d5db"}` }}>
                  {selected.has(k.id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
                {(k.completedPhotoUrl || k.photoUrl) && <KitImage src={k.completedPhotoUrl || k.photoUrl} style={xs.kitThumb} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={xs.kitName}>{k.name}</div>
                  <div style={xs.kitMeta}>{k.scale || ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 画像生成セクション */}
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>画像を生成してシェア</div>
          <div style={{ fontSize: 11, color: "#166534", marginBottom: 10 }}>
            {targetKits.length}件 → 画像{totalPages}枚（1枚あたり最大68件）
          </div>
          <button style={{ width: "100%", padding: "12px 0", background: generating ? "#d1d5db" : "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: generating ? "default" : "pointer" }}
            onClick={handleGenerateImages} disabled={generating}>
            {generating ? "生成中..." : `画像を生成してダウンロード（${totalPages}枚）`}
          </button>
          {generatedCount > 0 && (
            <div style={{ marginTop: 10, background: "#dcfce7", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
                {generatedCount}枚の画像を生成しました
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7, marginBottom: 10 }}>
                📱 <b>スマホの方</b>：各画像の下の「💾 保存」ボタンで共有メニューから「画像を保存」を選んでください。<br/>
                💻 <b>PCの方</b>：1枚目は自動ダウンロード済み。残りは「💾 保存」ボタンで個別に保存できます。
              </div>
              {canNativeShareImages && (
                <button onClick={handleNativeShare}
                  style={{ display: "block", width: "100%", padding: "13px 0", marginBottom: 10, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                  📤 全画像をまとめて共有（X等を選択）
                </button>
              )}
              {/* 各ページのプレビュー＋個別保存（data URL 利用で iOS でも確実に表示） */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {generatedDataUrls.map((url, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginBottom: 6 }}>画像 {i + 1} / {generatedDataUrls.length}</div>
                    <img src={url} alt={`page ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 4, marginBottom: 6 }} />
                    <button onClick={() => handleSaveOne(i)}
                      style={{ display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: "center", cursor: "pointer", boxSizing: "border-box" }}>
                      💾 画像 {i + 1} を保存
                    </button>
                  </div>
                ))}
              </div>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweetForImage(targetKits.length, generatedCount))}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "13px 0", background: "#000", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
                𝕏 Xを開いて投稿する（保存した画像を添付）
              </a>
            </div>
          )}
        </div>

        {/* テキストのみ投稿 */}
        <button style={{ width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweet())}`, "_blank")}>
          𝕏 テキストのみ投稿
        </button>
      </>)}
      {/* 広告（運営費補填用・AdSense審査中は ADS_ENABLED=false で非表示） */}
      {ADS_ENABLED && (
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>広告</div>
          <iframe src="/admax-banner.html" title="ad" loading="lazy" width="320" height="100" frameBorder="0" scrolling="no" style={{ border: "none", display: "inline-block", maxWidth: "100%" }} />
        </div>
      )}
    </div>
  );
}

// ---- 完成アルバム シェアモーダル（リッチ画像型・サーバー保存なし） ----
function AlbumShareModal({ kits, rank, myXId, setMyXId, onClose, singleKit = null }) {
  const isSingle = !!singleKit;
  const completed = kits.filter((k) => k.completed);
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState("all");
  const [title, setTitle] = useState(isSingle ? (singleKit.name || "完成品") : "完成コレクション");
  const [generating, setGenerating] = useState(false);
  const [generatedBlobs, setGeneratedBlobs] = useState([]);
  const [generatedDataUrls, setGeneratedDataUrls] = useState([]);
  const toggleSelect = (id) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const targetKits = isSingle ? [singleKit] : (mode === "all" ? completed : completed.filter((k) => selected.has(k.id)));
  const totalCount = targetKits.reduce((s, k) => s + (k.count || 1), 0);
  const singlePhotoCount = isSingle ? getCompletedPhotos(singleKit).length : 0;
  const totalPages = isSingle ? 1 : 1 + Math.max(0, Math.ceil(targetKits.length / 4)); // 表紙 + ショーケース

  const isMobileShare = typeof navigator !== "undefined" && /iPad|iPhone|iPod|Android/i.test(navigator.userAgent || "");
  const canNativeShareImages = typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";

  const buildTweet = () => {
    const id = myXId.trim().replace(/^@/, "");
    const idLine = id ? `DM→ @${id}\n\n` : "";
    if (isSingle) {
      const grade = singleKit.scale ? `（${singleKit.scale}）` : "";
      return `完成しました！🎉\n${singleKit.name}${grade}\n\n${idLine}#完成 #ガンプラ #プラモ完成 #ツミツミ #TSUMITSUMI`;
    }
    const rankLine = rank && rank.label ? `称号: ${rank.label}\n` : "";
    return `完成したプラモを公開！🎉\n完成 ${totalCount}体\n${rankLine}${idLine}#完成 #ガンプラ #プラモ完成 #ツミツミ #TSUMITSUMI`;
  };

  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });

  const handleGenerate = async () => {
    setGenerating(true);
    setGeneratedBlobs([]);
    setGeneratedDataUrls([]);
    try {
      const blobs = isSingle
        ? await generateKitAlbumImage(singleKit, rank, {})
        : await generateAlbumImages(targetKits, rank, { title });
      setGeneratedBlobs(blobs);
      const dataUrls = await Promise.all(blobs.map(blobToDataUrl));
      setGeneratedDataUrls(dataUrls);
      if (!isMobileShare && blobs.length > 0) {
        const url = URL.createObjectURL(blobs[0]);
        const a = document.createElement("a");
        a.href = url; a.download = `tsumitsumi_album_01.png`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      alert("画像生成エラー: " + e.message);
    }
    setGenerating(false);
  };

  const handleNativeShare = async () => {
    if (generatedBlobs.length === 0) return;
    try {
      const files = generatedBlobs.map((b, i) => new File([b], `tsumitsumi_album_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      if (navigator.canShare && !navigator.canShare({ files })) {
        alert("このブラウザは画像の共有に対応していません。下の「保存」ボタンで個別に保存してください。");
        return;
      }
      await navigator.share({ files, title: "TSUMITSUMI 完成アルバム", text: buildTweet() });
    } catch (e) {
      if (e && e.name !== "AbortError") alert("共有に失敗しました: " + (e.message || e));
    }
  };

  const handleSaveOne = async (index) => {
    const blob = generatedBlobs[index];
    if (!blob) return;
    const file = new File([blob], `tsumitsumi_album_${String(index + 1).padStart(2, "0")}.png`, { type: "image/png" });
    if (canNativeShareImages && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={xs.wrap}>
      <div style={xs.header}><span style={xs.title}>{isSingle ? "📸 完成品をシェア" : "📸 完成アルバムをシェア"}</span><button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button></div>
      {!isSingle && completed.length === 0 ? (
        <div style={xs.empty}>完成済みのキットがありません。<br/>キットを「完成済み」にすると、完成写真でリッチなアルバムを作れます。</div>
      ) : (<>
        {isSingle ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10 }}>
            {getCompletedPhotos(singleKit)[0] && <KitImage src={getCompletedPhotos(singleKit)[0]} style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{singleKit.name}</div>
              <div style={{ fontSize: 11, color: "#166534" }}>完成写真 {singlePhotoCount} 枚を1枚の画像にまとめます</div>
            </div>
          </div>
        ) : (<>
          <label style={xs.label}>アルバムのタイトル</label>
          <input style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none", marginBottom: 14, boxSizing: "border-box" }}
            placeholder="完成コレクション" value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} />
        </>)}

        <label style={xs.label}>あなたのX ID（省略可）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <span style={{ color: "#9ca3af", fontSize: 16 }}>@</span>
          <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none" }}
            placeholder="your_x_id" value={myXId} onChange={(e) => setMyXId(e.target.value.replace(/^@/, ""))} />
        </div>
        {!isSingle && (
        <div style={xs.modeRow}>
          <button style={{ ...xs.modeBtn, ...(mode === "all" ? xs.modeBtnActive : {}) }} onClick={() => setMode("all")}>全部アルバム化</button>
          <button style={{ ...xs.modeBtn, ...(mode === "select" ? xs.modeBtnActive : {}) }} onClick={() => setMode("select")}>選んで作成</button>
        </div>
        )}
        {!isSingle && mode === "select" && (
          <div style={xs.kitList}>
            {completed.map((k) => (
              <div key={k.id} style={{ ...xs.kitRow, background: selected.has(k.id) ? "#f0fdf4" : "#fafafa", border: `1.5px solid ${selected.has(k.id) ? "#22c55e" : "#e5e7eb"}` }} onClick={() => toggleSelect(k.id)}>
                <div style={{ ...xs.checkbox, background: selected.has(k.id) ? "#22c55e" : "#fff", border: `2px solid ${selected.has(k.id) ? "#22c55e" : "#d1d5db"}` }}>
                  {selected.has(k.id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
                {(k.completedPhotoUrl || k.photoUrl) && <KitImage src={k.completedPhotoUrl || k.photoUrl} style={xs.kitThumb} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={xs.kitName}>{k.name}</div>
                  <div style={xs.kitMeta}>{k.scale || ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>完成写真でアルバムを生成</div>
          <div style={{ fontSize: 11, color: "#166534", marginBottom: 10 }}>
            {isSingle
              ? `完成写真 ${singlePhotoCount}枚 → 1枚の画像にまとめます`
              : `${targetKits.length}件 → 表紙＋ショーケース 計${totalPages}枚（1ページ4件・完成写真を大きく表示）`}
          </div>
          <button style={{ width: "100%", padding: "12px 0", background: (generating || targetKits.length === 0) ? "#d1d5db" : "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: (generating || targetKits.length === 0) ? "default" : "pointer" }}
            onClick={handleGenerate} disabled={generating || targetKits.length === 0}>
            {generating ? "生成中..." : (isSingle ? "画像を生成" : `アルバム画像を生成（${totalPages}枚）`)}
          </button>
          {generatedBlobs.length > 0 && (
            <div style={{ marginTop: 10, background: "#dcfce7", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
                {generatedBlobs.length}枚のアルバム画像を生成しました
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7, marginBottom: 10 }}>
                📱 <b>スマホの方</b>：各画像の「💾 保存」ボタンで共有メニューから「画像を保存」を選んでください。<br/>
                💻 <b>PCの方</b>：1枚目は自動ダウンロード済み。残りは「💾 保存」で個別に保存できます。
              </div>
              {canNativeShareImages && (
                <button onClick={handleNativeShare}
                  style={{ display: "block", width: "100%", padding: "13px 0", marginBottom: 10, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                  📤 全画像をまとめて共有（X等を選択）
                </button>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {generatedDataUrls.map((url, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 8, padding: 8 }}>
                    <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginBottom: 6 }}>{i === 0 ? "表紙" : `ショーケース ${i}`} / 全{generatedDataUrls.length}枚</div>
                    <img src={url} alt={`album ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 4, marginBottom: 6 }} />
                    <button onClick={() => handleSaveOne(i)}
                      style={{ display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, textAlign: "center", cursor: "pointer", boxSizing: "border-box" }}>
                      💾 この画像を保存
                    </button>
                  </div>
                ))}
              </div>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweet())}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "13px 0", background: "#000", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
                𝕏 Xを開いて投稿する（保存した画像を添付）
              </a>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

// ---- 完成品アルバム ビューア（最大6枚のギャラリー・ライトボックス） ----
function AlbumViewerModal({ kit, onClose, onShare, onEdit, onUncomplete }) {
  const photos = getCompletedPhotos(kit);
  const [idx, setIdx] = useState(0);
  if (photos.length === 0) {
    return (
      <div style={xs.wrap}>
        <div style={xs.header}><span style={{ ...xs.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kit.name}</span><button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button></div>
        <div style={xs.empty}>完成写真がまだありません。<br/>キットを編集して完成写真を登録してください。</div>
        {onEdit && (
          <button onClick={() => onEdit(kit)}
            style={{ width: "100%", marginTop: 14, padding: "12px 0", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            ✏️ 編集して完成写真を追加
          </button>
        )}
        {onUncomplete && (
          <button onClick={() => onUncomplete(kit)}
            style={{ width: "100%", marginTop: 10, padding: "10px 0", background: "#fff", color: "#6b7280", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            ↩️ 完成を解除
          </button>
        )}
      </div>
    );
  }
  const safeIdx = Math.min(idx, photos.length - 1);
  const cur = photos[safeIdx];
  const go = (d) => setIdx((i) => (Math.min(i, photos.length - 1) + d + photos.length) % photos.length);
  return (
    <div style={xs.wrap}>
      <div style={xs.header}>
        <span style={{ ...xs.title, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kit.name}</span>
        <button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button>
      </div>
      {/* メイン写真（縦長端末でも溢れないよう高さ制限） */}
      <div style={{ position: "relative", width: "100%", background: "#0a0a0a", borderRadius: 12, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1/1", maxHeight: "40vh" }}>
        <KitImage src={cur} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        {photos.length > 1 && (<>
          <button onClick={() => go(-1)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 20, cursor: "pointer" }}>‹</button>
          <button onClick={() => go(1)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 20, cursor: "pointer" }}>›</button>
          <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20 }}>{safeIdx + 1} / {photos.length}</div>
        </>)}
      </div>
      {/* サムネイルストリップ */}
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
          {photos.map((url, i) => (
            <div key={i} onClick={() => setIdx(i)}
              style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 8, overflow: "hidden", border: `2px solid ${i === safeIdx ? "#22c55e" : "#e5e7eb"}`, cursor: "pointer" }}>
              <KitImage src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      )}
      {/* メタ情報（★は完成品では非表示） */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {kit.scale && <span style={{ fontSize: 12, fontWeight: 700, background: "#f3f4f6", color: "#374151", borderRadius: 20, padding: "3px 10px" }}>{kit.scale}</span>}
        {kit.series && <span style={{ fontSize: 12, color: "#9ca3af" }}>{kit.series}</span>}
      </div>
      {/* 操作ボタン：編集（写真の追加削除・各項目）／シェア */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {onEdit && (
          <button onClick={() => onEdit(kit)}
            style={{ flex: 1, padding: "12px 0", background: "#f3f4f6", color: "#111", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            ✏️ 編集
          </button>
        )}
        {onShare && (
          <button onClick={() => onShare(kit)}
            style={{ flex: 1, padding: "12px 0", background: "#000", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            📸 シェア
          </button>
        )}
      </div>
      {onUncomplete && (
        <button onClick={() => onUncomplete(kit)}
          style={{ width: "100%", marginTop: 10, padding: "10px 0", background: "#fff", color: "#6b7280", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          ↩️ 完成を解除
        </button>
      )}
    </div>
  );
}

const xs = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 32px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "#f3f4f6", border: "1.5px solid #e5e7eb", fontSize: 14, fontWeight: 700, cursor: "pointer", color: "#111", padding: "10px 18px", borderRadius: 22, minHeight: 40, whiteSpace: "nowrap" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 },
  empty: { textAlign: "center", color: "#bbb", padding: "32px 0", fontSize: 14 },
  modeRow: { display: "flex", gap: 8, marginBottom: 14 },
  modeBtn: { flex: 1, padding: "8px 0", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#6b7280" },
  modeBtnActive: { background: "#111", color: "#fff", border: "1.5px solid #111" },
  kitList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, maxHeight: 220, overflowY: "auto" },
  kitRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer" },
  checkbox: { width: 20, height: 20, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  kitThumb: { width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 },
  kitName: { fontSize: 13, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  kitMeta: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  previewBox: { background: "#f8f9fa", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  previewLabel: { fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 6 },
  previewText: { fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", lineHeight: 1.6 },
  tweetBtn: { width: "100%", padding: "14px 0", background: "#000", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" },
};

// ---- Price Report Modal ----
const REPORT_RATE_LIMIT_KEY = "tsumitsumi_report_history";
const REPORT_RATE_LIMIT_MAX = 5;
const REPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkReportRateLimit() {
  try {
    const raw = localStorage.getItem(REPORT_RATE_LIMIT_KEY);
    const history = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const recent = history.filter(t => (now - t) < REPORT_RATE_LIMIT_WINDOW_MS);
    return { allowed: recent.length < REPORT_RATE_LIMIT_MAX, recentCount: recent.length, recent };
  } catch {
    return { allowed: true, recentCount: 0, recent: [] };
  }
}

function recordReportSent() {
  try {
    const { recent } = checkReportRateLimit();
    const updated = [...recent, Date.now()];
    localStorage.setItem(REPORT_RATE_LIMIT_KEY, JSON.stringify(updated));
  } catch {}
}

function PriceReportModal({ target, onClose }) {
  const [reportedPrice, setReportedPrice] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  if (!target) return null;
  const currentPrice = target.retailPrice ? parseInt(target.retailPrice) : (target.price ? parseInt(target.price) : null);

  const handleSubmit = async () => {
    setErrMsg("");
    const { allowed, recentCount } = checkReportRateLimit();
    if (!allowed) {
      setErrMsg(`報告が多すぎます。少し時間を置いてからお試しください(直近1分間に${recentCount}件)。`);
      return;
    }
    const priceTrimmed = (reportedPrice || "").toString().trim();
    const commentTrimmed = (comment || "").trim();
    if (!priceTrimmed && !commentTrimmed) {
      setErrMsg("正しい価格またはコメントのどちらかを入力してください。");
      return;
    }
    let priceNum = null;
    if (priceTrimmed) {
      priceNum = parseInt(priceTrimmed.replace(/[^0-9]/g, ""), 10);
      if (isNaN(priceNum) || priceNum < 0 || priceNum > 9999999) {
        setErrMsg("価格は0〜9,999,999の数値で入力してください。");
        return;
      }
    }
    if (commentTrimmed.length > 200) {
      setErrMsg("コメントは200文字以内にしてください。");
      return;
    }
    // 「変更がないと報告できない」バリデーション:
    // 報告された価格が現在の価格と同じ&コメントなしの場合はNG
    if (priceNum != null && currentPrice != null && priceNum === currentPrice && !commentTrimmed) {
      setErrMsg("現在の価格と同じです。価格を変更するか、コメントで補足情報を入力してください。");
      return;
    }

    setSubmitting(true);
    try {
      const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
      const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
      let productId = null;
      if (target.jan) {
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/products?jan=eq.${encodeURIComponent(target.jan)}&select=id&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
          if (r.ok) {
            const arr = await r.json();
            if (Array.isArray(arr) && arr.length > 0) productId = arr[0].id;
          }
        } catch {}
      }
      const body = {
        product_id: productId,
        jan: target.jan || null,
        product_name: target.name || null,
        current_price: currentPrice,
        reported_price: priceNum,
        comment: commentTrimmed || null,
        status: "pending"
      };
      const res = await fetch(`${SUPABASE_URL}/rest/v1/price_reports`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      recordReportSent();
      setDone(true);
      setTimeout(() => { onClose(); }, 2000);
    } catch (e) {
      setErrMsg("送信に失敗しました: " + (e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.formModal} onClick={(e) => e.stopPropagation()}>
        <div style={s.formTitle}>⚠️ 情報の誤りを報告</div>
        {done ? (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#111" }}>ご報告ありがとうございました</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>運営にて確認いたします</div>
          </div>
        ) : (
          <>
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
              {target.photoUrl ? (
                <KitImage src={target.photoUrl} style={{ width: 50, height: 50, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 50, height: 50, borderRadius: 6, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 22 }}>📦</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#111", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{target.name || "(商品名不明)"}</div>
                <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
                  {target.jan ? `JAN: ${target.jan}` : "JANなし"}
                  {currentPrice ? ` ・ 現在の価格: ¥${currentPrice.toLocaleString()}` : " ・ 価格未設定"}
                </div>
              </div>
            </div>
            {(target.jan || target.name) && (
              <button
                type="button"
                style={{ width: "100%", padding: "10px 0", marginBottom: 14, background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => {
                  const q = `${target.jan || target.name || ""} 希望小売価格`.trim();
                  window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
                }}>
                🔍 Webで検索（JAN＋希望小売価格）
              </button>
            )}
            <label style={s.label}>正しい価格(税込)<span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>※どちらか必須</span></label>
            <input style={s.input} placeholder="例: 7700" inputMode="numeric" value={reportedPrice} onChange={(e) => setReportedPrice(e.target.value.replace(/[^0-9]/g, ""))} />
            <label style={s.label}>コメント(任意・200文字以内)</label>
            <textarea style={{ ...s.input, minHeight: 70, fontFamily: "inherit", resize: "vertical" }} placeholder="情報源(公式サイト等)・補足情報など" value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} />
            <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "right", marginTop: 2 }}>{comment.length}/200</div>
            {errMsg && (<div style={{ marginTop: 10, padding: "8px 12px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: 12 }}>{errMsg}</div>)}
            <div style={s.formBtns}>
              <button style={s.cancelBtn} onClick={onClose} disabled={submitting}>キャンセル</button>
              <button style={s.saveBtn} onClick={handleSubmit} disabled={submitting}>{submitting ? "送信中..." : "📤 報告を送信"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Main App ----
export default function App() {
  const [kits, setKits] = useState(() => {
    try { const s = localStorage.getItem("tsumitsumi_kits"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  // Phase 4 修正: IDB からの読込（hydration）が完了するまで保存しない。
  // localStorage は 5MB 上限で肥大化データを保持できず、起動時の lazy init は
  // 不完全な古いスナップショットになり得る。それを IDB に書き戻すと正データを
  // 破壊するため、IDB load 完了まで両方の保存をスキップする（CLAUDE.md §14）。
  const hydratedRef = useRef(false);
  // hydrated: IDB 読込完了フラグ（UI 制御用）。完了までローディング表示にし、
  // localStorage 由来の古いスナップショットが一瞬チラつくのを防ぐ。
  const [hydrated, setHydrated] = useState(false);
  // Phase 4.B: localStorage は best-effort のキャッシュ扱い。失敗は黙殺（IDB が主保存先）
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem("tsumitsumi_kits", JSON.stringify(kits)); } catch (e) {}
  }, [kits]);
  // Phase 4.B: kits の主保存先は IDB。localStorage の 5MB を超えても問題なし
  useEffect(() => {
    if (!hydratedRef.current) return;
    kitsIdbSave(kits);
  }, [kits]);

  // Phase 4.A: マルチタブ同期。BroadcastChannel で他タブの kits 変更を受信し IDB から再読込
  // - suppressBroadcastRef: 受信時の setKits で再ブロードキャストするのを防ぐ（無限ループ防止）
  // - 初回マウントの save effect 発火もスキップ（最初の load と被るため）
  const suppressBroadcastRef = useRef(true);
  const broadcastChannelRef = useRef(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('tsumitsumi-kits');
    ch.onmessage = async (ev) => {
      if (ev && ev.data && ev.data.type === 'kits-changed') {
        const fresh = await kitsIdbLoad();
        if (Array.isArray(fresh)) {
          suppressBroadcastRef.current = true;
          setKits(fresh);
        }
      }
    };
    broadcastChannelRef.current = ch;
    return () => {
      try { ch.close(); } catch (e) {}
      broadcastChannelRef.current = null;
    };
  }, []);
  useEffect(() => {
    const wasSuppressed = suppressBroadcastRef.current;
    suppressBroadcastRef.current = false;
    if (wasSuppressed) return;
    try { broadcastChannelRef.current?.postMessage({ type: 'kits-changed' }); } catch (e) {}
  }, [kits]);

  // Phase 2: マウント時に IDB から読み込み、データがあれば state を上書き。
  // - lazy init で localStorage から即時表示済みなので「真っ白」は起きない
  // - IDB が空（初回・破損・プライベートモード等）なら何もしない → localStorage の状態を維持
  // - IDB に有効なデータがある場合のみ setKits で上書き（Phase 3 以降の dual-write を見越したもの）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const idbKits = await kitsIdbLoad();
      if (cancelled) return;
      if (idbKits && idbKits.length > 0) {
        setKits(idbKits);
      }
      // 読込完了（IDB が空・破損・エラーでも）→ 以降の保存を解禁。
      // これより前に保存が走ると localStorage 由来の不完全 state で IDB を壊す。
      hydratedRef.current = true;
      setHydrated(true);
    })();
    // 安全弁: IDB がハングしても3秒で読込完了扱いにし、無限ローディングを防ぐ
    const fallbackTimer = setTimeout(() => {
      if (!cancelled && !hydratedRef.current) {
        hydratedRef.current = true;
        setHydrated(true);
      }
    }, 3000);
    return () => { cancelled = true; clearTimeout(fallbackTimer); };
  }, []);

  // 永続化ストレージ要求：iOS Safari は使われていないサイトの IndexedDB を
  // 約7日で勝手に削除する仕様があり、キットの参考画像（idb-blob:）が消えて
  // 📦 プレースホルダだけ残る現象の原因になる。ホーム画面追加済みの PWA や
  // 高エンゲージメントのサイトは自動で許可されるため、プロンプトは通常出ない。
  // 失敗・未対応ブラウザでは何も起こらない（=既存挙動と同じ）。
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return;
    (async () => {
      try {
        // 既に永続化済みなら再要求しない
        if (typeof navigator.storage.persisted === 'function') {
          const already = await navigator.storage.persisted();
          if (already) return;
        }
        await navigator.storage.persist();
      } catch {}
    })();
  }, []);

  // 希望小売価格が未取得のキットにバックグラウンドで自動取得
  // 注意:マスタDBからのみ取得する。Yahooからの自動取得は転売価格混入のため行わない
  //
  // Vercel Function 消費を抑えるため以下の制限を入れる:
  //   - 試行履歴を localStorage に保存し、30日以内に試した JAN は再試行しない
  //   - 1セッションあたり最大 5 件まで
  //   - 既に retailPrice ありのキットは触らない（ユーザーが意図的に空にしたものを上書きしない）
  useEffect(() => {
    if (priceLoading) return; // 一括取得中はバックグラウンド取得しない
    const PRICE_ATTEMPTED_KEY = "tsumitsumi_price_attempted";
    const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30日
    const PER_SESSION = 5;
    let attempted = {};
    try { attempted = JSON.parse(localStorage.getItem(PRICE_ATTEMPTED_KEY) || "{}") || {}; } catch {}
    const now = Date.now();
    const targets = kits.filter(k => {
      if (!k.jan || k.retailPrice) return false;
      const ts = attempted[k.jan];
      return !ts || (now - ts) > RETRY_AFTER_MS;
    }).slice(0, PER_SESSION);
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const kit of targets) {
        if (cancelled) break;
        try {
          const r = await fetch(`/api/price?jan=${kit.jan}`);
          const d = await r.json();
          if (d && d.price && !cancelled) {
            setKits(prev => prev.map(k => k.id === kit.id ? { ...k, retailPrice: String(d.price) } : k));
          }
        } catch {}
        attempted[kit.jan] = Date.now(); // 成否問わず試行時刻を記録
        await new Promise(r => setTimeout(r, 300));
      }
      if (!cancelled) {
        try { localStorage.setItem(PRICE_ATTEMPTED_KEY, JSON.stringify(attempted)); } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, []); // 初回マウント時のみ

  useEffect(() => {
    // HelpModal内の「すべて見る」ボタンから呼ばれる
    window.__showAllVersions = () => setShowAllVersions(true);
    return () => { delete window.__showAllVersions; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jan = params.get("jan");
    if (jan && jan.length >= 8) {
      window.history.replaceState({}, "", window.location.pathname);
      handleJanDetected(jan);
    }
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showAlbum, setShowAlbum] = useState(false);
  const [albumKit, setAlbumKit] = useState(null); // 完成品アルバムビューアで開いているキット
  const [shareKit, setShareKit] = useState(null); // 単一キットの完成品シェア対象
  const [myXId, setMyXId] = useState("");
  const [filterSeries, setFilterSeries] = useState("");
  const [filterRating, setFilterRating] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false); // "privacy" | "terms" | null
  const [filterCondition, setFilterCondition] = useState("");
  const [filterTags, setFilterTags] = useState([]); // 選択中のタグ
  const [filterScale, setFilterScale] = useState("");
  const [showAppShare, setShowAppShare] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [theme, setTheme] = useState("light");
  const [reportTarget, setReportTarget] = useState(null);
  const [continuousScan, setContinuousScan] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false); // 一括取得中フラグ
  const [priceProgress, setPriceProgress] = useState({ current: 0, total: 0 }); // 進捗
  const [imageResetLoading, setImageResetLoading] = useState(false);
  const [imageResetProgress, setImageResetProgress] = useState({ current: 0, total: 0 });
  // Phase 4.C.3: 既存 base64 写真を Blob 化するマイグレ用
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState({ current: 0, total: 0 });
  const [showPriceTotal, setShowPriceTotal] = useState(() => {
    try { return localStorage.getItem("tsumitsumi_showPrice") !== "false"; } catch { return true; }
  });
  // 設定変更時にlocalStorageへ保存
  useEffect(() => {
    try { localStorage.setItem("tsumitsumi_showPrice", showPriceTotal ? "true" : "false"); } catch {}
  }, [showPriceTotal]);
  const [continuousQueue, setContinuousQueue] = useState([]); // 連続スキャンキュー
  // 重複JAN確認モーダル（window.confirm の代替）
  // window.confirm は iOS Safari でスキャナーの <video> を巻き込んで固まる事故が多い。
  // React 制御のモーダルにして「ダイアログを閉じる→カメラ復帰」を確実にする。
  const [dupConfirm, setDupConfirm] = useState(null); // { kit, where, message } | null
  const dupResolveRef = useRef(null);
  const askDuplicateConfirm = ({ kit, where }) => {
    return new Promise((resolve) => {
      dupResolveRef.current = resolve;
      setDupConfirm({ kit, where });
    });
  };
  const resolveDup = (answer) => {
    const fn = dupResolveRef.current;
    dupResolveRef.current = null;
    setDupConfirm(null);
    fn?.(answer);
  };
  const [searchInput, setSearchInput] = useState(""); // 入力欄の即時値（タイピング応答性のため）
  const [searchQuery, setSearchQuery] = useState(""); // フィルタ実行用のdebounce後の値
  // 250ms debounce: 入力停止後にだけ filter を走らせる（大量キットでも入力遅延しない）
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [reorderMode, setReorderMode] = useState(false);
  const [viewMode, setViewMode] = useState("list");
  const [sortKey, setSortKey] = useState("date"); // name | date | purchaseDate
  const [sortDir, setSortDir] = useState("desc");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [tagMasterList, setTagMasterList] = useState(() => []);
  const fileRef = useRef();
  const completedFileRef = useRef();
  // バーコード連続スキャンの再読み込みループ防止（同一JANを5秒以内に再検出した場合は無視）
  const recentlyScannedJanRef = useRef({ jan: '', ts: 0 });

  // 表示設定（並び順・昇降・表示モード）の永続化
  // マウント時に1度だけlocalStorageから読み込み
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tsumitsumi_view_settings") || "{}");
      if (["list", "grid"].includes(saved.viewMode)) setViewMode(saved.viewMode);
      if (["name", "date", "purchaseDate"].includes(saved.sortKey)) setSortKey(saved.sortKey);
      if (["asc", "desc"].includes(saved.sortDir)) setSortDir(saved.sortDir);
    } catch { /* ignore */ }
  }, []);
  // 値が変わったらlocalStorageに保存（初回マウント時はスキップ）
  const isViewSettingsInitial = useRef(true);
  useEffect(() => {
    if (isViewSettingsInitial.current) {
      isViewSettingsInitial.current = false;
      return;
    }
    try {
      localStorage.setItem("tsumitsumi_view_settings", JSON.stringify({ viewMode, sortKey, sortDir }));
    } catch { /* ignore */ }
  }, [viewMode, sortKey, sortDir]);

  // タグマスター（ユーザー定義タグ一覧）の永続化
  // マウント時に1度だけlocalStorageから読み込み
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("tsumitsumi_tag_master") || "[]");
      if (Array.isArray(saved)) setTagMasterList(saved);
    } catch { /* ignore */ }
  }, []);
  // 値が変わったらlocalStorageに保存（初回マウント時はスキップ）
  const isTagMasterInitial = useRef(true);
  useEffect(() => {
    if (isTagMasterInitial.current) {
      isTagMasterInitial.current = false;
      return;
    }
    try {
      localStorage.setItem("tsumitsumi_tag_master", JSON.stringify(tagMasterList));
    } catch { /* ignore */ }
  }, [tagMasterList]);

  // ダークモード：マウント時に <html data-theme=...> を読んで state と同期
  // (index.html の head script が描画前に既に setAttribute しているのでここでは読むだけ)
  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark" || t === "light") setTheme(t);
  }, []);
  // theme 変更時に <html data-theme=...> を更新（初回マウント時はスキップ：head script が既に適用済み）
  const isThemeApplyInitial = useRef(true);
  useEffect(() => {
    if (isThemeApplyInitial.current) {
      isThemeApplyInitial.current = false;
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  const setThemeAndSave = (newTheme) => {
    setTheme(newTheme);
    try { localStorage.setItem("tsumitsumi_theme", newTheme); } catch { /* ignore */ }
  };

  // Phase 4.C.1.d: idb-blob URL がどの kit にも参照されてなければ IDB から削除する
  const tryDeleteOrphanBlob = (url, kitList = kits) => {
    if (!isIdbBlobUrl(url)) return;
    const referenced = kitList.some(k =>
      k.photoUrl === url ||
      k.completedPhotoUrl === url ||
      (Array.isArray(k.completedPhotos) && k.completedPhotos.includes(url))
    );
    if (referenced) return;
    kitsIdbPhotoDelete(idbBlobUrlToId(url));
  };

  // Phase 4.C.1.c: 写真は Blob で IDB に保存し、kit には sentinel URL を入れる
  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const blob = await compressImageToBlob(file);
    if (!blob) return;
    const photoId = makePhotoId();
    const ok = await kitsIdbPhotoSet(photoId, blob);
    if (ok) {
      tryDeleteOrphanBlob(form.photoUrl);
      setForm((f) => ({ ...f, photo: null, photoUrl: idToIdbBlobUrl(photoId) }));
    } else {
      // IDB 保存失敗時は base64 にフォールバック
      const base64 = await compressImageToBase64(file);
      if (base64) setForm((f) => ({ ...f, photo: null, photoUrl: base64 }));
    }
  };
  // 完成写真を最大6枚まで追加（複数選択対応）。先頭[0]を表紙として completedPhotoUrl に同期。
  const handleCompletedPhoto = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // 同じファイルを連続選択できるようにクリア
    if (files.length === 0) return;
    const current = Array.isArray(form.completedPhotos) ? form.completedPhotos : getCompletedPhotos(form);
    const room = MAX_COMPLETED_PHOTOS - current.length;
    if (room <= 0) { alert(`完成写真は最大${MAX_COMPLETED_PHOTOS}枚までです`); return; }
    const added = [];
    for (const file of files.slice(0, room)) {
      const blob = await compressImageToBlob(file);
      if (!blob) continue;
      const photoId = makePhotoId();
      const ok = await kitsIdbPhotoSet(photoId, blob);
      if (ok) { added.push(idToIdbBlobUrl(photoId)); }
      else { const base64 = await compressImageToBase64(file); if (base64) added.push(base64); }
    }
    if (added.length === 0) return;
    setForm((f) => {
      const arr = [...(Array.isArray(f.completedPhotos) ? f.completedPhotos : getCompletedPhotos(f)), ...added].slice(0, MAX_COMPLETED_PHOTOS);
      return { ...f, completedPhotos: arr, completedPhotoUrl: arr[0] || "" };
    });
  };
  // 完成写真を1枚削除（idxで指定）。表紙(completedPhotoUrl)も再同期。
  const removeCompletedPhoto = (idx) => {
    setForm((f) => {
      const arr = (Array.isArray(f.completedPhotos) ? f.completedPhotos : getCompletedPhotos(f)).slice();
      const [removed] = arr.splice(idx, 1);
      if (removed) tryDeleteOrphanBlob(removed);
      return { ...f, completedPhotos: arr, completedPhotoUrl: arr[0] || "" };
    });
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    if (editId !== null) {
      const oldKit = kits.find(k => k.id === editId);
      const newKits = kits.map((k) => (k.id === editId ? { ...form, id: editId, price: form.retailPrice || "" } : k));
      if (oldKit) {
        // 編集前の kit が持っていた blob のうち、新しい kits が参照しないものを削除
        tryDeleteOrphanBlob(oldKit.photoUrl, newKits);
        getCompletedPhotos(oldKit).forEach(u => tryDeleteOrphanBlob(u, newKits));
      }
      setKits(newKits);
      setEditId(null);
    } else {
      setKits((ks) => [{ ...form, id: Date.now() }, ...ks]);
    }
    setForm(makeEmptyForm());
    setShowForm(false);
  };

  // ユーザー登録画像（base64）を Yahoo 画像 URL に置き換えて localStorage 容量を節約
  const handleResetUserImages = async () => {
    if (imageResetLoading) return;
    const targets = kits.filter(k => k.jan && k.photoUrl && (k.photoUrl.startsWith("data:") || isIdbBlobUrl(k.photoUrl)));
    if (targets.length === 0) {
      alert("対象のキットはありません。\n（JANあり＋ユーザー登録画像のキットが見つかりませんでした）");
      return;
    }
    const estSec = Math.ceil(targets.length * 1);
    const ok = window.confirm(
      "⚠️ 警告\n\n" +
      targets.length + "件のキットの「ユーザー登録画像」を削除し、JANに紐づくデフォルトの画像URLに置き換えます。\n\n" +
      "⛔ 削除した画像は元に戻せません（バックアップからのみ復元可）\n\n" +
      "【処理内容】\n" +
      "・JANあり + ユーザー登録画像 → デフォルトの画像URLに置換\n" +
      "・JANなしの画像 / 完成写真 → そのまま残す\n" +
      "・デフォルトの画像が取得できないキット → そのまま残す\n\n" +
      "処理時間: 約" + estSec + "秒\n\n" +
      "続行しますか？"
    );
    if (!ok) return;
    setImageResetLoading(true);
    setImageResetProgress({ current: 0, total: targets.length });
    let updated = 0, notFound = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const kit = targets[i];
      try {
        const r = await fetch("/api/search?jan=" + encodeURIComponent(kit.jan));
        if (!r.ok) {
          failed++;
        } else {
          const d = await r.json();
          const newUrl = d?.photoUrl || "";
          if (!newUrl) {
            notFound++;
          } else {
            const oldUrl = kit.photoUrl;
            setKits(prev => prev.map(k => k.id === kit.id ? { ...k, photoUrl: newUrl } : k));
            // 旧 URL が idb-blob で、置換後も他で参照されないなら削除
            if (isIdbBlobUrl(oldUrl)) tryDeleteOrphanBlob(oldUrl, kits.filter(k => k.id !== kit.id));
            updated++;
          }
        }
      } catch (_) {
        failed++;
      }
      setImageResetProgress({ current: i + 1, total: targets.length });
      await new Promise(r => setTimeout(r, 1000));
    }
    setImageResetLoading(false);
    setImageResetProgress({ current: 0, total: 0 });
    alert("✅ 完了\n\n更新: " + updated + "件\nデフォルトの画像なし: " + notFound + "件\n失敗: " + failed + "件");
  };

  // Phase 4.C.3: 既存の base64 写真を Blob (IDB) に移行して容量を節約する
  const handleMigratePhotosToBlob = async () => {
    if (migrateLoading) return;
    const isB64 = (u) => typeof u === "string" && u.startsWith("data:");
    const targets = kits.filter(k => isB64(k.photoUrl) || isB64(k.completedPhotoUrl));
    if (targets.length === 0) {
      alert("対象の写真はありません。");
      return;
    }
    if (!window.confirm(targets.length + "件のキットの写真を新形式（Blob）に変換し、容量を節約します。\n\n続行しますか？")) return;
    setMigrateLoading(true);
    setMigrateProgress({ current: 0, total: targets.length });
    let migrated = 0, failed = 0;
    for (let i = 0; i < targets.length; i++) {
      const kit = targets[i];
      const update = {};
      try {
        if (isB64(kit.photoUrl)) {
          const blob = await (await fetch(kit.photoUrl)).blob();
          const photoId = makePhotoId();
          if (await kitsIdbPhotoSet(photoId, blob)) update.photoUrl = idToIdbBlobUrl(photoId);
        }
        if (isB64(kit.completedPhotoUrl)) {
          const blob = await (await fetch(kit.completedPhotoUrl)).blob();
          const photoId = makePhotoId();
          if (await kitsIdbPhotoSet(photoId, blob)) update.completedPhotoUrl = idToIdbBlobUrl(photoId);
        }
      } catch (_) { /* skip */ }
      if (Object.keys(update).length > 0) {
        setKits(prev => prev.map(k => k.id === kit.id ? { ...k, ...update } : k));
        migrated++;
      } else {
        failed++;
      }
      setMigrateProgress({ current: i + 1, total: targets.length });
    }
    setMigrateLoading(false);
    setMigrateProgress({ current: 0, total: 0 });
    alert("✅ 完了\n\n変換: " + migrated + "件\n失敗: " + failed + "件");
  };

  const handleEdit = (kit) => { setForm({ ...kit, completedPhotos: getCompletedPhotos(kit), retailPrice: kit.retailPrice || kit.price || "" }); setEditId(kit.id); setShowForm(true); setDetail(null); };
  // キット複製：登録情報をすべてそのままコピーして新規キットとして追加。
  // photoUrl が idb-blob: の場合は同じ blob を参照（孤児チェックで両方残す限り削除されない）。
  // tags 配列だけは独立した配列にしておく（片方の編集がもう片方に波及しないように）。
  const handleDuplicate = (kit) => {
    const copy = { ...kit, id: Date.now(), tags: Array.isArray(kit.tags) ? [...kit.tags] : [], completedPhotos: getCompletedPhotos(kit) };
    setKits((ks) => [copy, ...ks]);
    setDetail(null);
  };
  const handleDelete = (id) => {
    const target = kits.find(k => k.id === id);
    const newKits = kits.filter((k) => k.id !== id);
    if (target) {
      tryDeleteOrphanBlob(target.photoUrl, newKits);
      getCompletedPhotos(target).forEach(u => tryDeleteOrphanBlob(u, newKits));
    }
    setKits(newKits);
    setDetail(null);
  };
  const toggleComplete = (id) => {
    setKits((ks) => ks.map((k) => {
      if (k.id !== id) return k;
      // 完成に切り替える時は状態（未開封・素組状態・欠品有り・制作途中）もクリアする
      return !k.completed
        ? { ...k, completed: true, condition: "" }
        : { ...k, completed: false };
    }));
    if (detail?.id === id) setDetail((d) => {
      if (!d) return d;
      return !d.completed
        ? { ...d, completed: true, condition: "" }
        : { ...d, completed: false };
    });
  };

  const handleJanDetected = async (jan) => {
    // 連続スキャンで同じバーコードを連続して読み込んだ際の確認ダイアログ無限ループを防止
    // 10秒以内に同じJANを再検出した場合は無視。検出のたびに ts をロールフォワードし、
    // confirm 表示中に時間がかかってクールダウンが切れる事故も防ぐ。
    const now = Date.now();
    const SAME_JAN_COOLDOWN_MS = 10000;
    if (jan === recentlyScannedJanRef.current.jan && now - recentlyScannedJanRef.current.ts < SAME_JAN_COOLDOWN_MS) {
      recentlyScannedJanRef.current.ts = now; // ロールフォワード（カメラがまだ同じバーコード上にある間はクールダウン継続）
      return;
    }
    recentlyScannedJanRef.current = { jan, ts: now };
    const existingKit = kits.find(k => k.jan === jan);
    if (continuousScan) {
      const inQueue = continuousQueue.find(k => k.jan === jan);
      if (existingKit || inQueue) {
        const where = existingKit ? "登録済み" : "今回スキャン済み";
        const ok = await askDuplicateConfirm({ kit: existingKit || inQueue, where });
        if (!ok) {
          // キャンセル時もクールダウンを「現在時刻」にリセットして、ループ再発を防ぐ
          recentlyScannedJanRef.current = { jan, ts: Date.now() };
          return;
        }
      }
      // 連続スキャンモード：スキャナーを閉じずにキューに追加
      setScanLoading(true);
      const data = await fetchProductByJAN(jan);
      setScanLoading(false);
      const newKit = data?.name
        ? { ...emptyForm, jan, name: data.name, series: data.series, scale: data.scale, price: data.price, photoUrl: data.photoUrl, id: Date.now() + Math.random(), tags: [] }
        : { ...emptyForm, jan, id: Date.now() + Math.random(), tags: [] };
      setContinuousQueue(q => [...q, newKit]);
      // スキャナーはそのまま継続
      return;
    }
    if (existingKit) {
      const ok = await askDuplicateConfirm({ kit: existingKit, where: "登録済み" });
      if (!ok) {
        // 1回スキャンモードでキャンセルした場合は「カメラに戻る」（既存キット詳細を開かない）。
        // ただし iOS Safari ではモーダル裏で <video> / MediaStream が止まったまま戻らず、
        // play() を叩いても復帰しないことが多発（=フリーズ）するため、スキャナーを一旦
        // 完全に閉じてすぐ開き直し、フレッシュなカメラストリームで再起動する。
        recentlyScannedJanRef.current = { jan, ts: Date.now() };
        setShowScanner(false);
        setTimeout(() => setShowScanner(true), 100);
        return;
      }
    }
    setShowScanner(false);
    setScanLoading(true);
    const data = await fetchProductByJAN(jan);
    setScanLoading(false);
    setForm(data?.name ? { ...emptyForm, jan, name: data.name, series: data.series, scale: data.scale, price: data.price, retailPrice: data.retailPrice || "", photoUrl: data.photoUrl, tags: [] } : { ...emptyForm, jan, tags: [] });
    setEditId(null);
    setShowForm(true);
  };

  // 連続スキャンキューを一括登録
  const handleBulkScanRegister = () => {
    if (continuousQueue.length === 0) return;
    const baseTime = Date.now();
    setKits(prev => [...continuousQueue.map((k, i) => ({ ...k, id: baseTime + i })), ...prev]);
    setContinuousQueue([]);
    setShowScanner(false);
  };

  const handleBulkAdd = (newKits) => {
    const baseTime = Date.now();
    const mapped = newKits.map((item, i) => ({
      ...item,
      photoUrl: item.image_url || item.photoUrl,
      id: baseTime + i,  // 確実に連番のidを振る
    }));
    setKits(prev => [...mapped, ...prev]);
  };

  const handleImport = (importedKits) => {
    setKits(importedKits);
  };

  const handleWant = (kit) => {
    const text = `「${kit.name}」これを作ってくれる方に譲りたいです！DMお願いします🙏 #積みプラ #ツミツミ #TSUMITSUMI`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleBulkSetField = (field, value) => {
    if (!value) return;
    setKits(prev => prev.map(k =>
      bulkSelected.has(k.id) ? { ...k, [field]: value } : k
    ));
  };

  const handleBulkRemoveTag = (tag) => {
    setKits(prev => prev.map(k =>
      bulkSelected.has(k.id) ? { ...k, tags: (k.tags || []).filter(t => t !== tag) } : k
    ));
  };

  const handleBulkAddTag = (tag) => {
    if (!tag.trim()) return;
    const t = tag.trim();
    // tagMasterListに追加
    setTagMasterList(prev => prev.includes(t) ? prev : [...prev, t]);
    // 選択キットがあれば反映
    if (bulkSelected.size > 0) {
      setKits(prev => prev.map(k =>
        bulkSelected.has(k.id)
          ? { ...k, tags: [...new Set([...(k.tags || []), t])] }
          : k
      ));
    }
    setBulkTagInput("");
  };

  const handleBulkApplyTag = (tag) => {
    if (bulkSelected.size === 0) return;
    setKits(prev => prev.map(k =>
      bulkSelected.has(k.id)
        ? { ...k, tags: [...new Set([...(k.tags || []), tag])] }
        : k
    ));
  };

  const handleBulkDelete = () => {
    if (bulkSelected.size === 0) return;
    if (!window.confirm(`選択した${bulkSelected.size}件を削除しますか？`)) return;
    const newKits = kits.filter(k => !bulkSelected.has(k.id));
    kits.filter(k => bulkSelected.has(k.id)).forEach(kit => {
      tryDeleteOrphanBlob(kit.photoUrl, newKits);
      tryDeleteOrphanBlob(kit.completedPhotoUrl, newKits);
    });
    setKits(newKits);
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  const handleBulkComplete = (completed) => {
    setKits(prev => prev.map(k => bulkSelected.has(k.id) ? { ...k, completed } : k));
    setBulkSelected(new Set());
    setBulkMode(false);
  };

  const moveKit = (id, dir) => {
    setKits((ks) => {
      const idx = ks.findIndex(k => k.id === id);
      if (idx < 0) return ks;
      if (dir === -1 && idx === 0) return ks;
      if (dir === 1 && idx === ks.length - 1) return ks;
      const next = [...ks];
      const [moved] = next.splice(idx, 1);
      next.splice(idx + dir, 0, moved);
      return next;
    });
  };

  const totalKits = kits.reduce((sum, k) => sum + (k.count || 1), 0);
  const rank = getRank(totalKits);
  const pending = kits.filter((k) => !k.completed).reduce((sum, k) => sum + (k.count || 1), 0);
  const done = kits.filter((k) => k.completed).reduce((sum, k) => sum + (k.count || 1), 0);
  // 合計価格：retailPrice（税込希望小売価格）優先、なければprice
  const getEffectivePrice = (k) => {
    const rp = parseInt((k.retailPrice || "").toString().replace(/[^0-9]/g, ""), 10);
    if (!isNaN(rp) && rp > 0) return rp;
    const p = parseInt((k.price || "").toString().replace(/[^0-9]/g, ""), 10);
    return isNaN(p) ? 0 : p;
  };
  const totalPrice = kits.reduce((sum, k) => sum + getEffectivePrice(k) * (k.count || 1), 0);
  const pendingPrice = kits.filter(k => !k.completed).reduce((sum, k) => sum + getEffectivePrice(k) * (k.count || 1), 0);
  const donePrice = kits.filter(k => k.completed).reduce((sum, k) => sum + getEffectivePrice(k) * (k.count || 1), 0);

  // filter+sort は useMemo 化：kits/フィルタ/ソートのいずれかが変わった時のみ再計算。
  // これにより、フォーム入力やモーダル開閉などの無関係な再レンダーで重い処理が走るのを防ぐ。
  const filtered = useMemo(() => {
    let result = kits.filter((k) =>
      filter === "pending" ? !k.completed : filter === "done" ? k.completed : true
    );
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(k =>
        k.name.toLowerCase().includes(q) ||
        (k.series || "").toLowerCase().includes(q) ||
        (k.scale || "").toLowerCase().includes(q)
      );
    }
    if (filterSeries === "__unset__") result = result.filter(k => !(k.series || "").trim());
    else if (filterSeries) result = result.filter(k => (k.series || "").replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim() === filterSeries);
    if (filterRating) result = result.filter(k => (k.rating || 0) === Number(filterRating));
    if (filterCondition) result = result.filter(k => (k.condition || "") === filterCondition);
    if (filterScale === "__unset__") result = result.filter(k => !(k.scale || "").trim());
    else if (filterScale) result = result.filter(k => (k.scale || "") === filterScale);
    if (filterTags.length > 0) result = result.filter(k => filterTags.every(tag => (k.tags || []).includes(tag)));
    if (sortKey !== "custom") {
      result = [...result].sort((a, b) => {
        let va, vb;
        if (sortKey === "name") { va = (a.name || ""); vb = (b.name || ""); }
        else if (sortKey === "date") { va = (a.id || 0); vb = (b.id || 0); }
        else if (sortKey === "purchaseDate") { va = (a.purchaseDate || ""); vb = (b.purchaseDate || ""); }
        if (va < vb) return sortDir === "asc" ? -1 : 1;
        if (va > vb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  }, [kits, filter, searchQuery, filterSeries, filterRating, filterCondition, filterScale, filterTags, sortKey, sortDir]);

  // キット一覧の各カードJSXを useMemo でキャッシュ。フォーム入力や検索 debounce 中などの
  // 無関係な再レンダーで .map() による 500件分の React 要素生成が走らないようにする（入力遅延の主因対策）。
  // 内部のクリックハンドラは React state setter または functional setState を使う関数のみを参照するので、
  // キャッシュされたクロージャでも stale 問題は発生しない（moveKit は内部で setKits(prev => ...) を使用）。
  const gridCards = useMemo(() => filtered.map((kit) => (
    <div key={kit.id} style={{ borderRadius: 10, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer", position: "relative" }} onClick={() => setDetail(kit)}>
      {(kit.completedPhotoUrl || kit.photoUrl)
        ? <KitImage src={kit.completedPhotoUrl || kit.photoUrl} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", aspectRatio: "1/1", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>📦</div>
      }
      <div style={{ padding: "6px 6px 8px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#111", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.3 }}>{kit.name}</div>
        {kit.scale && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{kit.scale}</div>}
        {kit.completed && <div style={{ fontSize: 10, color: "#10b981", fontWeight: 700, marginTop: 2 }}>✓ 完成済み</div>}
      </div>
    </div>
  )), [filtered]);

  const listCards = useMemo(() => filtered.map((kit, index) => (
    <div key={kit.id} style={{ ...s.card, position: "relative", ...(kit.completed && filter === "done" && !bulkMode && !reorderMode ? { marginLeft: 14, borderLeft: "3px solid #bbf7d0" } : {}), ...(bulkMode && bulkSelected.has(kit.id) ? { border: "2px solid #4f8ef7", background: "#eff6ff" } : {}) }} onClick={() => {
      if (bulkMode) { setBulkSelected(prev => { const n = new Set(prev); n.has(kit.id) ? n.delete(kit.id) : n.add(kit.id); return n; }); return; }
      if (!reorderMode) setDetail(kit);
    }}>
      {kit.completed && !bulkMode && !reorderMode && (
        <button onClick={(e) => { e.stopPropagation(); setShareKit(kit); }}
          title="完成品をXでシェア"
          style={{ position: "absolute", top: 6, right: 6, zIndex: 2, padding: "3px 9px", background: "#000", color: "#fff", border: "none", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
          📸 シェア
        </button>
      )}
      {bulkMode && (
        <div style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${bulkSelected.has(kit.id) ? "#4f8ef7" : "#d1d5db"}`, background: bulkSelected.has(kit.id) ? "#4f8ef7" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {bulkSelected.has(kit.id) && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
        </div>
      )}
      {reorderMode && !bulkMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <button style={{ width: 28, height: 28, border: "1.5px solid #e5e7eb", borderRadius: 8, background: index === 0 ? "#f3f4f6" : "#fff", color: index === 0 ? "#ccc" : "#374151", fontSize: 14, cursor: index === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { e.stopPropagation(); moveKit(kit.id, -1); }} disabled={index === 0}>▲</button>
          <button style={{ width: 28, height: 28, border: "1.5px solid #e5e7eb", borderRadius: 8, background: index === filtered.length - 1 ? "#f3f4f6" : "#fff", color: index === filtered.length - 1 ? "#ccc" : "#374151", fontSize: 14, cursor: index === filtered.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { e.stopPropagation(); moveKit(kit.id, 1); }} disabled={index === filtered.length - 1}>▼</button>
        </div>
      )}
      {(kit.completedPhotoUrl || kit.photoUrl) ? <KitImage src={kit.completedPhotoUrl || kit.photoUrl} style={s.thumb} /> : <div style={s.thumbPh}>📦</div>}
      <div style={s.cardBody}>
        <div style={s.cardName}>{kit.name}</div>
        <div style={s.cardMeta}>
          {kit.series && <span>{kit.series}</span>}
          {kit.scale && <span style={s.badge}>{kit.scale}</span>}
          {kit.completed && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginLeft: 6 }}>✓ 完成済み</span>}
          {kit.tags?.length > 0 && kit.tags.map(tag => (
            <span key={tag} style={{ background: "#f0fdf4", color: "#166534", borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>#{tag}</span>
          ))}
        </div>
        <div style={s.cardBottom}>
          {kit.rating > 0 && !kit.completed && <span style={s.stars}>{"★".repeat(kit.rating)}{"☆".repeat(5 - kit.rating)}</span>}
          {kit.count > 1 && <span style={s.countBadge}>{kit.count}個</span>}
          {kit.condition && <span style={{ ...s.condBadge, ...getCondStyle(kit.condition) }}>{kit.condition}</span>}
          {(() => {
            const ep = getEffectivePrice(kit);
            if (ep <= 0) return null;
            return (
              <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>
                ¥{ep.toLocaleString()}{kit.count > 1 ? `×${kit.count}` : ""}
              </span>
            );
          })()}
        </div>
        {kit.completed && filter === "done" && !bulkMode && !reorderMode && (
          <button onClick={(e) => { e.stopPropagation(); setAlbumKit(kit); }}
            style={{ marginTop: 8, alignSelf: "flex-start", padding: "5px 16px", background: "#f0fdf4", color: "#166534", border: "1.5px solid #bbf7d0", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            📷 アルバム
          </button>
        )}
      </div>
    </div>
  )), [filtered, bulkMode, bulkSelected, reorderMode, filter]);

  // 完成タブ用：完成品アルバムのサムネグリッド。タップでギャラリービューアを開く。
  const albumCards = useMemo(() => filtered.map((kit) => {
    const photos = getCompletedPhotos(kit);
    const cover = photos[0] || kit.photoUrl;
    return (
      <div key={kit.id} onClick={() => setAlbumKit(kit)}
        style={{ borderRadius: 10, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer", position: "relative" }}>
        <div style={{ width: "100%", aspectRatio: "1/1", background: "#f3f4f6", position: "relative" }}>
          {cover
            ? <KitImage src={cover} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>📦</div>}
          {photos.length > 1 && (
            <span style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20 }}>📷 {photos.length}</span>
          )}
          {/* 名前オーバーレイ */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 8px 6px", background: "linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))", color: "#fff", fontSize: 11, fontWeight: 700, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{kit.name}</div>
        </div>
      </div>
    );
  }), [filtered]);
  // 完成タブで通常リスト/グリッドの代わりにアルバムグリッドを出す条件
  // 完成タブ：サムネ(grid)表示のときだけアルバムグリッド。詳細(list)表示では通常の一覧（詳細モーダル）に。
  const albumMode = filter === "done" && viewMode === "grid" && !bulkMode && !reorderMode;

  // IDB 読込完了まではローディング表示（localStorage 由来の古い表示のチラつき防止）
  if (!hydrated) {
    return (
      <div style={{ ...s.root, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: "#111" }}>TSUMI TSUMI</div>
        <div style={{ width: 32, height: 32, border: "3px solid #e5e7eb", borderTopColor: "#111", borderRadius: "50%", animation: "ttspin 0.8s linear infinite" }} />
        <div style={{ fontSize: 12, color: "#9ca3af" }}>読み込み中...</div>
        <style>{"@keyframes ttspin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={{ ...s.header, display: bulkMode ? "none" : "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.headerTitle}>TSUMI TSUMI</div>
          <div style={s.headerSub}>PLASTIC MODEL TRACKER</div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowSearch(v => !v)}>🔍</button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowBackup(true)} title="バックアップ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              <path d="M12 8v8M8 12l4 4 4-4" />
            </svg>
          </button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowHelp(true)}>❓</button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowAppShare(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10L12 6L16 10" />
              <line x1="12" y1="6" x2="12" y2="17" />
              <path d="M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" />
            </svg>
          </button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30, fontSize: 14 }} onClick={() => setShowAlbum(true)} title="完成アルバムをシェア">📸</button>
          <button style={{ ...s.shareBtn, width: 30, height: 30, fontSize: 13 }} onClick={() => setShowShare(true)}>𝕏</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "8px 20px", display: bulkMode ? "none" : "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: rank.color, background: rank.color + "18", borderRadius: 20, padding: "3px 10px" }}>{rank.label}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>登録数 {totalKits}</span>
        <a href="/gears.html" target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 20, padding: "3px 10px", textDecoration: "none", whiteSpace: "nowrap" }}>
          🛠 おすすめ定番アイテム
        </a>
      </div>

      {showSearch && !bulkMode && (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "10px 16px" }}>
          <input autoFocus
            style={{ width: "100%", padding: "8px 12px", border: "1.5px solid #4f8ef7", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none", boxSizing: "border-box" }}
            placeholder="キット名・シリーズで検索..."
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      )}

      <div style={{ ...s.stats, display: bulkMode ? "none" : "flex" }}>
        {[["積みプラ", pending, "#ef4444", "pending"], ["完成", done, "#22c55e", "done"], ["総数", kits.reduce((sum, k) => sum + (k.count || 1), 0), "#111", "all"]].map(([label, num, color, f]) => (
          <div key={f} style={s.statBox} onClick={() => setFilter(f)}>
            <div style={{ ...s.statNum, color }}>{num}</div>
            <div style={s.statLabel}>{label}</div>
          </div>
        ))}
      </div>
      {/* 総額バー：タブ（積みプラ/完成/総計）に応じて表示を切替 */}
      {!bulkMode && (() => {
        const displayPrice = filter === "done" ? donePrice : filter === "all" ? totalPrice : pendingPrice;
        const displayLabel = filter === "done" ? "💴 完成品の総額" : filter === "all" ? "💴 総計" : "💴 積みプラ総額";
        const displayColor = filter === "done" ? "#22c55e" : filter === "all" ? "#111" : "#ef4444";
        return (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "6px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{displayLabel}</span>
              {showPriceTotal && totalPrice > 0 && (
                <span style={{ fontSize: 14, fontWeight: 700, color: displayColor }}>¥{displayPrice.toLocaleString()}</span>
              )}
              {showPriceTotal && totalPrice === 0 && (
                <span style={{ fontSize: 11, color: "#d1d5db" }}>希望小売価格を取得中...</span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {showPriceTotal && totalPrice > 0 && (
                <span style={{ fontSize: 9, color: "#d1d5db" }}>税込希望小売価格×個数</span>
              )}
              <button
                style={{ fontSize: 10, padding: "2px 8px", border: "1px solid #e5e7eb", borderRadius: 20, background: showPriceTotal ? "#f0fdf4" : "#f3f4f6", color: showPriceTotal ? "#16a34a" : "#9ca3af", cursor: "pointer" }}
                onClick={() => setShowPriceTotal(v => !v)}>
                {showPriceTotal ? "表示中" : "非表示"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", display: bulkMode ? "none" : undefined }}>
        <div style={{ padding: "8px 16px 4px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5 }}>
            <select style={{ padding: "3px 4px", borderRadius: 8, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterScale ? "#059669" : "#e5e7eb"}`, background: filterScale ? "#ecfdf5" : "#fafafa" }}
              value={filterScale} onChange={(e) => setFilterScale(e.target.value)}>
              <option value="">スケール</option>
              <option value="__unset__">未設定</option>
              {[...new Set(kits.map(k => k.scale).filter(Boolean))].sort().map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 8, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterSeries ? "#4f8ef7" : "#e5e7eb"}`, background: filterSeries ? "#eff6ff" : "#fafafa" }}
              value={filterSeries} onChange={(e) => setFilterSeries(e.target.value)}>
              <option value="">シリーズ</option>
              <option value="__unset__">未設定</option>
              {[...new Set(kits.map(k => (k.series || "").replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim()).filter(Boolean))].sort().map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 8, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterRating ? "#f59e0b" : "#e5e7eb"}`, background: filterRating ? "#fffbeb" : "#fafafa" }}
              value={filterRating} onChange={(e) => setFilterRating(e.target.value)}>
              <option value="">評価</option>
              <option value="5">★5</option>
              <option value="4">★4</option>
              <option value="3">★3</option>
              <option value="2">★2</option>
              <option value="1">★1</option>
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 8, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterCondition ? "#8b5cf6" : "#e5e7eb"}`, background: filterCondition ? "#f5f3ff" : "#fafafa" }}
              value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)}>
              <option value="">状態</option>
              {CONDITION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        {(() => {
          const allTags = [...new Set(kits.flatMap(k => k.tags || []))];
          if (allTags.length === 0) return null;
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#9ca3af", alignSelf: "center" }}>タグ：</span>
              {allTags.map(tag => {
                const active = filterTags.includes(tag);
                return (
                  <button key={tag}
                    style={{ background: active ? "#166534" : "#f0fdf4", color: active ? "#fff" : "#166534", border: `1.5px solid ${active ? "#166534" : "#bbf7d0"}`, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    onClick={() => setFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}>
                    #{tag}
                  </button>
                );
              })}
              {filterTags.length > 0 && (
                <button style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer" }} onClick={() => setFilterTags([])}>✕ クリア</button>
              )}
            </div>
          );
        })()}
      </div>

      {scanLoading && <div style={s.loadingBar}>🔍 商品情報を検索中...</div>}

      <div style={s.list}>
        {filtered.length === 0 && (
          <div style={s.empty}>
            {kits.length === 0
              ? <><div style={{ fontSize: 40, marginBottom: 12 }}>📦</div><div>右下のボタンからキットを登録しよう</div></>
              : "該当するキットがありません"}
          </div>
        )}
        {filtered.length > 0 && !bulkMode && (
          <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 5, marginBottom: 4, overflowX: "auto", paddingBottom: 2 }}>
            <button style={{ fontSize: 11, padding: "4px 8px", border: `1.5px solid ${viewMode === "list" ? "#111" : "#e5e7eb"}`, borderRadius: 20, background: viewMode === "list" ? "#111" : "#fff", color: viewMode === "list" ? "#fff" : "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setViewMode("list")}>☰ 詳細</button>
            <button style={{ fontSize: 11, padding: "4px 8px", border: `1.5px solid ${viewMode === "grid" ? "#111" : "#e5e7eb"}`, borderRadius: 20, background: viewMode === "grid" ? "#111" : "#fff", color: viewMode === "grid" ? "#fff" : "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setViewMode("grid")}>⊞ サムネ</button>
            <select style={{ fontSize: 11, padding: "3px 6px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#fff", color: "#6b7280", cursor: "pointer", flexShrink: 0 }}
              value={sortKey} onChange={(e) => { setSortKey(e.target.value); setReorderMode(false); }}>
              <option value="name">名前順</option>
              <option value="date">登録順</option>
              <option value="purchaseDate">購入日順</option>
            </select>
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#fff", color: "#6b7280", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>
              {sortDir === "asc" ? "↑昇" : "↓降"}
            </button>
            {filtered.length > 1 && sortKey === "custom" && (
              <button style={{ fontSize: 11, padding: "3px 8px", border: `1.5px solid ${reorderMode ? "#4f8ef7" : "#e5e7eb"}`, borderRadius: 20, background: reorderMode ? "#eff6ff" : "#fff", color: reorderMode ? "#4f8ef7" : "#6b7280", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => setReorderMode(v => !v)}>
                {reorderMode ? "✓完了" : "↕手動"}
              </button>
            )}
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#fff", color: "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => { setBulkMode(true); setBulkSelected(new Set()); }}>
              ☑ 一括
            </button>
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #111", borderRadius: 20, background: "#111", color: "#fff", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setShowTagEditor(true)}>
              🏷️ タグ編集
            </button>
          </div>
        )}
        {/* 完成タブ：完成品アルバムグリッド（タップで6枚ギャラリー） */}
        {albumMode && (
          filtered.length === 0
            ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af", fontSize: 13, lineHeight: 1.8 }}>完成済みのキットがありません。<br/>キットを「完成」にすると、ここに完成品アルバムが並びます。</div>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>{albumCards}</div>
        )}
        {!albumMode && viewMode === "grid" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {gridCards}
          </div>
        )}
        {/* 一括操作バー */}
        {bulkMode && (
          <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", background: "#111", color: "#fff" }}>
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>☑ 一括編集モード</span>
            <button style={{ fontSize: 12, padding: "4px 12px", background: "#fff", color: "#111", border: "none", borderRadius: 20, fontWeight: 700, cursor: "pointer" }}
              onClick={() => { setBulkMode(false); setBulkSelected(new Set()); }}>✕ 解除</button>
          </div>
        )}
        {bulkMode && (() => {
          const allExistingTags = [...new Set([...tagMasterList, ...kits.flatMap(k => k.tags || [])])];
          return (
            <div style={{ background: "#fff", borderRadius: 10, marginBottom: 8, border: "1.5px solid #e5e7eb", overflow: "hidden" }}>
              {/* ヘッダー：件数・削除 */}
              <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>{bulkSelected.size}件選択中</span>
                <button style={{ fontSize: 12, padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}
                  onClick={handleBulkDelete}>🗑 削除</button>
              </div>
              {/* 状態 */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>状態を一括設定</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CONDITION_OPTIONS.map(opt => (
                    <button key={opt} onClick={() => handleBulkSetField("condition", opt)}
                      style={{ padding: "5px 12px", borderRadius: 20, border: "1.5px solid #e5e7eb", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#374151" }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              {/* シリーズ */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>シリーズを一括設定</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none", background: "#fafafa" }}
                    onChange={(e) => { if (e.target.value) handleBulkSetField("series", e.target.value); e.target.value = ""; }}
                    defaultValue="">
                    <option value="">シリーズを選択...</option>
                    {SERIES_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              {/* スケール */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>スケールを一括設定</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none", background: "#fafafa" }}
                    onChange={(e) => { if (e.target.value) handleBulkSetField("scale", e.target.value); e.target.value = ""; }}
                    defaultValue="">
                    <option value="">スケールを選択...</option>
                    {SCALE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              {/* タグ */}
              <div style={{ padding: "10px 16px" }}>
<div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>タグ名タップ→選択キットに追加 ／ 解除→選択キットから外す</div>
                {bulkSelected.size === 0 && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6 }}>⚠ タグ名タップはキット選択後に有効になります</div>}
                {allExistingTags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {allExistingTags.map(t => (
                      <BulkTagBadge key={t} tag={t}
                        onApply={() => handleBulkApplyTag(t)}
                        onRemove={() => handleBulkRemoveTag(t)} />
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <input style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 12, outline: "none" }}
                    placeholder="新しいタグを入力..."
                    value={bulkTagInput}
                    onChange={(e) => setBulkTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { handleBulkAddTag(bulkTagInput); setBulkTagInput(""); } }}
                  />
                  <button style={{ padding: "6px 14px", background: "#111", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    onClick={() => { handleBulkAddTag(bulkTagInput); setBulkTagInput(""); }}>追加</button>
                </div>
              </div>
            </div>
          );
        })()}
        {!albumMode && viewMode === "list" && listCards}
      </div>

      {/* フッター */}
      <div style={{ textAlign: "center", padding: "20px 20px 100px", borderTop: "1px solid #f0f0f0" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>当サイトはアフィリエイト広告を利用しています</div>
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "6px 14px", marginBottom: 10 }}>
          <a href="/manual.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>取扱説明書</a>
          <a href="/about.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>運営者情報</a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>利用規約</a>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>プライバシーポリシー</a>
          <a href="/paint/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>塗料大全（工事中）</a>
          <a href="/sell.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>積みを売る</a>
          <a href="/storage.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>プラモを預ける</a>
        </div>
        <div style={{ fontSize: 10, color: "#cbd5e1" }}>© 2026 TSUMI TSUMI</div>
      </div>

      {/* フロート式「プラモを預ける」リンク。トップから移動して左下に常駐させる。
          z-index は右下の FAB（50）より下げて、スキャン/手動登録の操作を邪魔しないようにする。 */}
      <a href="/storage.html" target="_blank" rel="noopener noreferrer"
        style={{ position: "fixed", bottom: 24, left: 16, zIndex: 40, fontSize: 11, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 20, padding: "6px 12px", textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        📦 プラモを預ける
      </a>

      <div style={{ position: "fixed", bottom: 24, right: 20, display: "flex", flexDirection: "column", gap: 12, zIndex: 50, alignItems: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "4px 10px", borderRadius: 20 }}>スキャン登録</span>
            <button
              style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", fontSize: 10, padding: "2px 8px", borderRadius: 20, cursor: "pointer" }}
              onClick={() => { setContinuousScan(v => !v); }}>
              {continuousScan ? "🔁 連続ON" : "1回のみ"}
            </button>
          </div>
          <button style={{ ...s.fab, background: "#000", padding: 0, overflow: "hidden" }} onClick={() => setShowScanner(true)}>
            <img src="/camera-icon.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="スキャン" />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "4px 10px", borderRadius: 20 }}>一括登録</span>
          <button style={{ ...s.fab, background: "#111", fontSize: 18 }} onClick={() => setShowBrowse(true)}>☰</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "4px 10px", borderRadius: 20 }}>手動登録</span>
          <button style={{ ...s.fab, background: "#111" }} onClick={() => { setForm(makeEmptyForm()); setEditId(null); setShowForm(true); }}>＋</button>
        </div>
      </div>

      {detail && (
        <div style={s.overlay} onClick={() => setDetail(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            {(detail.completedPhotoUrl || detail.photoUrl) && (
              <KitImage src={detail.completedPhotoUrl || detail.photoUrl} style={s.modalPhoto} />
            )}
            <div style={s.modalBody}>
              <div style={s.modalTitle}>{detail.name}</div>
              {detail.completed && <div style={s.doneBadge}>✓ 完成済み</div>}
              <table style={s.table}><tbody>
                {[["シリーズ", detail.series], ["スケール", detail.scale], ["希望小売価格", (() => { const ep = getEffectivePrice(detail); return ep > 0 ? `¥${ep.toLocaleString()}（税込）` : null; })()], ["購入日", detail.purchaseDate ? formatDate(detail.purchaseDate) : null], ["個数", detail.count > 1 ? `${detail.count}個` : null], ["合計金額", (() => { const ep = getEffectivePrice(detail); const cnt = detail.count || 1; return ep > 0 && cnt > 1 ? `¥${(ep*cnt).toLocaleString()}（${cnt}個×¥${ep.toLocaleString()}）` : null; })()], ["評価", (detail.rating > 0 && !detail.completed) ? "★".repeat(detail.rating) + "☆".repeat(5 - detail.rating) : null], ["状態", detail.condition ? (detail.conditionNote ? `${detail.condition}（${detail.conditionNote}）` : detail.condition) : null], ["JAN", detail.jan], ["メモ", detail.memo]]
                  .filter(([, v]) => v && v !== "—")
                  .map(([k, v]) => <tr key={k}><td style={s.td1}>{k}</td><td style={s.td2}>{v}</td></tr>)}
              </tbody></table>
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <button
                  style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: "4px 0" }}
                  onClick={() => setReportTarget({ name: detail.name, jan: detail.jan, retailPrice: detail.retailPrice, price: detail.price, photoUrl: detail.photoUrl })}>
                  ⚠️ 情報の誤りを報告
                </button>
              </div>
              {detail.tags?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>タグ</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {detail.tags.map(tag => (
                      <span key={tag} style={{ background: "#f0fdf4", color: "#166534", borderRadius: 20, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>#{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {!detail.completed && (
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button style={{ ...s.wantBtn, marginTop: 0, width: "auto", flex: 1 }} onClick={() => handleWant(detail)}>
                    🙋 これを作ってくれる人に譲りたい！とポストする
                  </button>
                  <a href="/sell.html" target="_blank" rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      padding: "12px 8px",
                      background: "#ecfdf5",
                      color: "#059669",
                      border: "1.5px solid #a7f3d0",
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 700,
                      textAlign: "center",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                    💰 積みを売る
                  </a>
                </div>
              )}
              {/* Amazonアソシエイト：JAN または商品名で Amazon 検索へ送客。
                  譲る・売るの下に小さめサイズで配置（控えめなセカンダリ動線）。 */}
              {makeAmazonAffUrl(detail) && (
                <div style={{ marginTop: 10 }}>
                  <a
                    href={makeAmazonAffUrl(detail)}
                    target="_blank"
                    rel="nofollow noopener noreferrer sponsored"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      padding: "6px 10px",
                      background: "#111",
                      color: "#fff",
                      border: "1px solid #111",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "none",
                    }}>
                    🛒 Amazonで関連商品を見る
                  </a>
                  <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "center", marginTop: 3, lineHeight: 1.5 }}>
                    ※ Amazonのアソシエイトとして、当サイトは適格販売により収入を得ています
                  </div>
                </div>
              )}
              <div style={s.modalBtns}>
                <button style={s.editBtn} onClick={() => handleEdit(detail)}>編集</button>
                <button style={{ ...s.editBtn, background: '#3b82f6', color: '#fff' }} onClick={() => handleDuplicate(detail)}>複製</button>
                <button style={{ ...s.editBtn, background: detail.completed ? '#9ca3af' : '#10b981' }} onClick={() => { toggleComplete(detail.id); setDetail(null); }}>{detail.completed ? '完成を解除' : '完成'}</button>
                <button style={s.closeBtn} onClick={() => setDetail(null)}>閉じる</button>
              </div>
              {/* 広告（AdSense審査中は ADS_ENABLED=false で非表示） */}
              {ADS_ENABLED && (
                <div style={{ marginTop: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 4 }}>広告</div>
                  <iframe src="/admax-banner.html" title="ad" loading="lazy" width="320" height="100" frameBorder="0" scrolling="no" style={{ border: "none", display: "inline-block", maxWidth: "100%" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 重複JAN確認モーダル（window.confirm の代替）
          iOS Safari で window.confirm を出すと、スキャナーの <video> が止まったまま
          ダイアログを閉じても復帰せず固まる事故が多発したため、React 制御のモーダルにする。
          スキャナーの overlay(zIndex:100) より前面に出す（zIndex:200）。 */}
      {dupConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => resolveDup(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 360, padding: 20, boxShadow: "0 10px 40px rgba(0,0,0,0.3)", boxSizing: "border-box" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 10 }}>
              ⚠️ このJANは既に{dupConfirm.where}です
            </div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, padding: "10px 12px", background: "#f9fafb", borderRadius: 8, lineHeight: 1.5, wordBreak: "break-all" }}>
              「{dupConfirm.kit?.name || dupConfirm.kit?.jan || "（名称なし）"}」
            </div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16 }}>
              それでも追加しますか？
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ flex: 1, padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => resolveDup(false)}>
                キャンセル
              </button>
              <button
                style={{ flex: 1, padding: "12px 0", background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => resolveDup(true)}>
                追加する
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanner && (
        <div style={{ ...s.overlay, alignItems: "flex-start" }} onClick={() => setShowScanner(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <BarcodeScanner onDetected={handleJanDetected} onClose={() => { setShowScanner(false); if (continuousScan && continuousQueue.length > 0) handleBulkScanRegister(); }} continuous={continuousScan} />
            {continuousScan && continuousQueue.length > 0 && (
              <div style={{ background: "#fff", padding: "12px 16px", borderTop: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 12, color: "#374151", marginBottom: 8, fontWeight: 700 }}>
                  📦 スキャン済み {continuousQueue.length}件
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  {continuousQueue.map((k, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                      {(k.completedPhotoUrl || k.photoUrl) && <KitImage src={k.completedPhotoUrl || k.photoUrl} style={{ width: 30, height: 30, borderRadius: 4, objectFit: "cover" }} />}
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name || k.jan}</span>
                      <button style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
                        onClick={() => setContinuousQueue(q => q.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <button style={{ width: "100%", padding: "10px 0", background: "#22c55e", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
                  onClick={handleBulkScanRegister}>
                  ✓ {continuousQueue.length}件をまとめて登録
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showHelp && (
        <div style={s.overlay} onClick={() => setShowHelp(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <HelpModal
              onClose={() => setShowHelp(false)}
              onResetUserImages={handleResetUserImages}
              imageResetLoading={imageResetLoading}
              imageResetProgress={imageResetProgress}
              resetTargetCount={kits.filter(k => k.jan && k.photoUrl && (k.photoUrl.startsWith("data:") || isIdbBlobUrl(k.photoUrl))).length}
              onMigratePhotos={handleMigratePhotosToBlob}
              migrateLoading={migrateLoading}
              migrateProgress={migrateProgress}
              migrateTargetCount={kits.filter(k => (k.photoUrl && k.photoUrl.startsWith("data:")) || (k.completedPhotoUrl && k.completedPhotoUrl.startsWith("data:"))).length}
              theme={theme}
              onToggleTheme={() => setThemeAndSave(theme === "dark" ? "light" : "dark")}
              kits={kits}
            />
          </div>
        </div>
      )}

      {showAllVersions && (
        <div style={s.overlay} onClick={() => setShowAllVersions(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <AllVersionsModal onClose={() => setShowAllVersions(false)} />
          </div>
        </div>
      )}

      {showTagEditor && (
        <div style={s.overlay} onClick={() => setShowTagEditor(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <TagEditorModal kits={kits} setKits={setKits} tagMasterList={tagMasterList} setTagMasterList={setTagMasterList} onClose={() => setShowTagEditor(false)} />
          </div>
        </div>
      )}

      {showBrowse && (
        <div style={s.overlay} onClick={() => setShowBrowse(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <BrowseModal onBulkAdd={handleBulkAdd} onClose={() => setShowBrowse(false)} />
          </div>
        </div>
      )}

      {showBackup && (
        <div style={s.overlay} onClick={() => setShowBackup(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <BackupModal kits={kits} onImport={handleImport} onClose={() => setShowBackup(false)} />
          </div>
        </div>
      )}

      {showAppShare && (
        <div style={s.overlay} onClick={() => setShowAppShare(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <AppShareModal onClose={() => setShowAppShare(false)} />
          </div>
        </div>
      )}

      {showShare && (
        <div style={s.overlay} onClick={() => setShowShare(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <XShareModal kits={kits} myXId={myXId} setMyXId={setMyXId} onClose={() => setShowShare(false)} />
          </div>
        </div>
      )}

      {showAlbum && (
        <div style={s.overlay} onClick={() => setShowAlbum(false)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <AlbumShareModal kits={kits} rank={rank} myXId={myXId} setMyXId={setMyXId} onClose={() => setShowAlbum(false)} />
          </div>
        </div>
      )}

      {albumKit && (
        <div style={s.overlay} onClick={() => setAlbumKit(null)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <AlbumViewerModal kit={albumKit}
              onClose={() => setAlbumKit(null)}
              onShare={(k) => { setAlbumKit(null); setShareKit(k); }}
              onEdit={(k) => { setAlbumKit(null); handleEdit(k); }}
              onUncomplete={(k) => { setAlbumKit(null); toggleComplete(k.id); }} />
          </div>
        </div>
      )}

      {shareKit && (
        <div style={s.overlay} onClick={() => setShareKit(null)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <AlbumShareModal kits={kits} rank={rank} myXId={myXId} setMyXId={setMyXId} singleKit={shareKit} onClose={() => setShareKit(null)} />
          </div>
        </div>
      )}

      {showForm && (
        <div style={s.overlay} onClick={() => setShowForm(false)}>
          <div style={s.formModal} onClick={(e) => e.stopPropagation()}>
            <div style={s.formTitle}>{editId ? "キットを編集" : "キットを追加"}</div>

            <label style={s.label}>キット名 *</label>
            <KitNameInput value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))}
              onSelect={(item) => setForm((f) => ({ ...f, name: item.name, jan: item.jan || f.jan, retailPrice: item.retailPrice || item.retail_price || f.retailPrice, photoUrl: item.photoUrl || f.photoUrl, series: item.series || f.series, scale: item.scale || f.scale }))} />

            <label style={s.label}>状態</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              {CONDITION_OPTIONS.map((opt) => (
                <button key={opt}
                  style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", fontSize: 13, fontWeight: 600, cursor: "pointer",
                    background: form.condition === opt ? "#111" : "#f3f4f6",
                    color: form.condition === opt ? "#fff" : "#374151",
                    borderColor: form.condition === opt ? "#111" : "#e5e7eb" }}
                  onClick={() => setForm((f) => ({ ...f, condition: f.condition === opt ? "" : opt }))}>
                  {opt}
                </button>
              ))}
            </div>
            <input style={{ ...s.input, marginBottom: 4 }} placeholder="状態のメモ（欠品内容など自由に）" value={form.conditionNote}
              onChange={(e) => setForm((f) => ({ ...f, conditionNote: e.target.value }))} />

            <label style={s.label}>シリーズ</label>
            <select style={s.input}
              value={SERIES_OPTIONS.includes(form.series) ? form.series : form.series ? "__custom__" : ""}
              onChange={(e) => setForm((f) => ({ ...f, series: e.target.value === "__custom__" ? "" : e.target.value }))}>
              <option value="">選択してください</option>
              {SERIES_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              <option value="__custom__">✏️ 自由入力...</option>
            </select>
            {!SERIES_OPTIONS.includes(form.series) && (
              <input style={{ ...s.input, marginTop: 6 }} placeholder="シリーズ名を自由に入力" value={form.series}
                onChange={(e) => setForm((f) => ({ ...f, series: e.target.value }))} />
            )}

            <label style={s.label}>希望小売価格（税込）</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                style={{ ...s.input, flex: 1 }}
                placeholder="例: 7700"
                inputMode="numeric"
                value={form.retailPrice || ""}
                onChange={(e) => setForm((f) => ({ ...f, retailPrice: e.target.value.replace(/[^0-9]/g, "") }))}
              />
              {form.jan && (
                <button
                  style={{ padding: "8px 12px", background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={async (e) => {
                    e.preventDefault();
                    const r = await fetch(`/api/price?jan=${form.jan}`);
                    const d = await r.json();
                    if (d.price) {
                      setForm((f) => ({ ...f, retailPrice: String(d.price) }));
                    } else {
                      alert("取得できませんでした。手動で入力してください。");
                    }
                  }}>
                  🔄 自動取得
                </button>
              )}
            </div>
            {form.retailPrice && (
              <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
                ¥{parseInt(form.retailPrice).toLocaleString()} × {form.count || 1}個 = ¥{(parseInt(form.retailPrice) * (form.count || 1)).toLocaleString()}
              </div>
            )}
            {form.jan && (
              <div style={{ marginTop: 2, marginBottom: 4, textAlign: "right" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#9ca3af", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: "2px 0" }}
                  onClick={() => setReportTarget({ name: form.name, jan: form.jan, retailPrice: form.retailPrice, price: form.price, photoUrl: form.photoUrl })}>
                  ⚠️ この価格・情報の誤りを報告
                </button>
              </div>
            )}

            <label style={s.label}>スケール</label>
            <select style={s.input}
              value={SCALE_OPTIONS.includes(form.scale) ? form.scale : form.scale ? "__custom__" : ""}
              onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value === "__custom__" ? "" : e.target.value }))}>
              <option value="">選択してください</option>
              {SCALE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              <option value="__custom__">✏️ 自由入力...</option>
            </select>
            {!SCALE_OPTIONS.includes(form.scale) && (
              <input style={{ ...s.input, marginTop: 6 }} placeholder="スケールを自由に入力（例: 1/8、1/144 などの独自表記も可）"
                value={form.scale}
                onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))} />
            )}

            <label style={s.label}>タグ</label>
            <TagInput tags={form.tags || []} onChange={(tags) => setForm((f) => ({ ...f, tags }))} allTags={[...new Set(kits.flatMap(k => k.tags || []))]} />

            <label style={s.label}>購入日</label>
            <input style={s.input} type="date" value={form.purchaseDate} onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} />

            <label style={s.label}>評価</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              {[1,2,3,4,5].map((star) => (
                <button key={star} style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer", color: star <= form.rating ? "#f59e0b" : "#d1d5db", padding: "0 2px" }}
                  onClick={() => setForm((f) => ({ ...f, rating: f.rating === star ? 0 : star }))}>★</button>
              ))}
            </div>

            <label style={s.label}>個数</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px solid #e5e7eb", background: "#f3f4f6", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setForm((f) => ({ ...f, count: Math.max(1, (f.count || 1) - 1) }))}>−</button>
              <span style={{ fontSize: 18, fontWeight: 700, minWidth: 32, textAlign: "center" }}>{form.count || 1}</span>
              <button style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px solid #e5e7eb", background: "#f3f4f6", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setForm((f) => ({ ...f, count: (f.count || 1) + 1 }))}>＋</button>
            </div>

            <label style={s.label}>箱の写真</label>
            <div style={{ position: "relative" }}>
              <div style={s.photoArea} onClick={() => fileRef.current.click()}>
                {form.photoUrl ? <KitImage src={form.photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                  : <span style={{ color: "#9ca3af", fontSize: 14 }}>📷 タップして写真を選択</span>}
              </div>
              {form.photoUrl && (
                <button style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={(e) => { e.stopPropagation(); tryDeleteOrphanBlob(form.photoUrl); setForm((f) => ({ ...f, photoUrl: "", photo: null })); }}>✕</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />

            <label style={s.label}>完成品の写真（最大{MAX_COMPLETED_PHOTOS}枚）</label>
            {(() => {
              const photos = Array.isArray(form.completedPhotos) ? form.completedPhotos : getCompletedPhotos(form);
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {photos.map((url, i) => (
                    <div key={i} style={{ position: "relative", width: 88, height: 88, borderRadius: 8, overflow: "hidden", border: `1.5px solid ${i === 0 ? "#22c55e" : "#e5e7eb"}` }}>
                      <KitImage src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      {i === 0 && <span style={{ position: "absolute", left: 0, bottom: 0, background: "#22c55e", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderTopRightRadius: 6 }}>表紙</span>}
                      <button type="button" style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={(e) => { e.stopPropagation(); removeCompletedPhoto(i); }}>✕</button>
                    </div>
                  ))}
                  {photos.length < MAX_COMPLETED_PHOTOS && (
                    <div onClick={() => completedFileRef.current.click()}
                      style={{ width: 88, height: 88, borderRadius: 8, border: "1.5px dashed #d1d5db", background: "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 11, cursor: "pointer", textAlign: "center", lineHeight: 1.4 }}>
                      <span style={{ fontSize: 22 }}>🏆</span>追加<br/>{photos.length}/{MAX_COMPLETED_PHOTOS}
                    </div>
                  )}
                </div>
              );
            })()}
            <input ref={completedFileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleCompletedPhoto} />

            <label style={s.label}>JANコード</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                style={{ ...s.input, flex: 1, fontFamily: "monospace" }}
                placeholder="例: 4573102631992"
                inputMode="numeric"
                value={form.jan || ""}
                onChange={(e) => setForm((f) => ({ ...f, jan: e.target.value.replace(/[^0-9]/g, "").slice(0, 13) }))}
              />
              <button
                style={{ padding: "8px 10px", background: "#f3f4f6", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                onClick={async (e) => {
                  e.preventDefault();
                  if (!form.name) return;
                  // マスタDBから商品名で照合
                  const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
                  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
                  try {
                    const q = form.name.slice(0, 30).replace(/[()（）]/g, "");
                    const r = await fetch(
                      `${SUPABASE_URL}/rest/v1/products?name=ilike.*${encodeURIComponent(q)}*&select=jan,name&limit=5`,
                      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
                    );
                    const data = await r.json();
                    if (data?.length === 1) {
                      setForm(f => ({ ...f, jan: data[0].jan }));
                      alert(`JANを更新しました: ${data[0].jan}`);
                    } else if (data?.length > 1) {
                      const choice = data.map((d, i) => `${i+1}: ${d.jan} ${d.name.slice(0,30)}`).join(", ");
                      alert(`複数候補が見つかりました。JANを手動で確認してください: ${choice}`);
                    } else {
                      alert("マスタDBに該当商品が見つかりませんでした");
                    }
                  } catch { alert("照合に失敗しました"); }
                }}>
                🔍 マスタ照合
              </button>
            </div>

            <label style={s.label}>メモ</label>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical" }} placeholder="自由にメモを残そう" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />

            {/* 編集時のみ：このキットを削除（積みプラ・完成品とも編集の中に集約） */}
            {editId !== null && (
              <button style={{ width: "100%", marginTop: 18, padding: "11px 0", background: "#fff", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                onClick={() => { if (window.confirm(`「${form.name}」を削除しますか？\nこの操作は元に戻せません。`)) { handleDelete(editId); setForm(makeEmptyForm()); setEditId(null); setShowForm(false); } }}>
                🗑 このキットを削除
              </button>
            )}
            <div style={{ height: 80 }} />
            <div style={{ position: "sticky", bottom: 0, background: "#fff", paddingTop: 10, paddingBottom: 16, marginTop: 8, borderTop: "1px solid #f0f0f0", display: "flex", gap: 10 }}>
              <button style={s.cancelBtn} onClick={() => setShowForm(false)}>キャンセル</button>
              <button style={s.saveBtn} onClick={handleSubmit}>{editId ? "更新" : "追加"}</button>
            </div>
          </div>
        </div>
      )}

      {reportTarget && (
        <PriceReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
      )}
    </div>
  );
}

const s = {
  root: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f8f9fa", fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", paddingBottom: 120 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 14px", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#111", letterSpacing: 1 },
  headerSub: { fontSize: 8, color: "#aaa", letterSpacing: 2, marginTop: 1 },
  shareBtn: { background: "#000", color: "#fff", border: "none", borderRadius: 20, padding: "8px 12px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  searchIconBtn: { background: "#f3f4f6", border: "none", borderRadius: 20, padding: 0, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
  stats: { display: "flex", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  statBox: { flex: 1, padding: "9px 0", textAlign: "center", cursor: "pointer" },
  statNum: { fontSize: 16, fontWeight: 700 },
  statLabel: { fontSize: 9, color: "#9ca3af", marginTop: 2 },
  tabs: { display: "flex", padding: "12px 16px 0", gap: 8 },
  tab: { flex: 1, padding: "8px 0", border: "none", background: "none", fontSize: 13, color: "#9ca3af", cursor: "pointer", borderBottom: "2px solid transparent", fontWeight: 500 },
  tabActive: { color: "#111", borderBottom: "2px solid #111", fontWeight: 700 },
  loadingBar: { background: "#f0fdf4", color: "#166534", padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #dcfce7" },
  list: { padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 },
  empty: { textAlign: "center", color: "#bbb", padding: "60px 0", fontSize: 14, lineHeight: 1.9 },
  card: { background: "#fff", borderRadius: 12, padding: "14px 12px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer" },
  thumb: { width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 },
  thumbPh: { width: 56, height: 56, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: 700, color: "#111", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 },
  cardMeta: { fontSize: 12, color: "#6b7280", marginTop: 3, display: "flex", gap: 6, alignItems: "center" },
  badge: { background: "#f3f4f6", borderRadius: 4, padding: "1px 6px", fontSize: 11, color: "#374151" },
  cardBottom: { display: "flex", gap: 8, marginTop: 6, alignItems: "center" },
  stars: { fontSize: 13, color: "#f59e0b", letterSpacing: 1 },
  countBadge: { fontSize: 11, background: "#f3f4f6", color: "#374151", borderRadius: 20, padding: "2px 8px", fontWeight: 600 },
  condBadge: { fontSize: 10, borderRadius: 20, padding: "2px 8px", fontWeight: 600 },
  checkBtn: { width: 32, height: 32, borderRadius: "50%", border: "none", fontSize: 15, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  fab: { width: 56, height: 56, borderRadius: "50%", color: "#fff", border: "none", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  modal: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  modalPhoto: { width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: "20px 20px 0 0" },
  modalBody: { padding: "20px 20px 32px" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#111", marginBottom: 6 },
  doneBadge: { display: "inline-block", background: "#f0fdf4", color: "#166534", borderRadius: 20, padding: "2px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  td1: { padding: "6px 0", fontSize: 12, color: "#9ca3af", width: 80, verticalAlign: "top" },
  td2: { padding: "6px 0", fontSize: 14, color: "#111" },
  wantBtn: { width: "100%", marginTop: 16, padding: "12px 0", background: "#fff0f3", color: "#e11d48", border: "1.5px solid #fecdd3", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  modalBtns: { display: "flex", gap: 8, marginTop: 12 },
  editBtn: { flex: 1, padding: "10px 0", background: "#f3f4f6", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#111" },
  deleteBtn: { flex: 1, padding: "10px 0", background: "#fee2e2", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#b91c1c" },
  closeBtn: { flex: 1, padding: "10px 0", background: "#111", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#fff" },
  formModal: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: "24px 20px 40px", boxSizing: "border-box" },
  formTitle: { fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 20 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6, marginTop: 14 },
  input: { width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, color: "#111", background: "#fafafa", boxSizing: "border-box", outline: "none" },
  photoArea: { width: "100%", height: 120, border: "1.5px dashed #d1d5db", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", marginTop: 2 },
  formBtns: { display: "flex", gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, padding: "12px 0", background: "#f3f4f6", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#374151" },
  saveBtn: { flex: 2, padding: "12px 0", background: "#111", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#fff" },
};
