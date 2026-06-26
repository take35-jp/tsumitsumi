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
// 完成写真はXシェア画像・アルバムビューアの主役。IDBには原本を無圧縮で保存する。
// 以下はIDB保存に失敗したとき限定の base64 フォールバック用設定（localStorageに収めるため圧縮）。
const COMPLETED_PHOTO_MAXPX = 1440;
const COMPLETED_PHOTO_QUALITY = 0.82;
const COMPLETED_PHOTO_MAXCHARS = 620000; // base64フォールバック（localStorage）の上限。≒450KB binary
function getCompletedPhotos(kit) {
  if (kit && Array.isArray(kit.completedPhotos) && kit.completedPhotos.length) {
    return kit.completedPhotos.filter(Boolean).slice(0, MAX_COMPLETED_PHOTOS);
  }
  if (kit && kit.completedPhotoUrl) return [kit.completedPhotoUrl];
  return [];
}

// 画像なし／画像欠損時のプレースホルダ（絵文字を使わない細線アイコン）
function PhotoPlaceholderIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="8.5" cy="8.5" r="1.6" />
      <path d="M21 15l-4.5-4.5L5 21" />
    </svg>
  );
}

// 写真 src を解決するラッパー。"idb-blob:..." なら IDB から Blob を取り object URL 化。
// それ以外（http / data: / 空）はそのまま <img> に流す。
// src が idb-blob で IDB に Blob が無い場合（孤児化・データ消失）は、真っ白ではなく
// プレースホルダを表示してユーザーに「画像が無い」状態を明示する。
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
        <div style={{ ...style, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像データが見つかりません（再アップロードしてください）">
          <PhotoPlaceholderIcon size={24} />
        </div>
      );
    }
    return null;
  }
  return <img src={resolved} style={style} alt={alt || ""} onError={onError} />;
}

// ====== サムネイル（縮小表示）======
// 一覧/グリッドで原本（無圧縮・数MB）をそのまま等倍デコードすると、枚数が多いと
// メモリを食い尽くしてクラッシュ（特に iOS のホーム画面アプリ）。
// 縮小した dataURL を作って表示し、生成はキューで1枚ずつ直列化（瞬間メモリを抑制）。
const maThumbCache = new Map(); // key: "<id>:<maxPx>" -> dataURL
let maThumbQueue = Promise.resolve();
function enqueueThumb(fn) {
  const run = maThumbQueue.then(fn, fn);
  maThumbQueue = run.then(() => {}, () => {});
  return run;
}
async function makeThumbDataUrl(blob, maxPx, quality) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
    const scale = Math.min(1, maxPx / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality);
  } finally { URL.revokeObjectURL(url); }
}
// idb-blob の写真は縮小サムネで表示。http/data: はそのまま流す（既に軽い/外部）。
function MaThumb({ src, maxPx = 480, quality = 0.7, style, alt }) {
  const [resolved, setResolved] = useState(() => (src && !isIdbBlobUrl(src)) ? src : null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    if (!src) { setResolved(null); return; }
    if (!isIdbBlobUrl(src)) { setResolved(src); return; }
    const id = idbBlobUrlToId(src);
    const key = id + ":" + maxPx;
    if (maThumbCache.has(key)) { setResolved(maThumbCache.get(key)); return; }
    setResolved(null);
    enqueueThumb(async () => {
      if (cancelled) return;
      const blob = await kitsIdbPhotoGet(id);
      if (cancelled) return;
      if (!blob) { setMissing(true); return; }
      try {
        const dataUrl = await makeThumbDataUrl(blob, maxPx, quality);
        if (cancelled) return;
        maThumbCache.set(key, dataUrl);
        setResolved(dataUrl);
      } catch (e) {
        if (!cancelled) setMissing(true); // 縮小失敗時は無理に原本を出さない（メモリ保護）
      }
    });
    return () => { cancelled = true; };
  }, [src, maxPx, quality]);
  if (!resolved) {
    if (missing) {
      return (
        <div style={{ ...style, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }} title="画像データが見つかりません（再アップロードしてください）">
          <PhotoPlaceholderIcon size={24} />
        </div>
      );
    }
    return <div style={{ ...style, background: "#f1f1f1" }} />; // 読み込み中
  }
  return <img src={resolved} style={style} alt={alt || ""} loading="lazy" />;
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

// 画像をBase64に圧縮変換（既定は長辺320px・JPEG品質0.5・約50KB相当。maxChars で上限調整可）
function compressImageToBase64(file, maxPx = 320, quality = 0.5, maxChars = 68000) {
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
      // 目標サイズ（maxChars）以下になるまで品質を下げる
      let result = canvas.toDataURL("image/jpeg", quality);
      let q = quality;
      while (result.length > maxChars && q > 0.2) {
        q -= 0.05;
        result = canvas.toDataURL("image/jpeg", q);
      }
      resolve(result);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// 画像を Blob に圧縮変換（base64 版と同じロジック・サイズ約30%軽い。maxBytes で上限調整可）
function compressImageToBlob(file, maxPx = 320, quality = 0.5, maxBytes = 51000) {
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
      // maxBytes 以下になるまで品質を下げる
      while (blob && blob.size > maxBytes && q > 0.2) {
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
                setDebugInfo(`ZBar検出: ${raw}`);
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
          <span style={sc.title}>バーコードをスキャン</span>
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
        <span style={sc.title}>バーコードをスキャン</span>
        <button style={sc.closeBtn} onClick={onClose}>✕ 閉じる</button>
      </div>
      {!imgSrc ? (
        <div>
          <div style={sc.shootBox} onClick={() => inputRef.current?.click()}>
            <div style={{ fontSize: 44, marginBottom: 10 }}></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111", marginBottom: 6 }}>バーコードを撮影する</div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>タップしてカメラを起動</div>
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 8, lineHeight: 1.8 }}>
            バーコード部分だけをアップで・明るい場所で撮影してください
          </div>
        </div>
      ) : (
        <div>
          <img src={imgSrc} style={{ width: "100%", borderRadius: 0, objectFit: "contain", maxHeight: 200, marginBottom: 10 }} alt="" />
          {scanning && <div style={sc.scanningBox}>バーコードを解析中...</div>}
          {error && (
            <div style={sc.errorBox}>
              <div style={{ whiteSpace: "pre-wrap", marginBottom: 10 }}>{error}</div>
              <button style={sc.retakeBtn} onClick={handleRetake}>撮り直す</button>
            </div>
          )}
          {!scanning && !error && (
            <button style={sc.retakeBtn2} onClick={handleRetake}>撮り直す</button>
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
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 1.7, background: "#f8f9fa", borderRadius: 0, padding: "10px 12px" }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>バーコード数字のコピー方法</div>
        <div>① カメラでバーコード<strong>下の数字</strong>を映す</div>
        <div>② 数字が認識されたらタップ→コピー</div>
        <div>③ 下の入力欄に貼り付けると自動検索</div>
      </div>
      <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
        <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, background: "#fafafa", outline: "none" }}
          placeholder="JANコード（13桁）" inputMode="numeric" value={val}
          onChange={handleChange} onPaste={handlePaste} />
        <button style={{ padding: "10px 16px", background: val.length >= 8 ? "#111" : "#d1d5db", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 600, cursor: val.length >= 8 ? "pointer" : "default" }}
          onClick={() => val.length >= 8 && onDetected(val)}>検索</button>
      </div>
    </div>
  );
}

const sc = {
  wrap: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, padding: "20px 20px 28px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "#f3f4f6", border: "none", fontSize: 13, cursor: "pointer", color: "#374151", padding: "6px 14px", borderRadius: 0, fontWeight: 600 },
  videoWrap: { position: "relative", background: "#111", borderRadius: 0, overflow: "hidden", aspectRatio: "4/3", marginBottom: 4 },
  dimOverlay: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  frame: { width: "80%", aspectRatio: "2.5/1", border: "2.5px solid #fff", borderRadius: 0, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" },
  hint: { position: "absolute", bottom: 28, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.9)", fontSize: 12 },
  tapHint: { position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center", color: "#4ade80", fontSize: 11, fontWeight: 600 },
  shootBox: { background: "#f8f9fa", border: "2px dashed #d1d5db", borderRadius: 0, padding: "36px 20px", textAlign: "center", cursor: "pointer", marginBottom: 8 },
  scanningBox: { background: "#f0fdf4", color: "#166534", borderRadius: 0, padding: "12px 16px", fontSize: 13, textAlign: "center", marginBottom: 10 },
  errorBox: { background: "#fee2e2", color: "#b91c1c", borderRadius: 0, padding: "14px 16px", fontSize: 13, marginBottom: 10 },
  retakeBtn: { display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  retakeBtn2: { width: "100%", padding: "10px 0", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 8 },
  dividerRow: { display: "flex", alignItems: "center", margin: "16px 0 12px" },
  dividerText: { fontSize: 12, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 0, padding: "3px 12px", margin: "0 auto" },
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
    n = n.replace(/[★☆◆◇■□▲▼●○※†‡]/g, '');
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
                  <span style={{ display: "inline-block", background: "#eff6ff", color: "#1d4ed8", borderRadius: 0, padding: "1px 7px", fontSize: 10, fontWeight: 700, marginBottom: 3 }}>
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
  input: { width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, color: "#111", background: "#fafafa", boxSizing: "border-box", outline: "none" },
  list: { background: "#fff", border: "1.5px solid #e5e7eb", borderRadius: 0, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", marginTop: 4, overflow: "hidden" },
  item: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", borderBottom: "1px solid #f0f0f0" },
  thumb: { width: 40, height: 40, objectFit: "cover", borderRadius: 0, flexShrink: 0 },
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
      <div style={{ background: "#fff", borderRadius: 0, padding: 20, width: "100%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>リストから一括登録</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input
            type="text"
            value={browseQuery}
            onChange={(e) => setBrowseQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); search(1, browseQuery); } }}
            placeholder="例: バンダイ HG ガンダム（スペース区切りでAND検索）"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 0, border: "1.5px solid #d1d5db", fontSize: 14 }}
          />
          <button
            onClick={() => { setPage(1); search(1, browseQuery); }}
            style={{ padding: "10px 16px", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            検索
          </button>
        </div>

        <div style={{ background: "#fff8e1", borderRadius: 0, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.7, wordBreak: "break-word" }}>
            注意：登録される情報は商品名・画像のみです。購入日・価格・状態などの詳細は登録後に個別に編集してください。
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
                  <div key={key} onClick={() => toggleSelect(item)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: isSelected ? "#dcfce7" : "#fff", border: "1.5px solid", borderColor: isSelected ? "#22c55e" : "#e5e7eb", borderRadius: 0, marginBottom: 6, cursor: "pointer" }}>
                    {item.image_url && <img src={item.image_url} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 0 }} />}
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
                style={{ padding: "6px 16px", border: "1.5px solid #d1d5db", background: page <= 1 ? "#f3f4f6" : "#fff", borderRadius: 0, fontSize: 13, cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.5 : 1 }}
                onClick={() => { const p = page - 1; setPage(p); search(p); }}>← 前へ</button>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{page} / {Math.ceil(total / 20) || 1} ページ ({total}件)</span>
              {page * 20 < total && (
                <button style={{ padding: "6px 16px", border: "1.5px solid #d1d5db", background: "#fff", borderRadius: 0, fontSize: 13, cursor: "pointer" }}
                  onClick={() => { const p = page + 1; setPage(p); search(p); }}>次へ →</button>
              )}
            </div>

            {/* 一括登録ボタン */}
            {selectedCount > 0 && (
              <button style={{ width: "100%", padding: "14px", background: "#22c55e", color: "#fff", border: "none", borderRadius: 0, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
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
        <span style={hs.title}>バックアップ</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

      {msg && (
        <div style={{ background: msgType === "ok" ? "#f0fdf4" : "#fee2e2", color: msgType === "ok" ? "#166534" : "#b91c1c", borderRadius: 0, padding: "10px 14px", fontSize: 13, marginBottom: 16, wordBreak: "break-word" }}>
          {msg}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#f8f9fa", borderRadius: 0, padding: "16px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>エクスポート（バックアップ）</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 }}>現在の積みプラデータをJSONファイルとして保存します。iCloudやGoogleドライブに保存しておくと安心です。</div>
          <button
            style={{ width: "100%", padding: "12px 0", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            onClick={handleExport}>
            ダウンロード（{kits.length}件）
          </button>
        </div>

        <div style={{ background: "#f8f9fa", borderRadius: 0, padding: "16px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 6 }}>インポート（復元）</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 }}>バックアップファイルからデータを復元します。現在のデータは上書きされます。</div>
          <button
            style={{ width: "100%", padding: "12px 0", background: "#fff", color: "#111", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            onClick={() => fileRef.current.click()}>
            ファイルを選択
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
        </div>
      </div>

      <div style={{ background: "#fff8e1", borderRadius: 0, padding: "12px 14px", marginTop: 4 }}>
        <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.7, wordBreak: "break-word" }}>
          <strong>注意：</strong>SafariとChromeなど、ブラウザの種類が異なるとデータは別々に保存されます。異なるブラウザへ移行する場合は、必ずエクスポートしてからインポートしてください。
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
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 0, padding: "3px 4px 3px 10px", fontSize: 11, fontWeight: 600, userSelect: "none", WebkitUserSelect: "none" }}>
      <span onClick={onApply} style={{ color: "#166534", cursor: "pointer" }}>#{tag}</span>
      <button onClick={onRemove} title="選択キットから外す"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 20, padding: "0 8px", background: "#ef4444", borderRadius: 0, color: "#fff", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>
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
    <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 0, padding: "8px 10px", background: "#fafafa" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: tags.length > 0 ? 8 : 0 }}>
        {tags.map(tag => (
          <span key={tag}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "#f0fdf4",
              color: "#166534",
              borderRadius: 0, padding: "5px 6px 5px 12px", fontSize: 13, fontWeight: 600,
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
                background: "#ef4444", border: "none", borderRadius: 0,
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
              style={{ background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 0, padding: "2px 10px", fontSize: 11, color: "#374151", cursor: "pointer" }}>
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
          style={{ background: "#111", color: "#fff", border: "none", borderRadius: 0, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
          onClick={() => addTag(input)}>追加</button>
      </div>
    </div>
  );
}

// ---- 全バージョン履歴モーダル ----
function AllVersionsModal({ onClose }) {
  const versions = [
    { ver: "v1.44", date: "2026/06/20", isNew: true, items: ["モデラーズアルバムに初回アクセス時の案内ポップアップを追加（ホーム画面追加とHELPの確認を案内・1回のみ表示）"] },
    { ver: "v1.43", date: "2026/06/20", isNew: false, items: ["モデラーズアルバムの左下に「TIPS」「TOOLS」へのリンクボタンを追加（プラモTIPS・おすすめ定番アイテムへ）"] },
    { ver: "v1.42", date: "2026/06/20", isNew: false, items: ["モデラーズアルバムに「このアプリを共有」ボタンを追加（画面右上・バックアップの左。対応端末は共有シート、PCはURLコピー）"] },
    { ver: "v1.41", date: "2026/06/19", isNew: false, items: ["モデラーズアルバムの一覧・サムネを縮小表示にして軽量化（写真の多いアルバムでの動作を安定化。拡大時は元の高画質を表示）"] },
    { ver: "v1.40", date: "2026/06/19", isNew: false, items: ["モデラーズアルバムのバックアップ復元（ZIP取り込み）で、写真が表示されない不具合を修正（iPhoneのホーム画面アプリで発生）"] },
    { ver: "v1.39", date: "2026/06/19", isNew: false, items: ["「モデラーズアルバム」を正式公開。画面右上のロゴボタンから全画面で起動できるように", "画面右上のシェア系ボタンを「Xでシェア」に一本化（アイコンは𝕏）"] },
    { ver: "v1.38", date: "2026/06/19", isNew: false, items: ["アプリ全体のデザインを角丸から長方形（角ゼロ）に統一（タグ・称号・バッジに加え、ボタン・カード・モーダルなどすべて）"] },
    { ver: "v1.37", date: "2026/06/16", isNew: false, items: ["「モデラーズアルバム」を新設（作品ポートフォリオ）。1アルバム最大30枚を高画質のまま保存でき、作成年月・自由タグ・制作コメントを記録。写真はタップで拡大。白黒ミニマルなデザイン"] },
    { ver: "v1.36", date: "2026/06/16", isNew: false, items: ["「これを作ってくれる人に譲りたい！」のXシェアで、キットの画像も一緒に投稿できるように（スマホは画像つきで共有、PCは画像を保存してから投稿画面へ）"] },
    { ver: "v1.35", date: "2026/06/13", isNew: false, items: ["完成品アルバムのXシェア画像を高画質化（完成写真を圧縮せず原本のまま保存し、シェア画像も2倍の高精細に）"] },
    { ver: "v1.34", date: "2026/06/13", isNew: false, items: ["キット削除時に「本当に削除しますか？」の確認ダイアログを表示するように（誤操作による削除を防止）"] },
    { ver: "v1.33", date: "2026/06/13", isNew: false, items: ["アプリ画面のデザインを刷新（装飾的なアイコン・絵文字を整理してスタイリッシュに）", "画面最上段の完成アルバム共有ボタンを削除（共有は完成品の詳細から）"] },
    { ver: "v1.32", date: "2026/06/13", isNew: false, items: ["完成写真を最大6枚まで登録可能に", "完成タブを「完成品アルバム」に刷新（サムネをタップで写真ギャラリーを表示）", "完成済みキットのカードに「シェア」ボタンを追加（その完成品の写真を1枚の画像にまとめてXシェア）"] },
    { ver: "v1.31", date: "2026/06/13", isNew: false, items: ["完成済みキットの「完成アルバム」シェア機能を追加（完成写真を大きく見せるリッチな画像を生成してXに投稿。表紙＋ショーケース・称号入り）"] },
    { ver: "v1.30", date: "2026/05/30", isNew: false, items: ["積みプラ数のランクの上限を更新"] },
    { ver: "v1.29", date: "2026/05/25", isNew: false, items: ["キット詳細に「Amazonで関連商品を見る」ボタンを追加（運営費補填のためアフィリエイトリンクを利用）"] },
    { ver: "v1.28", date: "2026/05/25", isNew: false, items: ["時間が経つと一部キットの登録画像が消えて マークだけ残る不具合の根本対策（ブラウザのストレージ永続化を要求）"] },
    { ver: "v1.27", date: "2026/05/24", isNew: false, items: ["1回スキャンで登録済みJANをキャンセルした後にカメラが固まる問題を、スキャナーを一瞬閉じて再起動する方式で確実に解消"] },
    { ver: "v1.26", date: "2026/05/24", isNew: false, items: ["1回スキャンで登録済みJANをキャンセルしたあとカメラ画面が止まる不具合を修正（即時に再撮影できる）"] },
    { ver: "v1.25", date: "2026/05/24", isNew: false, items: ["連続バーコードスキャン時の同一JAN確認ダイアログをアプリ内モーダル化（iOSでカメラが固まる不具合を解消）", "1回スキャンで登録済みJANを読み込んでキャンセルしたとき、既存キット詳細を開かずカメラ撮影に戻るよう変更"] },
    { ver: "v1.24", date: "2026/05/24", isNew: false, items: ["連続バーコードスキャンのフリーズ対策（並列WASMスキャン抑止・カメラ自動復帰）", "登録済み箱画像の保存先が壊れたときに「」プレースホルダを表示（真っ白にならないよう改善）"] },
    { ver: "v1.23", date: "2026/05/24", isNew: false, items: ["スケール選択肢に「自由入力」を追加（独自表記やマイナースケールも登録可）", "称号行に「プラモを預ける」リンクを追加（トランクルームのご案内）", "Xシェアの複数ページ画像を全部保存できるよう改善（プレビュー表示・個別保存ボタン・対応端末で一括共有）", "Xシェアの「✕ 閉じる」ボタンを大きく押しやすく", "キット数が多い方の入力遅延・もたつきを大幅改善"] },
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
    { ver: "v1.00", date: "2026/05/01", isNew: false, items: ["TSUMITSUMI 正式リリース", "バーコードスキャン登録", "キット一覧管理機能", "総額表示機能", "一括登録機能", "Xシェア画像生成", "情報誤り報告機能", "バックアップ機能", "グリッド・リスト表示"] },
  ];
  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>すべての更新履歴</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {versions.map((v, i) => (
          <div key={v.ver} style={{ background: v.isNew ? "#f0fdf4" : "#fafafa", border: `1px solid ${v.isNew ? "#bbf7d0" : "#e5e7eb"}`, borderRadius: 0, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              {v.isNew && <span style={{ background: "#22c55e", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 0, padding: "1px 7px" }}>NEW</span>}
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
      <div style={{ height: 8, background: '#1f2937', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{ width: Math.max(pct, 0.5) + '%', height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      {pct >= 80 && (
        <div style={{ marginTop: 8, color, fontSize: 12 }}>
          容量が逼迫しています。古いキットや画像の削除を検討してください。
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
        <span style={hs.title}>ヘルプ・使い方</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

        <div style={hs.section}>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="https://tsumitsumi.vercel.app/manual.html" target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, padding: "14px 12px", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, textDecoration: "none", color: "#166534", fontWeight: 700, textAlign: "center", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
              使い方はコチラ →
            </a>
            <button
              onClick={onToggleTheme}
              type="button"
              aria-label={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
              style={{ flexShrink: 0, padding: "14px 16px", background: "#fef3c7", border: "1.5px solid #fcd34d", borderRadius: 0, color: "#78350f", fontWeight: 700, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
              {theme === "dark" ? "ライト" : "ダーク"}
            </button>
          </div>
        </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>保存容量</div>
        <div style={hs.desc}><StorageGauge kits={kits} /></div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>写真を新形式に変換（容量節約）</div>
        <div style={hs.desc}>
          古い形式（base64）で保存された写真を新形式（Blob）に変換します。<br/>
          容量が約30%節約され、写真は同じものが見られます。
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 10 }}>対象: {migrateTargetCount}件のキット</div>
        <button
          onClick={onMigratePhotos}
          disabled={migrateLoading || migrateTargetCount === 0}
          style={{
            width: "100%", padding: "10px 16px", border: "none", borderRadius: 0,
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
        <div style={hs.sectionTitle}>データについての注意</div>
        <div style={hs.item}><span style={hs.warn}>!</span>データはブラウザ内に保存されます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>Safariの「履歴とデータを消去」でデータが消えます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>SafariとChromeなど別ブラウザ間でデータは共有されません</div>
        <div style={hs.item}><span style={hs.warn}>!</span>機種変更・初期化の際はデータが引き継がれません</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>データのバックアップ・機種変更</div>
        <div style={hs.desc}>データはブラウザ内にのみ保存されるため、機種変更や初期化の前にバックアップをお取りください。</div>
        <div style={hs.item}><span style={hs.num}>1</span>画面右上の「⋯」メニュー（または設定）から「エクスポート」をタップ</div>
        <div style={hs.item}><span style={hs.num}>2</span>ダウンロードされたJSONファイルをiCloudやGoogleドライブに保存</div>
        <div style={hs.item}><span style={hs.num}>3</span>新しい端末で同じURLを開き、「インポート」からファイルを読み込む</div>
        <div style={hs.tip}>定期的にエクスポートしておくと安心です</div>
      </div>
      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 12 }}>お問い合わせ・バグ報告はこちら</div>
        <a
          href="https://x.com/tsumitsumi_pla"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#000", color: "#fff", borderRadius: 0, padding: "10px 20px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
          𝕏 @tsumitsumi_pla
        </a>
      </div>

      {/* TIPS記事一覧（更新履歴の直前に配置・新しい記事は配列の先頭に追加していく） */}
      <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>プラモ製作 TIPS</span>
          <a href="/tips/" target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: "#4f8ef7", textDecoration: "underline" }}>
            すべて見る →
          </a>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { title: "プラモの組み立て手順 完全ガイド", desc: "説明書の読み方・ランナーやゲートの呼び名・二度切りの基本まで、はじめての1体を図解で完走", url: "/tips/assembly-basics.html", date: "2026/06/23" },
            { title: "塗装しないで見栄えを上げる｜初心者の色入れ入門", desc: "シール・スミ入れ・部分塗装・つや消しの4つだけで素組みを卒業。失敗しない順番を図解で", url: "/tips/beginner-color.html", date: "2026/06/23" },
            { title: "完成品の保管・ホコリ対策・飾り方", desc: "黄ばみ・劣化を防ぐ収納術と、積みプラ（未組立）の正しい保管を図解で解説", url: "/tips/storage-display.html", date: "2026/06/23" },
            { title: "プラモ用接着剤の種類と選び方 完全ガイド", desc: "流し込み・白キャップ・瞬間・エポキシの違いと使い分けを図解。迷ったらまず1本", url: "/tips/glue-types.html", date: "2026/06/23" },
          ].map((t, i) => (
            <a key={i} href={t.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "block", padding: "10px 12px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 0, textDecoration: "none", color: "#111" }}>
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
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>更新履歴</span>
          <button
            style={{ fontSize: 11, color: "#4f8ef7", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => window.__showAllVersions && window.__showAllVersions()}>
            すべて見る
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* v1.44 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ background: "#22c55e", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 0, padding: "1px 7px" }}>NEW</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.44</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/06/20</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・モデラーズアルバムに初回アクセス時の案内ポップアップを追加（ホーム画面追加・HELP確認の案内）
            </div>
          </div>
          {/* v1.43 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.43</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/06/20</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・モデラーズアルバムの左下に「TIPS」「TOOLS」へのリンクボタンを追加
            </div>
          </div>
          {/* v1.42 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.42</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/06/20</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・モデラーズアルバムに「このアプリを共有」ボタンを追加（画面右上・バックアップの左）
            </div>
          </div>
        </div>
      </div>

      <div style={hs.section}>
        <div style={hs.sectionTitle}>プライバシーポリシー</div>
        <div style={hs.desc}>本サービスのプライバシーポリシー、アフィリエイト広告に関する表記、免責事項は別ページにまとめています。</div>
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "10px 14px", background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 0, textDecoration: "none", color: "#111", fontSize: 13, fontWeight: 600, textAlign: "center", marginTop: 8 }}>プライバシーポリシーを開く →</a>
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
  wrap: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, padding: "20px 20px 40px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
  section: { marginBottom: 20, borderBottom: "1px solid #f0f0f0", paddingBottom: 16, boxSizing: "border-box", width: "100%" },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 10 },
  desc: { fontSize: 13, color: "#6b7280", lineHeight: 1.7, marginBottom: 8, wordBreak: "break-word", overflowWrap: "anywhere" },
  item: { display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "#374151", marginBottom: 6, lineHeight: 1.6, wordBreak: "break-word", overflowWrap: "anywhere" },
  num: { minWidth: 20, height: 20, background: "#111", color: "#fff", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  warn: { minWidth: 20, height: 20, background: "#f59e0b", color: "#fff", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1 },
  tip: { fontSize: 12, color: "#4f8ef7", background: "#eff6ff", borderRadius: 0, padding: "6px 10px", marginTop: 8, wordBreak: "break-word", overflowWrap: "anywhere", boxSizing: "border-box", whiteSpace: "normal", display: "block" },
};

// ---- App Share Modal ----
function AppShareModal({ onClose }) {
  const url = "https://tsumitsumi.vercel.app";
  const text = "積みプラ管理アプリ「TSUMI TSUMI」\nバーコードスキャンで簡単登録！\n#TSUMITSUMI #ツミツミ";
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
      label: "URLをコピー",
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
      label: "共有メニューを開く",
      sub: "LINEやメールなど",
      color: "#4f8ef7",
      action: shareNative,
      hide: !navigator.share,
    },
  ];

  return (
    <div style={as.wrap}>
      <div style={as.header}>
        <span style={as.title}>TSUMI TSUMIを共有</span>
        <button style={as.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={as.appCard}>
        <div style={{ fontSize: 36, marginBottom: 8 }}></div>
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
  wrap: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, padding: "20px 20px 40px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { fontSize: 16, fontWeight: 700, color: "#111" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
  appCard: { background: "#f8f9fa", borderRadius: 0, padding: "20px", textAlign: "center", marginBottom: 20 },
  btn: { width: "100%", padding: "14px 16px", color: "#fff", border: "none", borderRadius: 0, cursor: "pointer", textAlign: "left" },
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
        <span style={hs.title}>タグ編集</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>新しいタグを作成</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            style={{ flex: 1, border: "1.5px solid #e5e7eb", borderRadius: 0, padding: "6px 10px", fontSize: 13, color: "#111", outline: "none", minWidth: 0 }}
            placeholder="タグ名（例：プレバン限定品）"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewTag(); } }}
          />
          <button
            style={{ background: "#111", color: "#fff", border: "none", borderRadius: 0, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
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
            <div key={tag} style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 0, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 }}>
              {editingTag === tag ? (
                <>
                  <input
                    style={{ flex: 1, border: "1.5px solid #4f8ef7", borderRadius: 0, padding: "4px 8px", fontSize: 13, color: "#111", outline: "none", minWidth: 0 }}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(tag); } else if (e.key === "Escape") cancelEdit(); }}
                    autoFocus
                  />
                  <button
                    style={{ background: "#10b981", color: "#fff", border: "none", borderRadius: 0, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
                    onClick={() => saveEdit(tag)}>保存</button>
                  <button
                    style={{ background: "#fff", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 0, padding: "4px 10px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                    onClick={cancelEdit}>取消</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13, color: "#111", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                    #{tag}<span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{count}件{totalPrice > 0 ? ` ¥${totalPrice.toLocaleString()}` : ""}</span>
                  </span>
                  <button
                    style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 0, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                    onClick={() => startEdit(tag)}>編集</button>
                  <button
                    style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 0, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
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
        ctx.fillText("", x + cardW / 2, y + cardH / 2);
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
  const SCALE = 2; // 出力解像度を2倍に（2160x2700）。レイアウト計算は論理座標(W/H)のまま
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
  canvas.width = W * SCALE; canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE); // 以降は論理座標(W/H)で描画。画素は2倍で出力される
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
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
    else { ctx.fillStyle = "#1e1e1e"; ctx.fillRect(x, y, cellW, cellH); ctx.fillStyle = "#444"; ctx.font = "48px 'Arial'"; ctx.textAlign = "center"; ctx.fillText("", x + cellW / 2, y + cellH / 2); ctx.textAlign = "left"; }
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
    return `積みプラ ${targetKits.length}件 を公開中！

#TSUMITSUMI #ツミツミ`;
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
    const pageNote = pages > 1 ? `（全${pages}枚）` : "";
    return `積みプラ ${count}件 を公開中！${pageNote}

#TSUMITSUMI #ツミツミ`;
  };

  return (
    <div style={xs.wrap}>
      <div style={xs.header}><span style={xs.title}>𝕏 積みプラをシェア</span><button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button></div>
      {pending.length === 0 ? <div style={xs.empty}>積みプラが登録されていません</div> : (<>
        <label style={xs.label}>あなたのX ID（省略可）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <span style={{ color: "#9ca3af", fontSize: 16 }}>@</span>
          <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, background: "#fafafa", outline: "none" }}
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
        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, padding: "14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>画像を生成してシェア</div>
          <div style={{ fontSize: 11, color: "#166534", marginBottom: 10 }}>
            {targetKits.length}件 → 画像{totalPages}枚（1枚あたり最大68件）
          </div>
          <button style={{ width: "100%", padding: "12px 0", background: generating ? "#d1d5db" : "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: generating ? "default" : "pointer" }}
            onClick={handleGenerateImages} disabled={generating}>
            {generating ? "生成中..." : `画像を生成してダウンロード（${totalPages}枚）`}
          </button>
          {generatedCount > 0 && (
            <div style={{ marginTop: 10, background: "#dcfce7", borderRadius: 0, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
                {generatedCount}枚の画像を生成しました
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7, marginBottom: 10 }}>
                <b>スマホの方</b>：各画像の下の「保存」ボタンで共有メニューから「画像を保存」を選んでください。<br/>
                <b>PCの方</b>：1枚目は自動ダウンロード済み。残りは「保存」ボタンで個別に保存できます。
              </div>
              {canNativeShareImages && (
                <button onClick={handleNativeShare}
                  style={{ display: "block", width: "100%", padding: "13px 0", marginBottom: 10, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                  全画像をまとめて共有（X等を選択）
                </button>
              )}
              {/* 各ページのプレビュー＋個別保存（data URL 利用で iOS でも確実に表示） */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {generatedDataUrls.map((url, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 0, padding: 8 }}>
                    <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginBottom: 6 }}>画像 {i + 1} / {generatedDataUrls.length}</div>
                    <img src={url} alt={`page ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 0, marginBottom: 6 }} />
                    <button onClick={() => handleSaveOne(i)}
                      style={{ display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 13, fontWeight: 700, textAlign: "center", cursor: "pointer", boxSizing: "border-box" }}>
                      画像 {i + 1} を保存
                    </button>
                  </div>
                ))}
              </div>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweetForImage(targetKits.length, generatedCount))}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "13px 0", background: "#000", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
                𝕏 Xを開いて投稿する（保存した画像を添付）
              </a>
            </div>
          )}
        </div>

        {/* テキストのみ投稿 */}
        <button style={{ width: "100%", padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
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
    if (isSingle) {
      const grade = singleKit.scale ? `（${singleKit.scale}）` : "";
      return `完成しました！\n${singleKit.name}${grade}\n\n#TSUMITSUMI #ツミツミ`;
    }
    const rankLine = rank && rank.label ? `称号: ${rank.label}\n` : "";
    return `完成したプラモを公開！\n完成 ${totalCount}体\n${rankLine}#TSUMITSUMI #ツミツミ`;
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
      <div style={xs.header}><span style={xs.title}>{isSingle ? "完成品をシェア" : "完成アルバムをシェア"}</span><button style={xs.closeBtn} onClick={onClose}>✕ 閉じる</button></div>
      {!isSingle && completed.length === 0 ? (
        <div style={xs.empty}>完成済みのキットがありません。<br/>キットを「完成済み」にすると、完成写真でリッチなアルバムを作れます。</div>
      ) : (<>
        {isSingle ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0 }}>
            {getCompletedPhotos(singleKit)[0] && <KitImage src={getCompletedPhotos(singleKit)[0]} style={{ width: 48, height: 48, borderRadius: 0, objectFit: "cover" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{singleKit.name}</div>
              <div style={{ fontSize: 11, color: "#166534" }}>完成写真 {singlePhotoCount} 枚を1枚の画像にまとめます</div>
            </div>
          </div>
        ) : (<>
          <label style={xs.label}>アルバムのタイトル</label>
          <input style={{ width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, background: "#fafafa", outline: "none", marginBottom: 14, boxSizing: "border-box" }}
            placeholder="完成コレクション" value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} />
        </>)}

        <label style={xs.label}>あなたのX ID（省略可）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <span style={{ color: "#9ca3af", fontSize: 16 }}>@</span>
          <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, background: "#fafafa", outline: "none" }}
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

        <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 0, padding: "14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#166534", marginBottom: 6 }}>完成写真でアルバムを生成</div>
          <div style={{ fontSize: 11, color: "#166534", marginBottom: 10 }}>
            {isSingle
              ? `完成写真 ${singlePhotoCount}枚 → 1枚の画像にまとめます`
              : `${targetKits.length}件 → 表紙＋ショーケース 計${totalPages}枚（1ページ4件・完成写真を大きく表示）`}
          </div>
          <button style={{ width: "100%", padding: "12px 0", background: (generating || targetKits.length === 0) ? "#d1d5db" : "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: (generating || targetKits.length === 0) ? "default" : "pointer" }}
            onClick={handleGenerate} disabled={generating || targetKits.length === 0}>
            {generating ? "生成中..." : (isSingle ? "画像を生成" : `アルバム画像を生成（${totalPages}枚）`)}
          </button>
          {generatedBlobs.length > 0 && (
            <div style={{ marginTop: 10, background: "#dcfce7", borderRadius: 0, padding: "12px 14px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 6 }}>
                {generatedBlobs.length}枚のアルバム画像を生成しました
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7, marginBottom: 10 }}>
                <b>スマホの方</b>：各画像の「保存」ボタンで共有メニューから「画像を保存」を選んでください。<br/>
                <b>PCの方</b>：1枚目は自動ダウンロード済み。残りは「保存」で個別に保存できます。
              </div>
              {canNativeShareImages && (
                <button onClick={handleNativeShare}
                  style={{ display: "block", width: "100%", padding: "13px 0", marginBottom: 10, background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
                  全画像をまとめて共有（X等を選択）
                </button>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {generatedDataUrls.map((url, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 0, padding: 8 }}>
                    <div style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginBottom: 6 }}>{i === 0 ? "表紙" : `ショーケース ${i}`} / 全{generatedDataUrls.length}枚</div>
                    <img src={url} alt={`album ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 0, marginBottom: 6 }} />
                    <button onClick={() => handleSaveOne(i)}
                      style={{ display: "block", width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 13, fontWeight: 700, textAlign: "center", cursor: "pointer", boxSizing: "border-box" }}>
                      この画像を保存
                    </button>
                  </div>
                ))}
              </div>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweet())}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "13px 0", background: "#000", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
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
            style={{ width: "100%", marginTop: 14, padding: "12px 0", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            編集して完成写真を追加
          </button>
        )}
        {onUncomplete && (
          <button onClick={() => onUncomplete(kit)}
            style={{ width: "100%", marginTop: 10, padding: "10px 0", background: "#fff", color: "#6b7280", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            完成を解除
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
      <div style={{ position: "relative", width: "100%", background: "#0a0a0a", borderRadius: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "1/1", maxHeight: "40vh" }}>
        <KitImage src={cur} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        {photos.length > 1 && (<>
          <button onClick={() => go(-1)} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 0, border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 20, cursor: "pointer" }}>‹</button>
          <button onClick={() => go(1)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, borderRadius: 0, border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 20, cursor: "pointer" }}>›</button>
          <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 0 }}>{safeIdx + 1} / {photos.length}</div>
        </>)}
      </div>
      {/* サムネイルストリップ */}
      {photos.length > 1 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
          {photos.map((url, i) => (
            <div key={i} onClick={() => setIdx(i)}
              style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 0, overflow: "hidden", border: `2px solid ${i === safeIdx ? "#22c55e" : "#e5e7eb"}`, cursor: "pointer" }}>
              <KitImage src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ))}
        </div>
      )}
      {/* メタ情報（★は完成品では非表示） */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {kit.scale && <span style={{ fontSize: 12, fontWeight: 700, background: "#f3f4f6", color: "#374151", borderRadius: 0, padding: "3px 10px" }}>{kit.scale}</span>}
        {kit.series && <span style={{ fontSize: 12, color: "#9ca3af" }}>{kit.series}</span>}
      </div>
      {/* 操作ボタン：編集（写真の追加削除・各項目）／シェア */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {onEdit && (
          <button onClick={() => onEdit(kit)}
            style={{ flex: 1, padding: "12px 0", background: "#f3f4f6", color: "#111", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            編集
          </button>
        )}
        {onShare && (
          <button onClick={() => onShare(kit)}
            style={{ flex: 1, padding: "12px 0", background: "#000", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            シェア
          </button>
        )}
      </div>
      {onUncomplete && (
        <button onClick={() => onUncomplete(kit)}
          style={{ width: "100%", marginTop: 10, padding: "10px 0", background: "#fff", color: "#6b7280", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          完成を解除
        </button>
      )}
    </div>
  );
}

const xs = {
  wrap: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, padding: "20px 20px 32px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "#f3f4f6", border: "1.5px solid #e5e7eb", fontSize: 14, fontWeight: 700, cursor: "pointer", color: "#111", padding: "10px 18px", borderRadius: 0, minHeight: 40, whiteSpace: "nowrap" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6 },
  empty: { textAlign: "center", color: "#bbb", padding: "32px 0", fontSize: 14 },
  modeRow: { display: "flex", gap: 8, marginBottom: 14 },
  modeBtn: { flex: 1, padding: "8px 0", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#6b7280" },
  modeBtnActive: { background: "#111", color: "#fff", border: "1.5px solid #111" },
  kitList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 14, maxHeight: 220, overflowY: "auto" },
  kitRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 0, cursor: "pointer" },
  checkbox: { width: 20, height: 20, borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  kitThumb: { width: 36, height: 36, borderRadius: 0, objectFit: "cover", flexShrink: 0 },
  kitName: { fontSize: 13, fontWeight: 600, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  kitMeta: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  previewBox: { background: "#f8f9fa", borderRadius: 0, padding: "12px 14px", marginBottom: 14 },
  previewLabel: { fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 6 },
  previewText: { fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", lineHeight: 1.6 },
  tweetBtn: { width: "100%", padding: "14px 0", background: "#000", color: "#fff", border: "none", borderRadius: 0, fontSize: 15, fontWeight: 700, cursor: "pointer" },
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
        <div style={s.formTitle}>情報の誤りを報告</div>
        {done ? (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}></div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "#111" }}>ご報告ありがとうございました</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>運営にて確認いたします</div>
          </div>
        ) : (
          <>
            <div style={{ background: "#f8f9fa", borderRadius: 0, padding: "12px 14px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
              {target.photoUrl ? (
                <KitImage src={target.photoUrl} style={{ width: 50, height: 50, borderRadius: 0, objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 50, height: 50, borderRadius: 0, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 22 }}></div>
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
                style={{ width: "100%", padding: "10px 0", marginBottom: 14, background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 0, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                onClick={() => {
                  const q = `${target.jan || target.name || ""} 希望小売価格`.trim();
                  window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
                }}>
                Webで検索（JAN＋希望小売価格）
              </button>
            )}
            <label style={s.label}>正しい価格(税込)<span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>※どちらか必須</span></label>
            <input style={s.input} placeholder="例: 7700" inputMode="numeric" value={reportedPrice} onChange={(e) => setReportedPrice(e.target.value.replace(/[^0-9]/g, ""))} />
            <label style={s.label}>コメント(任意・200文字以内)</label>
            <textarea style={{ ...s.input, minHeight: 70, fontFamily: "inherit", resize: "vertical" }} placeholder="情報源(公式サイト等)・補足情報など" value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} />
            <div style={{ fontSize: 10, color: "#9ca3af", textAlign: "right", marginTop: 2 }}>{comment.length}/200</div>
            {errMsg && (<div style={{ marginTop: 10, padding: "8px 12px", background: "#fee2e2", color: "#b91c1c", borderRadius: 0, fontSize: 12 }}>{errMsg}</div>)}
            <div style={s.formBtns}>
              <button style={s.cancelBtn} onClick={onClose} disabled={submitting}>キャンセル</button>
              <button style={s.saveBtn} onClick={handleSubmit} disabled={submitting}>{submitting ? "送信中..." : "報告を送信"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============== MODELERS ALBUM（モデラーのポートフォリオ：端末内・高画質・白黒ミニマル） ==============
const MA_FONT = "'Helvetica Neue', 'Inter', 'Segoe UI', 'Noto Sans JP', system-ui, sans-serif";
const MA_TAGS = "#モデラーズアルバム #TSUMITSUMI"; // モデラーズアルバムのXシェア既定ハッシュタグ
const MAX_ALBUM_PHOTOS = 30;
const MA_LS_KEY = "tsumitsumi_modeler_albums";
const MA_INTRO_KEY = "tsumitsumi_modeler_intro_seen"; // 初回アクセス時の案内ポップアップを1回だけ出すためのフラグ

function fmtYM(ym) {
  if (!ym) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${m[1]}.${m[2]}` : ym;
}

// モデラーズアルバム：写真は {url, caption} で保持（旧データ＝文字列は移行）
function maNormPhotos(arr) {
  return (Array.isArray(arr) ? arr : []).map(p => (typeof p === "string" ? { url: p, caption: "" } : { url: (p && p.url) || "", caption: (p && p.caption) || "" })).filter(p => p.url);
}
async function maLoadImage(src) {
  if (!src) return null;
  let url = src;
  if (isIdbBlobUrl(src)) {
    const blob = await kitsIdbPhotoGet(idbBlobUrlToId(src));
    if (!blob) return null;
    // objectURL の revoke タイミング問題（端末によりcanvas描画前に無効化され画像が抜ける）を避けるため dataURL 化
    url = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result || null); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
    if (!url) return null;
  } else if (!src.startsWith("data:")) {
    url = `/api/image-proxy?url=${encodeURIComponent(src)}`;
  }
  return await new Promise(res => {
    const im = new Image();
    if (typeof url === "string" && url.startsWith("http")) im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });
}
function maDrawCover(ctx, img, dx, dy, dw, dh) {
  if (!img) { ctx.fillStyle = "#ececec"; ctx.fillRect(dx, dy, dw, dh); return; }
  const iw = img.naturalWidth, ih = img.naturalHeight, s = Math.max(dw / iw, dh / ih), w = iw * s, h = ih * s;
  ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
  ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h); ctx.restore();
}
// cover を基準にズーム(z≥1)＋位置(ox,oy∈[0,1])で描画（BaAdjust のプレビューと同じ計算）
function maDrawTransformed(ctx, img, dx, dy, dw, dh, t) {
  if (!img) { ctx.fillStyle = "#ececec"; ctx.fillRect(dx, dy, dw, dh); return; }
  const z = (t && t.z) || 1, ox = (t && t.ox != null) ? t.ox : 0.5, oy = (t && t.oy != null) ? t.oy : 0.5;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.max(dw / iw, dh / ih) * z, w = iw * s, h = ih * s;
  ctx.save(); ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
  ctx.drawImage(img, dx - (w - dw) * ox, dy - (h - dh) * oy, w, h); ctx.restore();
}
// 写真領域の下部にコメント帯（半透明黒＋白文字・1行省略）を重ねる
function maCaptionBand(ctx, text, x, y, w, h, fontSize) {
  const cap = (text || "").trim();
  if (!cap) return;
  ctx.font = `600 ${fontSize}px ${MA_FONT}`;
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  const padX = Math.round(fontSize * 0.7);
  const padY = Math.round(fontSize * 0.5);
  const lineH = Math.round(fontSize * 1.32);
  let lines = maWrap(ctx, cap, w - padX * 2); // 折り返して全文
  const maxLines = Math.max(1, Math.floor((h - padY * 2) / lineH)); // セルに物理的に収まる最大行数
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > w - padX * 2) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  const bandH = lines.length * lineH + padY * 2;
  ctx.fillStyle = "rgba(0,0,0,0.62)"; ctx.fillRect(x, y + h - bandH, w, bandH);
  ctx.fillStyle = "#fff";
  let ty = y + h - bandH + padY + Math.round(fontSize * 0.92);
  for (const ln of lines) { ctx.fillText(ln, x + padX, ty); ty += lineH; }
}
function maWrap(ctx, text, maxW) {
  const out = [];
  (text || "").split(/\n/).forEach(line => {
    let cur = "";
    for (const ch of Array.from(line)) {
      if (cur && ctx.measureText(cur + ch).width > maxW) { out.push(cur); cur = ch; } else cur += ch;
    }
    out.push(cur);
  });
  return out;
}
// 1写真：ヘッダー（黒帯）にコメントを入れた画像
async function generateModelerPhotoImage(photo, album) {
  const S = 2, W = 1080, padX = 48;
  const img = await maLoadImage(photo && photo.url);
  const caption = ((photo && photo.caption) || "").trim() || (album && album.title) || "";
  let imgH = Math.round(W * 0.75);
  if (img) imgH = Math.max(540, Math.min(Math.round(W * img.naturalHeight / img.naturalWidth), 1500));
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `600 32px ${MA_FONT}`;
  const capLines = caption ? maWrap(probe, caption, W - padX * 2).slice(0, 3) : [];
  const headerH = 56 + (capLines.length ? capLines.length * 42 + 16 : 0);
  const H = headerH + imgH;
  const canvas = document.createElement("canvas");
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d"); ctx.scale(S, S); ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, headerH);
  try { ctx.letterSpacing = "3px"; } catch (e) {}
  ctx.fillStyle = "#9aa0a6"; ctx.font = `700 15px ${MA_FONT}`; ctx.textBaseline = "alphabetic";
  ctx.fillText("MODELERS ALBUM", padX, 34);
  try { ctx.letterSpacing = "0px"; } catch (e) {}
  if (capLines.length) {
    ctx.fillStyle = "#fff"; ctx.font = `600 32px ${MA_FONT}`;
    let y = 56 + 30; for (const ln of capLines) { ctx.fillText(ln, padX, y); y += 42; }
  }
  maDrawCover(ctx, img, 0, headerH, W, imgH);
  return await new Promise(r => canvas.toBlob(r, "image/png"));
}
// アルバム全体：全写真を4枚ずつ複数画像に分割（24枚→6画像）。1枚目＝表紙(大)＋他3＋ヘッダー、2枚目以降＝2x2グリッド。
async function maRenderAlbumPage(album, group, page, total) {
  const S = 2, W = 1080, H = 1350, M = 46, GAP = 8;
  const imgs = await Promise.all(group.map(p => (p ? maLoadImage(p.url) : Promise.resolve(null))));
  const canvas = document.createElement("canvas");
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d"); ctx.scale(S, S); ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  if (page === 0) {
    try { ctx.letterSpacing = "4px"; } catch (e) {}
    ctx.fillStyle = "#9aa0a6"; ctx.font = `700 15px ${MA_FONT}`;
    ctx.fillText("MODELERS ALBUM", M, 44);
    try { ctx.letterSpacing = "0px"; } catch (e) {}
    const title = album.title || "UNTITLED";
    let fs = 50; ctx.font = `800 ${fs}px ${MA_FONT}`;
    while (ctx.measureText(title).width > W - 2 * M && fs > 26) { fs -= 2; ctx.font = `800 ${fs}px ${MA_FONT}`; }
    let shown = title;
    if (ctx.measureText(shown).width > W - 2 * M) { while (shown.length > 1 && ctx.measureText(shown + "…").width > W - 2 * M) shown = shown.slice(0, -1); shown += "…"; }
    ctx.fillStyle = "#111"; ctx.fillText(shown, M, 108);
    const meta = [fmtYM(album.createdYM), ...(album.tags || [])].filter(Boolean).join("   /   ");
    if (meta) { ctx.fillStyle = "#777"; ctx.font = `600 20px ${MA_FONT}`; ctx.fillText(meta, M, 146); }
    if ((album.comment || "").trim()) {
      ctx.fillStyle = "#444"; ctx.font = `400 21px ${MA_FONT}`;
      const lines = maWrap(ctx, album.comment.trim(), W - 2 * M).slice(0, 2);
      let y = 182; for (const ln of lines) { ctx.fillText(ln, M, y); y += 28; }
    }
    if (total > 1) { ctx.fillStyle = "#999"; ctx.font = `600 16px ${MA_FONT}`; ctx.textAlign = "right"; ctx.fillText(`1 / ${total}`, W - M, 44); ctx.textAlign = "left"; }
    ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(M, 242); ctx.lineTo(W - M, 242); ctx.stroke();
  } else {
    let t = album.title || "UNTITLED"; ctx.font = `800 26px ${MA_FONT}`;
    while (ctx.measureText(t).width > W - 2 * M - 90 && t.length > 1) t = t.slice(0, -1);
    ctx.fillStyle = "#111"; ctx.fillText(t, M, 56);
    ctx.fillStyle = "#999"; ctx.font = `600 18px ${MA_FONT}`; ctx.textAlign = "right"; ctx.fillText(`${page + 1} / ${total}`, W - M, 56); ctx.textAlign = "left";
    ctx.strokeStyle = "#111"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(M, 90); ctx.lineTo(W - M, 90); ctx.stroke();
  }
  // 共通レイアウト：特集（大）1枚 ＋ サムネ3枚（全ページ共通。先頭が大きい1枚）
  const headerH = page === 0 ? 244 : 92;
  const FOOT = 56, areaTop = headerH, areaH = H - areaTop - FOOT;
  const coverH = Math.round(areaH * 0.65), rowY = areaTop + coverH + GAP, rowH = areaH - coverH - GAP, cellW = (W - GAP * 2) / 3;
  maDrawCover(ctx, imgs[0], 0, areaTop, W, coverH);
  if (imgs[0]) maCaptionBand(ctx, group[0] && group[0].caption, 0, areaTop, W, coverH, 30);
  for (let i = 0; i < 3; i++) { const cx = i * (cellW + GAP); maDrawCover(ctx, imgs[i + 1] || null, cx, rowY, cellW, rowH); if (imgs[i + 1]) maCaptionBand(ctx, group[i + 1] && group[i + 1].caption, cx, rowY, cellW, rowH, 18); }
  ctx.fillStyle = "#999"; ctx.font = `600 19px ${MA_FONT}`; ctx.textAlign = "center";
  ctx.fillText("tsumitsumi.vercel.app", W / 2, H - 20); ctx.textAlign = "left";
  return await new Promise(r => canvas.toBlob(r, "image/png"));
}
// ordered（{url,caption}配列・先頭が表紙）を渡せばその写真で、無ければ全写真(表紙先頭)で生成
async function generateModelerAlbumImages(album, ordered) {
  let list = ordered;
  if (!list) {
    const photos = maNormPhotos(album.photos);
    if (!photos.length) return [];
    const ci = Math.min(album.cover || 0, Math.max(0, photos.length - 1));
    list = [photos[ci], ...photos.filter((_, i) => i !== ci)];
  }
  list = (list || []).filter(Boolean);
  if (!list.length) return [];
  const chunks = [];
  for (let i = 0; i < list.length; i += 4) chunks.push(list.slice(i, i + 4));
  const blobs = [];
  for (let c = 0; c < chunks.length; c++) blobs.push(await maRenderAlbumPage(album, chunks[c], c, chunks.length));
  return blobs;
}
// ビフォーアフター比較：X向け横長16:9(1600x900)1枚。ヘッダー黒帯にコメント、下に BEFORE | AFTER。
async function generateBeforeAfterImage(beforeP, afterP, comment) {
  const S = 2, W = 1600, H = 900, padX = 44, gap = 6;
  const [imgB, imgA] = await Promise.all([maLoadImage(beforeP && beforeP.url), maLoadImage(afterP && afterP.url)]);
  const cap = (comment || "").trim();
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `600 34px ${MA_FONT}`;
  const lines = cap ? maWrap(probe, cap, W - padX * 2).slice(0, 2) : [];
  const headerH = 58 + (lines.length ? lines.length * 44 + 12 : 0);
  const canvas = document.createElement("canvas");
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext("2d"); ctx.scale(S, S); ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  // header
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, W, headerH);
  ctx.textBaseline = "alphabetic";
  try { ctx.letterSpacing = "4px"; } catch (e) {}
  ctx.fillStyle = "#9aa0a6"; ctx.font = `700 15px ${MA_FONT}`;
  ctx.fillText("BEFORE / AFTER  —  MODELERS ALBUM", padX, 36);
  try { ctx.letterSpacing = "0px"; } catch (e) {}
  if (lines.length) { ctx.fillStyle = "#fff"; ctx.font = `600 34px ${MA_FONT}`; let y = 58 + 32; for (const ln of lines) { ctx.fillText(ln, padX, y); y += 44; } }
  // photos（ズーム・位置調整を反映）
  const py = headerH, ph = H - headerH, cw = (W - gap) / 2;
  maDrawTransformed(ctx, imgB, 0, py, cw, ph, beforeP && beforeP.t);
  maDrawTransformed(ctx, imgA, cw + gap, py, cw, ph, afterP && afterP.t);
  // labels
  const drawLabel = (txt, x) => {
    ctx.font = `800 24px ${MA_FONT}`;
    const w = ctx.measureText(txt).width + 30;
    ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(x, py, w, 46);
    ctx.fillStyle = "#fff"; ctx.textBaseline = "alphabetic"; ctx.fillText(txt, x + 15, py + 31);
  };
  drawLabel("BEFORE", 0);
  drawLabel("AFTER", cw + gap);
  return await new Promise(r => canvas.toBlob(r, "image/png"));
}
async function maShareImage(blob, filename, text) {
  if (!blob) { alert("画像の生成に失敗しました"); return; }
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { const u = URL.createObjectURL(file); const a = document.createElement("a"); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1500); } catch (e) {}
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
}
// 複数画像をまとめて共有（非対応端末は順次ダウンロード＋テキスト投稿）。X投稿は最大4枚/件のため、保存して複数投稿に使う想定。
async function maShareImages(blobs, baseName, text) {
  const list = (blobs || []).filter(Boolean);
  if (!list.length) { alert("画像の生成に失敗しました"); return; }
  if (list.length === 1) return maShareImage(list[0], `${baseName}.png`, text);
  const files = list.map((b, i) => new File([b], `${baseName}_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  for (const f of files) { try { const u = URL.createObjectURL(f); const a = document.createElement("a"); a.href = u; a.download = f.name; a.click(); await new Promise(r => setTimeout(r, 350)); URL.revokeObjectURL(u); } catch (e) {} }
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
}

// ===== モデラーズアルバム バックアップ用 ZIP（store・無圧縮）。写真は元データのまま詰めてメモリ節約 =====
const MA_CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function maCrc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = MA_CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function maPhotoToBlob(url) {
  if (isIdbBlobUrl(url)) return await kitsIdbPhotoGet(idbBlobUrlToId(url));
  if (typeof url === "string" && url.startsWith("data:")) { try { return await (await fetch(url)).blob(); } catch (e) { return null; } }
  if (typeof url === "string" && url) { try { return await (await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`)).blob(); } catch (e) { return null; } }
  return null;
}
async function buildModelerZip(targets) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 255, (n >>> 8) & 255];
  const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const parts = [], central = []; let offset = 0;
  const addEntry = (name, dataPart, crc, size) => {
    const nb = enc.encode(name);
    const lh = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nb.length), u16(0));
    const lhU8 = new Uint8Array(lh.length + nb.length); lhU8.set(lh, 0); lhU8.set(nb, lh.length);
    parts.push(lhU8); parts.push(dataPart);
    const cd = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
    const cdU8 = new Uint8Array(cd.length + nb.length); cdU8.set(cd, 0); cdU8.set(nb, cd.length); central.push(cdU8);
    offset += lhU8.length + size;
  };
  const manifestAlbums = []; let pc = 0;
  for (const a of targets) {
    const mphotos = [];
    for (const p of maNormPhotos(a.photos)) {
      const blob = await maPhotoToBlob(p.url);
      if (!blob) continue;
      const ext = (blob.type || "").includes("png") ? "png" : (blob.type || "").includes("webp") ? "webp" : "jpg";
      const fname = `photos/${pc++}_${makePhotoId()}.${ext}`;
      const buf = new Uint8Array(await blob.arrayBuffer()); // CRC計算用（1枚ずつ・直後に破棄）
      addEntry(fname, blob, maCrc32(buf), buf.length); // データ部は元のBlob参照（JSヒープに載せない）
      mphotos.push({ file: fname, caption: p.caption || "" });
      await new Promise(r => setTimeout(r, 0));
    }
    manifestAlbums.push({ ...a, photos: mphotos });
  }
  const man = enc.encode(JSON.stringify({ version: 1, type: "modeler_albums_zip", exportedAt: new Date().toISOString(), albums: manifestAlbums }));
  addEntry("manifest.json", man, maCrc32(man), man.length);
  const cdStart = offset; let cdSize = 0;
  for (const c of central) { parts.push(c); cdSize += c.length; }
  parts.push(new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0))));
  return new Blob(parts, { type: "application/zip" });
}
async function isZipFile(file) { try { const b = new Uint8Array(await file.slice(0, 2).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b; } catch (e) { return false; } }
async function readModelerZip(file) {
  const dv = async (s, l) => new DataView(await file.slice(s, s + l).arrayBuffer());
  let offset = 0, manifest = null; const photoMap = {};
  while (offset + 4 <= file.size) {
    const sig = (await dv(offset, 4)).getUint32(0, true);
    if (sig !== 0x04034b50) break; // ローカルヘッダ以外（中央ディレクトリ等）に到達
    const h = await dv(offset, 30);
    const size = h.getUint32(18, true), fnLen = h.getUint16(26, true), exLen = h.getUint16(28, true);
    const name = new TextDecoder().decode(await file.slice(offset + 30, offset + 30 + fnLen).arrayBuffer());
    const dataStart = offset + 30 + fnLen + exLen;
    if (name === "manifest.json") manifest = JSON.parse(await file.slice(dataStart, dataStart + size).text());
    else if (name.indexOf("photos/") === 0) {
      // iOS Safari/standalone では、File の遅延スライス（Blob）をそのまま IDB に入れると
      // 入力クリア後に読み戻しが空/破損になることがある。arrayBuffer で実体化してから保存する。
      const ext = (name.split(".").pop() || "").toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const ab = await file.slice(dataStart, dataStart + size).arrayBuffer();
      const id = makePhotoId();
      if (await kitsIdbPhotoSet(id, new Blob([ab], { type: mime }))) photoMap[name] = idToIdbBlobUrl(id);
    }
    offset = dataStart + size;
    await new Promise(r => setTimeout(r, 0));
  }
  if (!manifest) throw new Error("ZIP内に manifest.json がありません");
  return (manifest.albums || []).map(a => ({
    ...a, id: a.id || makePhotoId(), cover: a.cover || 0,
    photos: (a.photos || []).map(ph => ({ url: photoMap[ph.file] || "", caption: ph.caption || "" })).filter(p => p.url),
  }));
}

// ビフォーアフター用：画像をドラッグで位置調整＋スライダーでズーム。t={z,ox,oy} を親へ通知
function BaAdjust({ url, t, onChange }) {
  const [nat, setNat] = useState(null);
  const [boxW, setBoxW] = useState(0);
  const boxRef = useRef(null);
  const drag = useRef(null);
  useEffect(() => {
    const measure = () => { if (boxRef.current) setBoxW(boxRef.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const AR = 790 / 797; // 出力セルにほぼ一致（高さ/幅）
  const boxH = boxW * AR;
  const z = t.z || 1, ox = t.ox != null ? t.ox : 0.5, oy = t.oy != null ? t.oy : 0.5;
  let imgStyle = { display: "none" };
  if (nat && boxW) {
    const s = Math.max(boxW / nat.iw, boxH / nat.ih) * z;
    const dispW = nat.iw * s, dispH = nat.ih * s;
    imgStyle = { position: "absolute", left: -(dispW - boxW) * ox, top: -(dispH - boxH) * oy, width: dispW, height: dispH, maxWidth: "none", pointerEvents: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" };
  }
  const onDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, ox, oy }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} };
  const onMove = (e) => {
    if (!drag.current || !nat || !boxW) return;
    e.preventDefault();
    const s = Math.max(boxW / nat.iw, boxH / nat.ih) * z;
    const maxX = Math.max(1, nat.iw * s - boxW), maxY = Math.max(1, nat.ih * s - boxH);
    const nox = Math.max(0, Math.min(1, drag.current.ox - (e.clientX - drag.current.x) / maxX));
    const noy = Math.max(0, Math.min(1, drag.current.oy - (e.clientY - drag.current.y) / maxY));
    onChange({ z, ox: nox, oy: noy });
  };
  const onUp = () => { drag.current = null; };
  return (
    <div>
      <div ref={boxRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: "relative", width: "100%", aspectRatio: "797 / 790", overflow: "hidden", background: "#111", cursor: "move", touchAction: "none" }}>
        <img src={url} alt="" draggable={false} onLoad={(e) => setNat({ iw: e.target.naturalWidth, ih: e.target.naturalHeight })} style={imgStyle} />
      </div>
      <input type="range" min="1" max="3" step="0.02" value={z}
        onChange={(e) => onChange({ z: parseFloat(e.target.value), ox, oy })}
        style={{ width: "100%", marginTop: 6 }} title="ズーム" />
    </div>
  );
}

function ModelerAlbum({ onClose, tagMasterList, setTagMasterList, kits, setKits }) {
  const [albums, setAlbums] = useState([]);
  const [mode, setMode] = useState("list"); // "list" | "edit" | "view"
  const [draft, setDraft] = useState(null);  // 編集中アルバム
  const [viewId, setViewId] = useState(null); // 閲覧中アルバム id
  const [lightbox, setLightbox] = useState(null); // { photos:[], i:number, zoom:bool }
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState(null); // シェア結果 { files, urls, text }
  const [shareSelect, setShareSelect] = useState(null); // 写真選択 { album, sel:number[] }（最大16枚）
  const [baSelect, setBaSelect] = useState(null); // ビフォーアフター { album, sel:[before,after], comment }
  const [maHelp, setMaHelp] = useState(false); // 取扱説明書（使い方）表示
  const [maIntro, setMaIntro] = useState(false); // 初回アクセス時の案内ポップアップ
  const [maBackup, setMaBackup] = useState(false); // バックアップ画面表示
  const [maBusy, setMaBusy] = useState(false); // バックアップ作成/復元中のロード表示
  const [bkReady, setBkReady] = useState(null); // 作成済みバックアップ { url, name, sizeMB }（タップ直後にDL）
  const [tagManage, setTagManage] = useState(false);
  const [editTag, setEditTag] = useState(null); // 改名中のタグ名
  const [editTagVal, setEditTagVal] = useState("");
  const savedRef = useRef(false);
  const maFileRef = useRef(null); // バックアップ読み込み用 file input

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(MA_LS_KEY) || "[]");
      if (Array.isArray(s)) setAlbums(s.map(a => ({ ...a, photos: maNormPhotos(a.photos) }))); // 旧データ（文字列）を {url,caption} へ移行
    } catch (e) {}
    try { if (!localStorage.getItem(MA_INTRO_KEY)) setMaIntro(true); } catch (e) {} // 初回アクセスのみ案内ポップアップ
  }, []);
  const dismissIntro = () => { try { localStorage.setItem(MA_INTRO_KEY, "1"); } catch (e) {} setMaIntro(false); };
  useEffect(() => {
    if (!savedRef.current) { savedRef.current = true; return; } // 初回マウントの保存はスキップ
    try { localStorage.setItem(MA_LS_KEY, JSON.stringify(albums)); } catch (e) {}
  }, [albums]);

  const viewing = viewId ? albums.find(a => a.id === viewId) : null;

  const startNew = () => { setDraft({ id: makePhotoId(), title: "", createdYM: "", tags: [], comment: "", photos: [], cover: 0, createdAt: Date.now(), updatedAt: Date.now() }); setTagInput(""); setMode("edit"); };
  const startEdit = (a) => { setDraft({ ...a, tags: [...(a.tags || [])], photos: maNormPhotos(a.photos).map(p => ({ ...p })) }); setTagInput(""); setTagManage(false); setMode("edit"); };

  const addPhotos = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !draft) return;
    const room = MAX_ALBUM_PHOTOS - draft.photos.length;
    if (room <= 0) { alert(`写真は1アルバム最大${MAX_ALBUM_PHOTOS}枚までです`); return; }
    setBusy(true);
    const added = [];
    for (const f of files.slice(0, room)) {
      const id = makePhotoId();
      const ok = await kitsIdbPhotoSet(id, f); // 原本を無圧縮で IDB に保存（高画質）
      if (ok) added.push({ url: idToIdbBlobUrl(id), caption: "" });
    }
    setBusy(false);
    if (added.length) setDraft(d => ({ ...d, photos: [...d.photos, ...added].slice(0, MAX_ALBUM_PHOTOS) }));
    else alert("写真の保存に失敗しました（端末の空き容量をご確認ください）");
  };

  const removePhoto = (idx) => {
    // 注意：ここでは IDB の blob を即削除しない（編集をキャンセルした場合に元アルバムの画像が壊れるため）。
    // 実体の削除はアルバムごと削除する deleteAlbum 時のみ行う。
    setDraft(d => {
      const photos = d.photos.filter((_, i) => i !== idx);
      let cover = d.cover || 0;
      if (idx === cover) cover = 0; else if (idx < cover) cover -= 1;
      return { ...d, photos, cover: Math.min(cover, Math.max(0, photos.length - 1)) };
    });
  };

  const addNewTag = (raw) => {
    const t = (raw == null ? tagInput : raw).trim();
    if (!t) return;
    setDraft(d => (d.tags.includes(t) ? d : { ...d, tags: [...d.tags, t] }));
    if (!tagMasterList.includes(t)) setTagMasterList(prev => [...prev, t]);
    setTagInput("");
  };
  const toggleTag = (t) => setDraft(d => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter(x => x !== t) : [...d.tags, t] }));
  const setCaption = (i, caption) => setDraft(d => ({ ...d, photos: d.photos.map((p, idx) => (idx === i ? { ...p, caption } : p)) }));
  // 写真の並べ替え（‹ ›で前後に1つ移動）。表紙(cover)indexも追従させる
  const movePhoto = (i, dir) => setDraft(d => {
    const j = i + dir;
    if (j < 0 || j >= d.photos.length) return d;
    const photos = [...d.photos];
    [photos[i], photos[j]] = [photos[j], photos[i]];
    let cover = d.cover || 0;
    if (cover === i) cover = j; else if (cover === j) cover = i;
    return { ...d, photos, cover };
  });

  // 長押しドラッグで写真を並べ替え（タッチ/マウス両対応）。長押しで浮かせ、離した位置へ挿入。
  const [dragView, setDragView] = useState(null); // 浮いている写真 { x, y, url }
  const dragRef = useRef({ timer: null, active: false, from: -1, sx: 0, sy: 0, pid: null, node: null });
  const photoCellIndexAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest("[data-photo-cell]");
    if (!cell) return -1;
    const n = parseInt(cell.getAttribute("data-photo-cell"), 10);
    return isNaN(n) ? -1 : n;
  };
  const onPhotoPointerDown = (e, i, p) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest && e.target.closest("button")) return; // ✕/‹›/表紙ボタンの操作は除外
    const r = dragRef.current;
    r.from = i; r.sx = e.clientX; r.sy = e.clientY; r.active = false;
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      r.active = true;
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
      setDragView({ x: r.sx, y: r.sy, url: p.url });
      // 発動後は window に非passiveのtouchmove等を張り、スクロールを止めつつ指に追従させる
      const move = (ev) => {
        if (ev.cancelable) ev.preventDefault();
        const pt = ev.touches ? ev.touches[0] : ev;
        if (pt) setDragView(v => (v ? { ...v, x: pt.clientX, y: pt.clientY } : v));
      };
      const end = (ev) => {
        const pt = ev.changedTouches ? ev.changedTouches[0] : ev;
        finishPhotoDrag(pt ? pt.clientX : r.sx, pt ? pt.clientY : r.sy);
      };
      r.move = move; r.end = end;
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("mousemove", move);
      window.addEventListener("touchend", end);
      window.addEventListener("mouseup", end);
      window.addEventListener("touchcancel", end);
    }, 260);
  };
  const onPhotoPointerMove = (e) => {
    const r = dragRef.current;
    // 発動前に動いたらスクロール扱い＝長押しキャンセル（発動後の追従は window 側で処理）
    if (!r.active && r.timer && (Math.abs(e.clientX - r.sx) > 10 || Math.abs(e.clientY - r.sy) > 10)) {
      clearTimeout(r.timer); r.timer = null; r.from = -1;
    }
  };
  const onPhotoPointerUp = () => {
    const r = dragRef.current;
    if (!r.active && r.timer) { clearTimeout(r.timer); r.timer = null; r.from = -1; } // タップ（発動前）だけ後始末。発動後は window の end が処理
  };
  const finishPhotoDrag = (x, y) => {
    const r = dragRef.current;
    if (r.move) { window.removeEventListener("touchmove", r.move, { passive: false }); window.removeEventListener("mousemove", r.move); }
    if (r.end) { window.removeEventListener("touchend", r.end); window.removeEventListener("mouseup", r.end); window.removeEventListener("touchcancel", r.end); }
    if (r.active) {
      const from = r.from, to = photoCellIndexAt(x, y);
      if (from >= 0 && to >= 0 && to !== from) {
        setDraft(d => {
          const photos = [...d.photos];
          const coverUrl = (photos[d.cover || 0] || {}).url;
          const [moved] = photos.splice(from, 1);
          photos.splice(to, 0, moved);
          let cover = photos.findIndex(z => z.url === coverUrl);
          if (cover < 0) cover = 0;
          return { ...d, photos, cover };
        });
      }
    }
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    r.active = false; r.from = -1; r.move = null; r.end = null;
    setDragView(null);
  };

  // タグの改名・削除（マスタ＋全アルバム＋全キットへ反映＝アプリ全体で統一）
  const renameTag = (oldT, rawNew) => {
    const newT = (rawNew || "").trim();
    if (!newT || newT === oldT) { setEditTag(null); return; }
    setTagMasterList(prev => Array.from(new Set(prev.map(t => (t === oldT ? newT : t)))));
    setAlbums(prev => prev.map(a => ({ ...a, tags: Array.from(new Set((a.tags || []).map(t => (t === oldT ? newT : t)))) })));
    if (setKits) setKits(prev => prev.map(k => ({ ...k, tags: Array.from(new Set((k.tags || []).map(t => (t === oldT ? newT : t)))) })));
    setDraft(d => (d ? { ...d, tags: Array.from(new Set(d.tags.map(t => (t === oldT ? newT : t)))) } : d));
    setEditTag(null); setEditTagVal("");
  };
  const deleteTagEverywhere = (t) => {
    if (!window.confirm(`タグ「${t}」を削除しますか？\nすべてのアルバム・キットからも外れます。`)) return;
    setTagMasterList(prev => prev.filter(x => x !== t));
    setAlbums(prev => prev.map(a => ({ ...a, tags: (a.tags || []).filter(x => x !== t) })));
    if (setKits) setKits(prev => prev.map(k => ({ ...k, tags: (k.tags || []).filter(x => x !== t) })));
    setDraft(d => (d ? { ...d, tags: d.tags.filter(x => x !== t) } : d));
  };

  // バックアップ：指定アルバムのJSONを作り {url,name,sizeMB} を返す（メモリ節約：分割→Blob）
  const buildBackupBlob = async (targets) => {
    const parts = [`{"version":1,"type":"modeler_albums","exportedAt":${JSON.stringify(new Date().toISOString())},"albums":[`];
    for (let ai = 0; ai < targets.length; ai++) {
      const a = targets[ai];
      const photos = [];
      for (const p of maNormPhotos(a.photos)) {
        let u = p.url;
        if (isIdbBlobUrl(u)) {
          const b = await kitsIdbPhotoGet(idbBlobUrlToId(u));
          u = b ? await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result || ""); fr.onerror = () => res(""); fr.readAsDataURL(b); }) : "";
        }
        if (u) photos.push({ url: u, caption: p.caption || "" });
      }
      parts.push((ai ? "," : "") + JSON.stringify({ ...a, photos }));
      await new Promise(r => setTimeout(r, 0));
    }
    parts.push("]}");
    const blob = new Blob(parts, { type: "application/json" });
    const date = new Date().toLocaleDateString("ja-JP").replace(/\//g, "-");
    const one = targets.length === 1 ? "_" + (targets[0].title || "album").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 24) : "";
    return { url: URL.createObjectURL(blob), name: `modelers_album_backup${one}_${date}.json`, sizeMB: (blob.size / (1024 * 1024)).toFixed(1) };
  };
  // 単独/選択アルバムを保存
  const maExport = async (list) => {
    const targets = Array.isArray(list) ? list : albums;
    if (!targets.length) { alert("アルバムがありません"); return; }
    setMaBusy(true); await new Promise(r => setTimeout(r, 30));
    try { setBkReady(await buildBackupBlob(targets)); }
    catch (e) { alert("バックアップの作成に失敗しました: " + (e.message || e)); }
    finally { setMaBusy(false); }
  };
  // 全アルバムを1個ずつ順番に保存（保存するたびに自動で次を用意。iOSはDLごとにタップが必要なため）
  const startExportAll = async () => {
    if (!albums.length) { alert("アルバムがありません"); return; }
    setMaBusy(true); await new Promise(r => setTimeout(r, 30));
    try { const r = await buildBackupBlob([albums[0]]); setBkReady({ ...r, queue: albums, qi: 0 }); }
    catch (e) { alert("バックアップの作成に失敗しました: " + (e.message || e)); }
    finally { setMaBusy(false); }
  };
  // 全アルバムを1つのZIPにまとめて保存（1回のDL＝保存先指定も1回。メモリ節約で大容量も安定）
  const exportZip = async () => {
    if (!albums.length) { alert("アルバムがありません"); return; }
    setMaBusy(true); await new Promise(r => setTimeout(r, 30));
    try {
      const blob = await buildModelerZip(albums);
      const date = new Date().toLocaleDateString("ja-JP").replace(/\//g, "-");
      setBkReady({ url: URL.createObjectURL(blob), name: `modelers_albums_${date}.zip`, sizeMB: (blob.size / (1024 * 1024)).toFixed(1) });
    } catch (e) { alert("ZIPの作成に失敗しました: " + (e.message || e)); }
    finally { setMaBusy(false); }
  };
  // 保存（DL）後に呼ぶ：キューがあれば次のアルバムを用意、無ければ閉じる
  const advanceBackup = (cur) => {
    setTimeout(async () => {
      try { URL.revokeObjectURL(cur.url); } catch (e) {}
      if (cur.queue && cur.qi + 1 < cur.queue.length) {
        setMaBusy(true); await new Promise(r => setTimeout(r, 30));
        try { const r = await buildBackupBlob([cur.queue[cur.qi + 1]]); setBkReady({ ...r, queue: cur.queue, qi: cur.qi + 1 }); }
        catch (e) { alert("作成に失敗: " + (e.message || e)); setBkReady(null); }
        finally { setMaBusy(false); }
      } else { setBkReady(null); }
    }, 800);
  };
  // 複数のバックアップファイルをまとめて選択→順番に取り込み、既存に統合（同idは置換・無ければ追加）
  const maImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setMaBusy(true); await new Promise(r => setTimeout(r, 30));
    try {
      let added = 0;
      const map = new Map(albums.map(a => [a.id, a]));
      for (const file of files) {
        let imported = [];
        if (/\.zip$/i.test(file.name) || await isZipFile(file)) {
          // ZIP：写真は元データのままIDBへ（メモリ節約）
          try { imported = await readModelerZip(file); } catch (_) { continue; }
        } else {
          // 旧JSON形式（base64インライン）
          let data; try { data = JSON.parse(await file.text()); } catch (_) { continue; }
          const arr = data.albums || (Array.isArray(data) ? data : null);
          if (!Array.isArray(arr)) continue;
          for (const a of arr) {
            const photos = [];
            for (const p of maNormPhotos(a.photos)) {
              let url = p.url;
              if (typeof url === "string" && url.startsWith("data:")) {
                try { const b = await (await fetch(url)).blob(); const id = makePhotoId(); if (await kitsIdbPhotoSet(id, b)) url = idToIdbBlobUrl(id); } catch (_) {}
              }
              photos.push({ url, caption: p.caption || "" });
            }
            imported.push({ ...a, id: a.id || makePhotoId(), photos, cover: a.cover || 0 });
          }
        }
        for (const album of imported) { map.set(album.id, album); added++; }
      }
      setAlbums(Array.from(map.values()));
      setMaBackup(false);
      alert(`${added}件のアルバムを取り込みました（既存に統合）。`);
    } catch (e) { alert("インポートに失敗しました。正しいバックアップファイルを選択してください。"); }
    finally { setMaBusy(false); }
  };

  // このアプリ（モデラーズアルバム）を共有：対応端末はネイティブ共有シート、非対応はURLコピー
  const maShareApp = async () => {
    const url = "https://tsumitsumi.vercel.app/?modeler";
    const text = `あなたの作品をカンタンにアルバム化。新作投稿も楽チン。ビフォー・アフターも作れちゃう。Webアプリ「モデラーズアルバム」\n${MA_TAGS}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "MODELERS ALBUM", text, url });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try {
      await navigator.clipboard.writeText(url);
      alert("アプリのURLをコピーしました。\n" + url);
    } catch (_) {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text + "\n" + url)}`, "_blank");
    }
  };

  // ビフォーアフター：BEFORE/AFTER の写真を直接アップロード（アルバムからは選ばない）
  const startBeforeAfter = (a) => setBaSelect({ album: a, beforeUrl: null, afterUrl: null, comment: "", bt: { z: 1, ox: 0.5, oy: 0.5 }, at: { z: 1, ox: 0.5, oy: 0.5 } });
  const onBaPick = async (key, e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const url = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result || ""); fr.onerror = () => res(""); fr.readAsDataURL(file); });
    if (!url) { alert("画像の読み込みに失敗しました"); return; }
    const tKey = key === "beforeUrl" ? "bt" : "at"; // 新しい画像は調整リセット
    setBaSelect(s => (s ? { ...s, [key]: url, [tKey]: { z: 1, ox: 0.5, oy: 0.5 } } : s));
  };
  const doBeforeAfter = async () => {
    if (!baSelect || !baSelect.beforeUrl || !baSelect.afterUrl) { alert("BEFORE・AFTERの両方をアップロードしてください"); return; }
    const { album, beforeUrl, afterUrl, comment, bt, at } = baSelect;
    setSharing(true);
    try {
      const blob = await generateBeforeAfterImage({ url: beforeUrl, t: bt }, { url: afterUrl, t: at }, comment);
      if (!blob) { alert("画像の生成に失敗しました"); return; }
      const file = new File([blob], `modelers_ba_${(album && album.id) || "x"}.png`, { type: "image/png" });
      const url = await new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result || ""); fr.onerror = () => res(""); fr.readAsDataURL(blob); });
      setBaSelect(null);
      setShareResult({ files: [file], urls: [url], text: `${comment ? comment.trim() + "\n" : ""}${MA_TAGS}` });
    } catch (e) { alert("生成に失敗しました: " + (e.message || e)); }
    finally { setSharing(false); }
  };

  // 1ファイル保存（共有シート→保存／非対応はDL）。ユーザー操作ごとなので確実
  const saveOne = async (file) => {
    if (typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { const u = URL.createObjectURL(file); const a = document.createElement("a"); a.href = u; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1500); } catch (e) {}
  };
  const MAX_SHARE_PHOTOS = 16; // 1投稿分（4枚×最大4画像）
  // Share ALL → まず写真を選択（最大16枚・選んだ順／表紙を先頭に既定選択）
  const shareAlbum = (a) => {
    const ph = maNormPhotos(a.photos);
    if (!ph.length) { alert("写真がありません"); return; }
    const ci = Math.min(a.cover || 0, ph.length - 1);
    const order = [ci, ...ph.map((_, i) => i).filter(i => i !== ci)];
    setShareSelect({ album: a, sel: order.slice(0, MAX_SHARE_PHOTOS), large: [] });
  };
  const toggleShareSel = (i) => setShareSelect(s => {
    if (!s) return s;
    if (s.sel.includes(i)) return { ...s, sel: s.sel.filter(x => x !== i), large: (s.large || []).filter(x => x !== i) };
    if (s.sel.length >= MAX_SHARE_PHOTOS) { alert(`1投稿は最大${MAX_SHARE_PHOTOS}枚までです`); return s; }
    return { ...s, sel: [...s.sel, i] };
  });
  // 各画像(4枚組)の「大」を直接トグル。1組につき1枚（同組の既存「大」は外す）。同じ写真を再タップでOFF(既定=組の先頭に戻る)
  const toggleShareLarge = (i) => setShareSelect(s => {
    if (!s) return s;
    const order = s.sel.indexOf(i);
    if (order < 0) return s; // 未選択は対象外
    const gStart = Math.floor(order / 4) * 4;
    const groupMembers = s.sel.slice(gStart, gStart + 4);
    const cur = (s.large || []).find(x => groupMembers.includes(x));
    let large = (s.large || []).filter(x => !groupMembers.includes(x)); // その組の指定を一旦クリア
    if (cur !== i) large = [...large, i]; // 別写真→大に設定（同じならOFFのままクリア）
    return { ...s, large };
  });
  const doShareSelected = async () => {
    if (!shareSelect) return;
    const { album, sel, large = [] } = shareSelect;
    const ph = maNormPhotos(album.photos);
    // 4枚組ごとに「大」を先頭へ並べ替え（未指定は先頭のまま）
    const ordered = [];
    for (let k = 0; k < sel.length; k += 4) {
      const g = sel.slice(k, k + 4);
      const lead = g.find(idx => large.includes(idx));
      if (lead != null) ordered.push(lead, ...g.filter(idx => idx !== lead));
      else ordered.push(...g);
    }
    const chosen = ordered.map(i => ph[i]).filter(Boolean);
    if (!chosen.length) { alert("写真を選択してください"); return; }
    setSharing(true);
    try {
      const blobs = (await generateModelerAlbumImages(album, chosen)).filter(Boolean);
      if (!blobs.length) { alert("画像の生成に失敗しました"); return; }
      const files = blobs.map((b, i) => new File([b], `modelers_${album.id}_${String(i + 1).padStart(2, "0")}.png`, { type: "image/png" }));
      const urls = await Promise.all(blobs.map(b => new Promise(res => { const fr = new FileReader(); fr.onloadend = () => res(fr.result || ""); fr.onerror = () => res(""); fr.readAsDataURL(b); })));
      // shareSelect は残す（プレビューから「戻る」で選び直せるように）
      setShareResult({ files, urls, text: `「${album.title || "作品"}」\n${MA_TAGS}` });
    } catch (e) { alert("シェア画像の生成に失敗しました: " + (e.message || e)); }
    finally { setSharing(false); }
  };
  const sharePhoto = async (a, photo) => {
    setSharing(true);
    try { const blob = await generateModelerPhotoImage(photo, a); await maShareImage(blob, `modelers_photo.png`, `${(photo.caption || "").trim() || a.title || "作品"}\n${MA_TAGS}`); }
    catch (e) { alert("シェア画像の生成に失敗しました: " + (e.message || e)); }
    finally { setSharing(false); }
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.title.trim()) { alert("作品名を入力してください"); return; }
    const a = { ...draft, title: draft.title.trim(), updatedAt: Date.now() };
    setAlbums(prev => {
      const i = prev.findIndex(x => x.id === a.id);
      if (i >= 0) { const c = [...prev]; c[i] = a; return c; }
      return [a, ...prev];
    });
    setMode("list"); setDraft(null);
  };

  const deleteAlbum = (a) => {
    if (!window.confirm(`「${a.title || "無題"}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    maNormPhotos(a.photos).forEach(p => { if (isIdbBlobUrl(p.url)) kitsIdbPhotoDelete(idbBlobUrlToId(p.url)); });
    setAlbums(prev => prev.filter(x => x.id !== a.id));
    setMode("list"); setDraft(null); setViewId(null);
  };

  const ma = {
    wrap: { position: "fixed", inset: 0, zIndex: 300, background: "#fff", color: "#111", fontFamily: MA_FONT, overflowY: "auto", WebkitOverflowScrolling: "touch" },
    bar: { position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#fff", borderBottom: "1px solid #111" },
    brand: { fontSize: 14, fontWeight: 800, letterSpacing: "0.24em", margin: 0 },
    sub: { fontSize: 8, letterSpacing: "0.34em", color: "#999", marginTop: 3 },
    ghost: { background: "none", border: "1px solid #111", color: "#111", padding: "8px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" },
    corner: { display: "block", minWidth: 58, textAlign: "center", background: "rgba(255,255,255,0.92)", border: "1px solid #111", color: "#111", padding: "5px 12px", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textDecoration: "none", borderRadius: 0, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" },
    black: { background: "#111", border: "1px solid #111", color: "#fff", padding: "11px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", cursor: "pointer", borderRadius: 0 },
    body: { padding: "20px 18px 60px", maxWidth: 940, margin: "0 auto" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 16 },
    label: { display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", color: "#888", marginBottom: 6, textTransform: "uppercase" },
    input: { width: "100%", boxSizing: "border-box", border: "none", borderBottom: "1px solid #111", padding: "8px 2px", fontSize: 16, fontFamily: MA_FONT, color: "#111", background: "transparent", outline: "none" },
  };

  // ---- 拡大ライトボックス ----
  const renderLightbox = () => {
    if (!lightbox) return null;
    const { photos, i, zoom, album } = lightbox;
    const cur = photos[i] || { url: "", caption: "" };
    const go = (d) => setLightbox(lb => ({ ...lb, i: (lb.i + d + photos.length) % photos.length, zoom: false }));
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "#000", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", color: "#fff" }}>
          <span style={{ fontSize: 11, letterSpacing: "0.2em", fontFamily: MA_FONT }}>{i + 1} / {photos.length}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {album && <button onClick={() => sharePhoto(album, cur)} disabled={sharing} style={{ background: "none", border: "1px solid #fff", color: "#fff", padding: "6px 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", cursor: "pointer", fontFamily: MA_FONT, whiteSpace: "nowrap" }}>{sharing ? "..." : "Share this pic"}</button>}
            <button onClick={() => setLightbox(null)} style={{ background: "none", border: "1px solid #fff", color: "#fff", padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", cursor: "pointer", fontFamily: MA_FONT }}>CLOSE</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: zoom ? "auto" : "hidden", display: "flex", alignItems: zoom ? "flex-start" : "center", justifyContent: zoom ? "flex-start" : "center", position: "relative" }}>
          <KitImage src={cur.url} style={zoom ? { width: "auto", maxWidth: "none", height: "auto", cursor: "zoom-out", display: "block" } : { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", cursor: "zoom-in", display: "block" }} />
          <div onClick={() => setLightbox(lb => ({ ...lb, zoom: !lb.zoom }))} style={{ position: "absolute", inset: 0 }} title="タップで拡大/縮小" />
        </div>
        {cur.caption && !zoom && (
          <div style={{ padding: "12px 18px 18px", color: "#fff", fontFamily: MA_FONT, fontSize: 13, lineHeight: 1.7, letterSpacing: "0.03em", background: "#000", whiteSpace: "pre-wrap" }}>{cur.caption}</div>
        )}
        {photos.length > 1 && !zoom && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "0 10px", position: "absolute", top: "50%", left: 0, right: 0, transform: "translateY(-50%)", pointerEvents: "none" }}>
            <button onClick={() => go(-1)} style={{ pointerEvents: "auto", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 44, height: 44, fontSize: 22, cursor: "pointer" }}>‹</button>
            <button onClick={() => go(1)} style={{ pointerEvents: "auto", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", width: 44, height: 44, fontSize: 22, cursor: "pointer" }}>›</button>
          </div>
        )}
      </div>
    );
  };

  // ---- アルバム全体シェアの結果（全画像をプレビュー→1枚ずつ確実に保存） ----
  const renderShareResult = () => {
    if (!shareResult) return null;
    const { files, urls, text } = shareResult;
    let canAll = false;
    try { canAll = typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files }); } catch (e) { canAll = false; }
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(0,0,0,0.94)", overflowY: "auto", padding: "16px 16px 40px", fontFamily: MA_FONT }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          {shareSelect
            ? <button onClick={() => setShareResult(null)} style={{ background: "none", border: "1px solid #fff", color: "#fff", padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", cursor: "pointer" }}>‹ 選び直す</button>
            : <span style={{ color: "#fff", fontSize: 12, letterSpacing: "0.18em" }}>{files.length} IMAGES</span>}
          <button onClick={() => { setShareResult(null); setShareSelect(null); }} style={{ background: "none", border: "1px solid #fff", color: "#fff", padding: "6px 14px", fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", cursor: "pointer" }}>CLOSE</button>
        </div>
        <div style={{ color: "#bbb", fontSize: 11, lineHeight: 1.8, marginBottom: 14 }}>これで1投稿分（画像最大4枚）。{canAll ? "「まとめて共有」でそのままXへ投稿できます。" : "各画像を「保存」してXに投稿してください。"}</div>
        {canAll && <button onClick={async () => { try { await navigator.share({ files, text }); } catch (e) {} }} style={{ width: "100%", padding: "13px", background: "#fff", color: "#111", border: "none", fontSize: 12, fontWeight: 800, letterSpacing: "0.18em", cursor: "pointer", marginBottom: 16 }}>まとめて共有 / SHARE ALL</button>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {urls.map((u, i) => (
            <div key={i}>
              {u && <img src={u} alt="" style={{ width: "100%", display: "block", border: "1px solid #333" }} />}
              <button onClick={() => saveOne(files[i])} style={{ width: "100%", marginTop: 6, padding: "9px", background: "#111", color: "#fff", border: "1px solid #fff", fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", cursor: "pointer" }}>{i + 1} / {files.length}　保存 SAVE</button>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontSize: 12, letterSpacing: "0.1em", textDecoration: "underline" }}>Xを開く（投稿テキスト）</a>
        </div>
      </div>
    );
  };

  // ---- シェアする写真の選択（最大16枚＝1投稿分） ----
  const renderShareSelect = () => {
    if (!shareSelect || shareResult) return null; // プレビュー表示中は隠す（戻るで再表示）
    const { album, sel, large = [] } = shareSelect;
    const ph = maNormPhotos(album.photos);
    const imgN = Math.ceil(sel.length / 4);
    const bigOf = (order) => { const gs = Math.floor(order / 4) * 4; const g = sel.slice(gs, gs + 4); const ex = g.find(idx => large.includes(idx)); return ex != null ? ex : g[0]; };
    return (
      <div style={{ ...ma.wrap, zIndex: 420 }}>
        <div style={ma.bar}>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={ma.ghost} onClick={() => setShareSelect(null)}>CANCEL</button>
            <button style={ma.ghost} onClick={() => setShareSelect(s => (s ? { ...s, sel: [], large: [] } : s))} disabled={sel.length === 0}>全解除</button>
          </div>
          <button style={ma.black} onClick={doShareSelected} disabled={sharing || sel.length === 0}>{sharing ? "..." : `シェア (${sel.length})`}</button>
        </div>
        <div style={ma.body}>
          <div style={{ fontSize: 12, letterSpacing: "0.04em", color: "#555", lineHeight: 1.9, marginBottom: 16 }}>
            シェアする写真を選択（最大{MAX_SHARE_PHOTOS}枚＝1投稿分）。<b>4枚ごとに1画像</b>になり、各画像は「大きい1枚＋小さい3枚」。<br />
            写真の<b style={{ color: "#111" }}>右側の「大」</b>をタップすると、その写真を大きく表示できます（1画像につき1枚）。<br />
            <b>左上の番号の色＝何枚目の画像か</b>：
            <span style={{ color: "#2563eb", fontWeight: 800 }}>■1枚目</span> <span style={{ color: "#16a34a", fontWeight: 800 }}>■2枚目</span> <span style={{ color: "#ea580c", fontWeight: 800 }}>■3枚目</span> <span style={{ color: "#9333ea", fontWeight: 800 }}>■4枚目</span><br />
            選択 <b style={{ color: "#111" }}>{sel.length}</b> / {MAX_SHARE_PHOTOS}　→　生成画像 {imgN} 枚
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
            {ph.map((p, i) => {
              const order = sel.indexOf(i);
              const on = order >= 0;
              const isBig = on && bigOf(order) === i; // この組で大きく表示される写真
              const grpColor = ["#2563eb", "#16a34a", "#ea580c", "#9333ea"][Math.floor(order / 4) % 4]; // 何枚目の画像か＝番号の色
              return (
                <div key={i} onClick={() => toggleShareSel(i)} style={{ position: "relative", aspectRatio: "1/1", overflow: "hidden", cursor: "pointer", border: isBig ? "3px solid #111" : (on ? "2px solid #111" : "2px solid #eee"), opacity: on ? 1 : 0.55 }}>
                  <MaThumb src={p.url} maxPx={480} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {on && <div style={{ position: "absolute", top: 4, left: 4, minWidth: 20, height: 20, padding: "0 5px", boxSizing: "border-box", background: grpColor, color: "#fff", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{order + 1}</div>}
                  {on && (
                    <button onClick={(e) => { e.stopPropagation(); toggleShareLarge(i); }}
                      title="大きく表示する写真にする"
                      style={{ position: "absolute", top: 0, right: 0, height: "100%", width: "40%", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 5 }}>
                      <span style={{ padding: "2px 8px", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", background: isBig ? "#2563eb" : "rgba(255,255,255,0.85)", color: isBig ? "#fff" : "#111", border: `1px solid ${isBig ? "#2563eb" : "#111"}` }}>大</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ---- ビフォーアフター（BEFORE/AFTER を直接アップロード＋コメント） ----
  const renderBeforeAfter = () => {
    if (!baSelect) return null;
    const { beforeUrl, afterUrl, comment, bt = { z: 1, ox: 0.5, oy: 0.5 }, at = { z: 1, ox: 0.5, oy: 0.5 } } = baSelect;
    const slot = (label, key, url, tKey, t) => (
      <div style={{ flex: 1, minWidth: 130 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", marginBottom: 6 }}>{label}</div>
        {url ? (
          <div>
            <BaAdjust url={url} t={t} onChange={(nt) => setBaSelect(s => (s ? { ...s, [tKey]: nt } : s))} />
            <label style={{ display: "block", marginTop: 6, textAlign: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#555", border: "1px solid #ccc", padding: "5px 0", cursor: "pointer" }}>
              画像を変更
              <input type="file" accept="image/*" onChange={(e) => onBaPick(key, e)} style={{ display: "none" }} />
            </label>
          </div>
        ) : (
          <label style={{ display: "block", cursor: "pointer" }}>
            <div style={{ aspectRatio: "797 / 790", border: "1px dashed #111", background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, color: "#888", letterSpacing: "0.08em" }}>画像をアップロード</span>
            </div>
            <input type="file" accept="image/*" onChange={(e) => onBaPick(key, e)} style={{ display: "none" }} />
          </label>
        )}
      </div>
    );
    return (
      <div style={{ ...ma.wrap, zIndex: 420 }}>
        <div style={ma.bar}>
          <button style={ma.ghost} onClick={() => setBaSelect(null)}>CANCEL</button>
          <button style={ma.black} onClick={doBeforeAfter} disabled={sharing || !beforeUrl || !afterUrl}>{sharing ? "..." : "作成してシェア"}</button>
        </div>
        <div style={ma.body}>
          <div style={{ fontSize: 12, color: "#555", lineHeight: 1.9, marginBottom: 16 }}>
            <b style={{ color: "#111" }}>BEFORE</b> と <b style={{ color: "#111" }}>AFTER</b> の写真をアップロード。各画像は<b>ドラッグで位置調整・下のスライダーで拡大縮小</b>できます。表示されている範囲がそのまま書き出されます。
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {slot("BEFORE", "beforeUrl", beforeUrl, "bt", bt)}
            {slot("AFTER", "afterUrl", afterUrl, "at", at)}
          </div>
          <label style={ma.label}>コメント（画像ヘッダーに表示）</label>
          <input style={ma.input} value={comment} onChange={e => setBaSelect(s => ({ ...s, comment: e.target.value }))} placeholder="例：全塗装でディテールアップ" />
        </div>
      </div>
    );
  };

  // ---- 初回アクセス時の案内ポップアップ ----
  const renderIntro = () => {
    if (!maIntro) return null;
    return (
      <div onClick={dismissIntro} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22, fontFamily: MA_FONT }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: "2px solid #111", maxWidth: 340, width: "100%", padding: "26px 22px 22px", textAlign: "center", boxSizing: "border-box" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.34em", color: "#999", marginBottom: 14 }}>WELCOME</div>
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.95, color: "#111" }}>
            ホーム画面追加推奨！<br />「HELP」から操作方法を<br />しっかり読んでねっ！
          </div>
          <button onClick={dismissIntro} style={{ ...ma.black, width: "100%", marginTop: 20, padding: "13px" }}>OK</button>
        </div>
      </div>
    );
  };

  // ---- バックアップ ----
  const renderBackup = () => {
    if (!maBackup) return null;
    return (
      <div style={{ ...ma.wrap, zIndex: 430 }}>
        <div style={ma.bar}>
          <div><div style={ma.brand}>BACKUP</div><div style={ma.sub}>MODELERS ALBUM</div></div>
          <button style={ma.ghost} onClick={() => setMaBackup(false)}>CLOSE</button>
        </div>
        <div style={{ ...ma.body, maxWidth: 560 }}>
          <div style={{ fontSize: 13, lineHeight: 1.95, color: "#333", marginBottom: 22 }}>モデラーズアルバムのデータ（写真は高画質のまま）を1つのJSONファイルに書き出し／読み込みできます。機種変更やブラウザ移行の前に保存してください。</div>
          <div style={{ border: "1px solid #111", padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 6 }}>エクスポート（バックアップ）</div>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.7, marginBottom: 10 }}>全アルバム（{albums.length}件）を<b>1つのZIPファイル</b>にまとめて保存します（保存は1回だけ・大容量でも安定）。</div>
            <button style={{ ...ma.black, width: "100%", boxSizing: "border-box" }} onClick={exportZip}>ZIP一括ダウンロード（{albums.length}件）</button>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.08em", marginBottom: 6 }}>うまくいかない時：アルバムごとに保存（JSON）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {albums.map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{a.title || "UNTITLED"}<span style={{ color: "#999", marginLeft: 6 }}>{maNormPhotos(a.photos).length}枚</span></span>
                    <button style={{ ...ma.ghost, padding: "5px 12px", flexShrink: 0 }} onClick={() => maExport([a])}>保存</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ border: "1px solid #111", padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", marginBottom: 6 }}>インポート（復元）</div>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.7, marginBottom: 12 }}>ZIP／JSONのバックアップから復元します。<b>複数ファイルをまとめて選択</b>でき、順番に取り込んで既存のアルバムに統合します（同じアルバムは置き換え）。</div>
            <button style={{ ...ma.ghost, width: "100%", boxSizing: "border-box" }} onClick={() => maFileRef.current && maFileRef.current.click()}>ファイルを選択（複数可）</button>
            <input ref={maFileRef} type="file" accept=".zip,.json,application/zip,application/json" multiple style={{ display: "none" }} onChange={maImport} />
          </div>
          <div style={{ fontSize: 11, color: "#999", lineHeight: 1.7 }}>※ データは端末内のみに保存されます。Safari／Chromeなどブラウザが違うと別データになります。移行時は必ずエクスポート→インポートしてください。</div>
        </div>
        {maBusy && (
          <div style={{ position: "fixed", inset: 0, zIndex: 460, background: "rgba(255,255,255,0.96)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: MA_FONT }}>
            <style>{"@keyframes maspin{to{transform:rotate(360deg)}}"}</style>
            <div style={{ width: 40, height: 40, border: "3px solid #e5e7eb", borderTopColor: "#111", borderRadius: "50%", animation: "maspin 0.8s linear infinite" }} />
            <div style={{ fontSize: 13, letterSpacing: "0.18em", color: "#111", fontWeight: 800 }}>データ作成中…</div>
            <div style={{ fontSize: 11, color: "#888", letterSpacing: "0.04em" }}>写真が多いと少し時間がかかります</div>
          </div>
        )}
        {bkReady && (
          <div style={{ position: "fixed", inset: 0, zIndex: 460, background: "rgba(255,255,255,0.97)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, fontFamily: MA_FONT, textAlign: "center" }}>
            {bkReady.queue && <div style={{ fontSize: 11, letterSpacing: "0.16em", color: "#888", fontWeight: 700 }}>{bkReady.qi + 1} / {bkReady.queue.length} 件目</div>}
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", color: "#111", maxWidth: 320, overflowWrap: "anywhere" }}>{bkReady.name}</div>
            <div style={{ fontSize: 12, color: "#666" }}>約{bkReady.sizeMB}MB</div>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8, maxWidth: 320 }}>下のボタンを押すと保存（ダウンロード）します。{bkReady.queue ? "保存すると自動で次のアルバムが出ます。" : "端末の保存先選択が出たらお好きな場所へ。"}</div>
            <a href={bkReady.url} download={bkReady.name}
              onClick={() => advanceBackup(bkReady)}
              style={{ ...ma.black, minWidth: 240, textDecoration: "none", textAlign: "center", display: "inline-block" }}>
              {bkReady.queue ? (bkReady.qi + 1 < bkReady.queue.length ? "保存して次へ" : "保存して完了") : "ダウンロードして保存"}
            </a>
            <button style={{ ...ma.ghost }} onClick={() => { try { URL.revokeObjectURL(bkReady.url); } catch (e) {} setBkReady(null); }}>{bkReady.queue ? "中止" : "閉じる"}</button>
          </div>
        )}
      </div>
    );
  };

  // ---- 取扱説明書（使い方） ----
  const renderHelp = () => {
    if (!maHelp) return null;
    const H2 = { fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", margin: "26px 0 8px", paddingBottom: 6, borderBottom: "1px solid #111", color: "#111" };
    const P = { fontSize: 13, lineHeight: 1.95, color: "#333", margin: "0 0 6px" };
    const UL = { margin: 0, paddingLeft: "1.3em" };
    const LI = { fontSize: 13, lineHeight: 1.9, color: "#333" };
    return (
      <div style={{ ...ma.wrap, zIndex: 430 }}>
        <div style={ma.bar}>
          <div><div style={ma.brand}>使い方 / HELP</div><div style={ma.sub}>MODELERS ALBUM</div></div>
          <button style={ma.ghost} onClick={() => setMaHelp(false)}>CLOSE</button>
        </div>
        <div style={{ ...ma.body, maxWidth: 720 }}>
          <p style={P}>モデラーズアルバムは、あなたの作品を高画質で記録・展示するためのポートフォリオです。写真や情報は<b>すべてこの端末内に保存</b>され、サーバーには送信されません。</p>

          <div style={{ border: "2px solid #111", padding: "13px 15px", margin: "16px 0 8px", background: "#fafafa" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", marginBottom: 7 }}>はじめに：必ずホーム画面に追加してください</div>
            <div style={{ fontSize: 12.5, lineHeight: 2, color: "#333" }}>
              快適に使うため、<b>この画面を必ずホーム画面に追加</b>してからご利用ください。<br />
              <b>iPhone（Safari）</b>：画面下の<b>共有ボタン</b>→「<b>ホーム画面に追加</b>」。<br />
              <b>Android（Chrome）</b>：メニュー（⋮）→「<b>ホーム画面に追加</b>」。<br />
              追加すると「Modelers Album」専用アイコンで、アプリのように起動できます。<br />
              ※データは追加したこのアプリ内に保存されます。万一に備え、下記10のバックアップも必ず併用してください。
            </div>
          </div>

          <div style={H2}>1. アルバムを作る</div>
          <p style={P}>トップ右上の「NEW ALBUM」から作成します。作品名／作成年月／タグ／制作コメントを登録し、「SAVE」で保存。一覧のカバーをタップで閲覧、右上「EDIT」で再編集できます。</p>

          <div style={H2}>2. 写真を追加する（高画質）</div>
          <ul style={UL}>
            <li style={LI}>編集画面の「ADD」から追加（1アルバム最大30枚）。</li>
            <li style={LI}>写真は<b>圧縮せず原本のまま</b>保存するので高画質です。</li>
            <li style={LI}>各写真下部の「表紙にする」で<b>表紙（COVER）</b>を指定できます。</li>
          </ul>

          <div style={H2}>3. 写真を並べ替える</div>
          <p style={P}>編集画面で写真を<b>長押し</b>すると浮き上がり、動かして離した位置へ移動できます。左上の「‹ ›」ボタンでも前後に動かせます。</p>

          <div style={H2}>4. 写真ごとにコメント</div>
          <p style={P}>編集画面で各写真の下に入力欄があります。閲覧時・拡大時・写真単体のシェア画像にも表示されます。</p>

          <div style={H2}>5. タグ</div>
          <p style={P}>編集画面でタグの付与・新規追加ができます。「タグを編集」を押すと、タグ名の<b>改名</b>（タップ）と<b>削除</b>（✕）が可能です（すべてのアルバム・キットに反映されます）。</p>

          <div style={H2}>6. 写真を拡大して見る</div>
          <p style={P}>閲覧画面で写真をタップすると全画面表示。さらに<b>画像をタップで等倍ズーム</b>（細部確認）、左右の「‹ ›」で送れます。</p>

          <div style={H2}>7. Xにシェアする（写真1枚）</div>
          <p style={P}>拡大画面の「Share this pic」で、その写真を<b>コメント入りヘッダー付き</b>の画像にしてXへ投稿できます。投稿テキストには <b>#モデラーズアルバム #TSUMITSUMI</b> が自動で付きます。</p>

          <div style={H2}>8. Xにシェアする（アルバム）</div>
          <ul style={UL}>
            <li style={LI}>閲覧画面の「Share ALL」→ シェアする写真を<b>最大16枚</b>選択します。</li>
            <li style={LI}><b>4枚ごとに1画像</b>（最大4画像＝X1投稿分）を生成。各画像は「<b>大きい1枚＋小さい3枚</b>」のレイアウトです。</li>
            <li style={LI}>各写真の<b>右側の「大」をタップ</b>すると、その画像で大きく表示する1枚を選べます（もう一度タップでOFF）。</li>
            <li style={LI}>1枚目のヘッダーに作品名・完成年月・コメントが入り、各写真の<b>コメントも画像内に表示</b>されます（長文も折り返して表示）。</li>
            <li style={LI}>生成後、プレビューから1枚ずつ保存／まとめて共有できます（Xは1投稿あたり画像4枚まで）。</li>
          </ul>

          <div style={H2}>9. ビフォーアフター画像</div>
          <p style={P}>トップの「Before After作成」→ BEFORE と AFTER の写真を<b>アップロード</b>＋コメント入力 → X向けの<b>横長1枚</b>の比較画像を生成します。</p>

          <div style={H2}>10. バックアップ（保存・復元）</div>
          <ul style={UL}>
            <li style={LI}>トップ右上の<b>ダウンロードアイコン</b>（HELPの左）からバックアップ画面を開けます。</li>
            <li style={LI}>「エクスポート」で<b>全アルバム＋写真を1つのJSONファイル</b>に書き出し。iCloudやGoogleドライブに保管しておくと安心です。</li>
            <li style={LI}>機種変更・ブラウザ移行のときは、新しい環境で「インポート」して復元します（現在のデータは上書き）。</li>
            <li style={LI}>※写真が多いとファイルはかなり大きくなります。</li>
          </ul>

          <div style={H2}>11. 保存とデータについて</div>
          <ul style={UL}>
            <li style={LI}>データは<b>この端末内のみ</b>に保存されます（プライバシー重視）。</li>
            <li style={LI}>ブラウザのキャッシュ削除や機種変更で<b>消える可能性</b>があります。<b>定期的にバックアップ（上記10）</b>を取ることを強くおすすめします。</li>
          </ul>
          <div style={{ height: 30 }} />
        </div>
      </div>
    );
  };

  // ---- 一覧 ----
  if (mode === "list") {
    return (
      <div style={ma.wrap}>
        <div style={ma.bar}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <img src="/modelers-logo.jpg" alt="Modelers Album" style={{ height: 40, width: "auto", display: "block" }} />
            <div>
              <div style={ma.brand}>MODELERS ALBUM</div>
              <div style={ma.sub}>PORTFOLIO</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
            <button style={{ ...ma.ghost, padding: "8px 11px", display: "flex", alignItems: "center" }} onClick={maShareApp} title="このアプリを共有">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
            </button>
            <button style={{ ...ma.ghost, padding: "8px 11px", display: "flex", alignItems: "center" }} onClick={() => setMaBackup(true)} title="バックアップ">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></svg>
            </button>
            <button style={ma.ghost} onClick={() => setMaHelp(true)}>HELP</button>
            <a href="/" title="ツミツミへ" style={{ display: "flex", alignItems: "center" }}>
              <img src="/LOGO.png" alt="TSUMI TSUMI" style={{ height: 28, width: "auto", display: "block" }} />
            </a>
          </div>
        </div>
        <div style={ma.body}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, letterSpacing: "0.2em", color: "#888" }}>{albums.length} WORKS</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={ma.ghost} onClick={() => startBeforeAfter(null)}>Before After作成</button>
              <button style={ma.black} onClick={startNew}>NEW ALBUM</button>
            </div>
          </div>
          {albums.length === 0 ? (
            <div style={{ textAlign: "center", color: "#aaa", padding: "80px 0", fontSize: 13, letterSpacing: "0.1em", lineHeight: 2 }}>
              作品アルバムがありません<br />「NEW ALBUM」から作成しましょう
            </div>
          ) : (
            <div style={ma.grid}>
              {[...albums].sort((a, b) => {
                const ya = a.createdYM || "", yb = b.createdYM || "";
                if (ya === yb) return 0;
                if (!ya) return 1; if (!yb) return -1; // 制作年月なしは末尾
                return yb < ya ? -1 : 1; // 制作年月の新しい順（降順）
              }).map(a => {
                const ph = maNormPhotos(a.photos);
                const cover = ph[a.cover || 0] || ph[0];
                return (
                  <div key={a.id} onClick={() => { setViewId(a.id); setMode("view"); }} style={{ cursor: "pointer" }}>
                    <div style={{ width: "100%", aspectRatio: "1/1", background: "#111", overflow: "hidden", position: "relative" }}>
                      {cover ? <MaThumb src={cover.url} maxPx={480} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 10, letterSpacing: "0.2em" }}>NO IMAGE</div>}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title || "UNTITLED"}</div>
                    <div style={{ fontSize: 10, color: "#999", letterSpacing: "0.14em", marginTop: 2 }}>{fmtYM(a.createdYM)}{a.createdYM && (a.photos || []).length ? "  /  " : ""}{(a.photos || []).length ? `${a.photos.length} PHOTOS` : ""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {renderLightbox()}
        {renderBeforeAfter()}
        {renderShareResult()}
        {renderHelp()}
        {renderBackup()}
        {renderIntro()}
        {/* 左下フロート：TSUMITSUMI本体の「プラモを預ける」と同じ配置方式。やや小さめ・目立たせない。 */}
        <div style={{ position: "fixed", bottom: 20, left: 14, zIndex: 40, display: "flex", flexDirection: "column", gap: 6 }}>
          <a href="/tips/" target="_blank" rel="noopener noreferrer" style={ma.corner}>TIPS</a>
          <a href="/gears.html" target="_blank" rel="noopener noreferrer" style={ma.corner}>TOOLS</a>
        </div>
      </div>
    );
  }

  // ---- 閲覧 ----
  if (mode === "view" && viewing) {
    const a = viewing;
    return (
      <div style={ma.wrap}>
        <div style={ma.bar}>
          <button style={ma.ghost} onClick={() => { setViewId(null); setMode("list"); }}>BACK</button>
          <div style={{ display: "flex", gap: 8 }}>
            {maNormPhotos(a.photos).length > 0 && <button style={ma.black} onClick={() => shareAlbum(a)} disabled={sharing}>{sharing ? "..." : "Share ALL"}</button>}
            <button style={ma.ghost} onClick={() => startEdit(a)}>EDIT</button>
          </div>
        </div>
        <div style={ma.body}>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", color: "#999" }}>{fmtYM(a.createdYM)}</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "0.02em", margin: "6px 0 14px", lineHeight: 1.25 }}>{a.title || "UNTITLED"}</h1>
          {(a.tags || []).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {a.tags.map(t => <span key={t} style={{ border: "1px solid #111", padding: "3px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>{t}</span>)}
            </div>
          )}
          {a.comment && <p style={{ fontSize: 14, lineHeight: 1.9, color: "#333", whiteSpace: "pre-wrap", margin: "0 0 22px", paddingBottom: 22, borderBottom: "1px solid #eee" }}>{a.comment}</p>}
          {(() => {
            const ph = maNormPhotos(a.photos);
            return (<>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                {ph.map((p, i) => (
                  <div key={i} onClick={() => setLightbox({ album: a, photos: ph, i, zoom: false })} style={{ cursor: "zoom-in" }}>
                    <div style={{ aspectRatio: "1/1", background: "#f4f4f4", overflow: "hidden" }}>
                      <MaThumb src={p.url} maxPx={480} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    {p.caption && <div style={{ fontSize: 10, color: "#666", lineHeight: 1.5, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.caption}</div>}
                  </div>
                ))}
              </div>
              {ph.length === 0 && <div style={{ color: "#bbb", fontSize: 12, padding: "40px 0", textAlign: "center" }}>写真がありません</div>}
            </>);
          })()}
        </div>
        {renderLightbox()}
        {renderShareSelect()}
        {renderBeforeAfter()}
        {renderShareResult()}
      </div>
    );
  }

  // ---- 編集 ----
  if (mode === "edit" && draft) {
    const masterTags = [...new Set([...(tagMasterList || []), ...draft.tags])];
    return (
      <div style={{ ...ma.wrap, overflowY: dragView ? "hidden" : "auto" }}>
        <div style={ma.bar}>
          <button style={ma.ghost} onClick={() => { setMode(viewId ? "view" : "list"); setDraft(null); }}>CANCEL</button>
          <div style={{ display: "flex", gap: 8 }}>
            {albums.some(x => x.id === draft.id) && <button style={{ ...ma.ghost, borderColor: "#c00", color: "#c00" }} onClick={() => deleteAlbum(draft)}>DELETE</button>}
            <button style={ma.black} onClick={saveDraft}>SAVE</button>
          </div>
        </div>
        <div style={ma.body}>
          <div style={{ marginBottom: 22 }}>
            <label style={ma.label}>作品名 / Title</label>
            <input style={ma.input} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="例：RX-78-2 ガンダム" />
          </div>
          <div style={{ marginBottom: 22, maxWidth: 220 }}>
            <label style={ma.label}>作成年月 / Date</label>
            <input type="month" style={ma.input} value={draft.createdYM} onChange={e => setDraft(d => ({ ...d, createdYM: e.target.value }))} />
          </div>
          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ ...ma.label, marginBottom: 0 }}>タグ / Tags</label>
              <button onClick={() => { setTagManage(m => !m); setEditTag(null); }} style={{ background: "none", border: "none", color: "#888", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", cursor: "pointer", textDecoration: "underline", fontFamily: MA_FONT }}>{tagManage ? "完了" : "タグを編集"}</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {masterTags.map(t => {
                if (tagManage && editTag === t) {
                  return <input key={t} autoFocus value={editTagVal} onChange={e => setEditTagVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); renameTag(t, editTagVal); } }} onBlur={() => renameTag(t, editTagVal)} style={{ border: "1px solid #111", padding: "4px 8px", fontSize: 11, fontFamily: MA_FONT, width: 110, outline: "none" }} />;
                }
                if (tagManage) {
                  return (
                    <span key={t} style={{ display: "inline-flex", alignItems: "center", border: "1px solid #111" }}>
                      <button onClick={() => { setEditTag(t); setEditTagVal(t); }} style={{ border: "none", background: "#fff", color: "#111", padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MA_FONT }}>{t}</button>
                      <button onClick={() => deleteTagEverywhere(t)} style={{ border: "none", borderLeft: "1px solid #111", background: "#111", color: "#fff", padding: "4px 8px", fontSize: 11, cursor: "pointer", lineHeight: 1 }}>✕</button>
                    </span>
                  );
                }
                const on = draft.tags.includes(t);
                return <button key={t} onClick={() => toggleTag(t)} style={{ border: "1px solid #111", padding: "4px 11px", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", background: on ? "#111" : "#fff", color: on ? "#fff" : "#111", fontFamily: MA_FONT }}>{t}</button>;
              })}
            </div>
            {tagManage ? (
              <div style={{ fontSize: 10, color: "#999", letterSpacing: "0.04em" }}>タグ名をタップで改名／✕で削除（全アルバム・キットに反映）</div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...ma.input, flex: 1 }} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addNewTag(); } }} placeholder="新しいタグを追加" />
                <button style={ma.ghost} onClick={() => addNewTag()}>ADD</button>
              </div>
            )}
          </div>
          <div style={{ marginBottom: 26 }}>
            <label style={ma.label}>制作コメント / Notes</label>
            <textarea value={draft.comment} onChange={e => setDraft(d => ({ ...d, comment: e.target.value }))} placeholder="制作のこだわり・使用塗料・反省点など自由に" style={{ width: "100%", boxSizing: "border-box", minHeight: 90, border: "1px solid #111", padding: "10px", fontSize: 14, lineHeight: 1.7, fontFamily: MA_FONT, resize: "vertical", outline: "none" }} />
          </div>
          <div>
            <label style={ma.label}>写真 / Photos（最大{MAX_ALBUM_PHOTOS}枚・高画質のまま保存／各写真にコメント可／長押しで並べ替え・‹›でも移動）</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {draft.photos.map((p, i) => (
                <div key={i}>
                  <div data-photo-cell={i}
                    onPointerDown={(e) => onPhotoPointerDown(e, i, p)} onPointerMove={onPhotoPointerMove} onPointerUp={onPhotoPointerUp} onPointerCancel={onPhotoPointerUp}
                    style={{ position: "relative", aspectRatio: "1/1", background: "#f4f4f4", overflow: "hidden", border: (draft.cover || 0) === i ? "2px solid #111" : "2px solid transparent", opacity: dragView && dragRef.current.from === i ? 0.3 : 1, touchAction: "manipulation", cursor: "grab", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
                    <MaThumb src={p.url} maxPx={480} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }} />
                    <div style={{ position: "absolute", top: 4, left: 4, display: "flex", gap: 4 }}>
                      <button onClick={() => movePhoto(i, -1)} disabled={i === 0} style={{ width: 24, height: 24, border: "none", borderRadius: 0, background: i === 0 ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.7)", color: "#fff", fontSize: 15, lineHeight: 1, cursor: i === 0 ? "default" : "pointer" }} title="前へ">‹</button>
                      <button onClick={() => movePhoto(i, 1)} disabled={i === draft.photos.length - 1} style={{ width: 24, height: 24, border: "none", borderRadius: 0, background: i === draft.photos.length - 1 ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.7)", color: "#fff", fontSize: 15, lineHeight: 1, cursor: i === draft.photos.length - 1 ? "default" : "pointer" }} title="後ろへ">›</button>
                    </div>
                    <button onClick={() => removePhoto(i)} style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 0, border: "none", background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>✕</button>
                    <button onClick={() => setDraft(d => ({ ...d, cover: i }))} style={{ position: "absolute", bottom: 0, left: 0, right: 0, border: "none", background: (draft.cover || 0) === i ? "#111" : "rgba(0,0,0,0.55)", color: "#fff", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", padding: "3px 0", cursor: "pointer" }}>{(draft.cover || 0) === i ? "COVER" : "表紙にする"}</button>
                  </div>
                  <input value={p.caption || ""} onChange={e => setCaption(i, e.target.value)} placeholder="コメント" style={{ width: "100%", boxSizing: "border-box", marginTop: 5, border: "none", borderBottom: "1px solid #ddd", padding: "4px 2px", fontSize: 11, fontFamily: MA_FONT, outline: "none", background: "transparent" }} />
                </div>
              ))}
              {draft.photos.length < MAX_ALBUM_PHOTOS && (
                <label style={{ aspectRatio: "1/1", border: "1px dashed #111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 11, letterSpacing: "0.1em", color: "#111", gap: 4 }}>
                  <span style={{ fontSize: 22, fontWeight: 300 }}>+</span>
                  <span>{busy ? "保存中…" : "ADD"}</span>
                  <span style={{ fontSize: 9, color: "#999" }}>{draft.photos.length}/{MAX_ALBUM_PHOTOS}</span>
                  <input type="file" accept="image/*" multiple onChange={addPhotos} style={{ display: "none" }} disabled={busy} />
                </label>
              )}
            </div>
          </div>
        </div>
        {dragView && (
          <div style={{ position: "fixed", left: dragView.x, top: dragView.y, transform: "translate(-50%, -50%)", width: 116, height: 116, zIndex: 500, pointerEvents: "none", background: "#fff", overflow: "hidden", border: "2px solid #111", boxShadow: "0 10px 30px rgba(0,0,0,0.45)" }}>
            <KitImage src={dragView.url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        )}
        {renderLightbox()}
      </div>
    );
  }

  return null;
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
  // --- 永続化（堅牢版）---
  // 巨大データで「保存の追い越し」「タブ間の読み戻し競合」が起き、編集（個数など）が消える/
  // 総額が揺れる問題への対策:
  //   1) 連続編集をデバウンスして1回にまとめる（巨大配列の全件書き込みを減らす）
  //   2) 書き込みを直列化（前の保存完了を待つ＝追い越しによる巻き戻し防止）
  //   3) タブ間通知(BroadcastChannel)は「保存完了後」に送る（他タブが最新を読む）
  //   4) タブを閉じる/バックグラウンド化する直前に未保存分を即フラッシュ（取りこぼし防止）
  const suppressBroadcastRef = useRef(false); // 受信由来の setKits を再ブロードキャストしない
  const broadcastChannelRef = useRef(null);
  const latestKitsRef = useRef(kits);
  const saveTimerRef = useRef(null);
  const saveChainRef = useRef(Promise.resolve());
  useEffect(() => { latestKitsRef.current = kits; }, [kits]);

  const flushSave = () => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    const snapshot = latestKitsRef.current;
    const wasSuppressed = suppressBroadcastRef.current;
    suppressBroadcastRef.current = false;
    // 直列化：前の保存が終わってから次を実行（idbSet の追い越しを防止）
    saveChainRef.current = saveChainRef.current.then(async () => {
      try { localStorage.setItem("tsumitsumi_kits", JSON.stringify(snapshot)); } catch (e) {}
      await kitsIdbSave(snapshot);
      // 保存が完了してから他タブへ通知（他タブが古いIDBを読み戻すのを防ぐ）
      if (!wasSuppressed) { try { broadcastChannelRef.current?.postMessage({ type: 'kits-changed' }); } catch (e) {} }
    }).catch(() => {});
    return saveChainRef.current;
  };

  // kits 変更をデバウンスして保存（連続編集を1回にまとめる）
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [kits]);

  // タブを閉じる/離れる直前に未保存分を確実に書き込む
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', flushSave); document.removeEventListener('visibilitychange', onHide); };
  }, []);

  // マルチタブ同期：他タブの変更通知を受けて IDB から最新を再読込
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel('tsumitsumi-kits');
    ch.onmessage = async (ev) => {
      if (ev && ev.data && ev.data.type === 'kits-changed') {
        const fresh = await kitsIdbLoad();
        if (Array.isArray(fresh)) {
          suppressBroadcastRef.current = true; // 受信由来の更新は再通知しない（ループ防止）
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
  // プレースホルダだけ残る現象の原因になる。ホーム画面追加済みの PWA や
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

  // バックグラウンド価格自動取得の結果トースト（「総額が勝手に増える」誤解を防ぐ説明用）
  const [priceAutoToast, setPriceAutoToast] = useState(null);

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
    let fetchedCount = 0;
    (async () => {
      for (const kit of targets) {
        if (cancelled) break;
        try {
          const r = await fetch(`/api/price?jan=${kit.jan}`);
          const d = await r.json();
          if (d && d.price && !cancelled) {
            fetchedCount++;
            setKits(prev => prev.map(k => k.id === kit.id ? { ...k, retailPrice: String(d.price) } : k));
          }
        } catch {}
        attempted[kit.jan] = Date.now(); // 成否問わず試行時刻を記録
        await new Promise(r => setTimeout(r, 300));
      }
      if (!cancelled) {
        try { localStorage.setItem(PRICE_ATTEMPTED_KEY, JSON.stringify(attempted)); } catch {}
        // 総額が変わった理由を明示（誤解防止）。取得できた時だけ表示し数秒で消える
        if (fetchedCount > 0) {
          setPriceAutoToast(`希望小売価格を ${fetchedCount}件 自動取得しました（総額に反映）`);
          setTimeout(() => { if (!cancelled) setPriceAutoToast(null); }, 7000);
        }
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
  const [albumKit, setAlbumKit] = useState(null); // 完成品アルバムビューアで開いているキット
  const [showModelerAlbum, setShowModelerAlbum] = useState(false); // モデラーズアルバム（ポートフォリオ）表示
  const [showPaints, setShowPaints] = useState(false); // 塗料ストック（マイパレット）表示
  // 入口ボタンは非公開中だが、?modeler または #modeler 付きURLで直接開ける（仕上げのプレビュー用）
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.has("modeler") || window.location.hash === "#modeler") setShowModelerAlbum(true);
      // 塗料（マイパレット）も完成までは非公開。?paint / #paint でのみ起動（プレビュー用）
      if (p.has("paint") || window.location.hash === "#paint") setShowPaints(true);
    } catch (e) {}
  }, []);
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
  const [confirmDelete, setConfirmDelete] = useState(null); // 削除確認ダイアログ対象 { id, name } | null
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
      const photoId = makePhotoId();
      // 完成写真は圧縮せず原本のまま IDB に保存（最高画質。Xシェア・アルバムの主役なので）
      const ok = await kitsIdbPhotoSet(photoId, file);
      if (ok) { added.push(idToIdbBlobUrl(photoId)); }
      // IDB保存失敗時のみ localStorage 用に圧縮（原本は大きすぎて localStorage に入らないため）
      else { const base64 = await compressImageToBase64(file, COMPLETED_PHOTO_MAXPX, COMPLETED_PHOTO_QUALITY, COMPLETED_PHOTO_MAXCHARS); if (base64) added.push(base64); }
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
      "警告\n\n" +
      targets.length + "件のキットの「ユーザー登録画像」を削除し、JANに紐づくデフォルトの画像URLに置き換えます。\n\n" +
      "削除した画像は元に戻せません（バックアップからのみ復元可）\n\n" +
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
    alert("完了\n\n更新: " + updated + "件\nデフォルトの画像なし: " + notFound + "件\n失敗: " + failed + "件");
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
    alert("完了\n\n変換: " + migrated + "件\n失敗: " + failed + "件");
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

  // 譲る/シェア用に、キットの表示画像（completedPhotoUrl || photoUrl）を Blob で取得する。
  // idb-blob: / data: / http(s) のいずれにも対応（http は CORS 回避のため image-proxy 経由）。
  const getKitImageBlob = async (kit) => {
    const src = (kit && (kit.completedPhotoUrl || kit.photoUrl)) || "";
    if (!src) return null;
    try {
      if (isIdbBlobUrl(src)) return await kitsIdbPhotoGet(idbBlobUrlToId(src));
      if (src.startsWith("data:")) return await (await fetch(src)).blob();
      const r = await fetch(`/api/image-proxy?url=${encodeURIComponent(src)}`);
      if (r.ok) return await r.blob();
    } catch (e) {}
    return null;
  };

  const handleWant = async (kit) => {
    const text = `「${kit.name}」これを作ってくれる方に譲りたいです！DMお願いします #TSUMITSUMI #ツミツミ`;
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

    // 画像を File 化（取得できれば）
    let file = null;
    try {
      const blob = await getKitImageBlob(kit);
      if (blob && blob.size > 0) {
        const isPng = (blob.type || "").includes("png");
        file = new File([blob], `tsumitsumi_${kit.jan || "kit"}.${isPng ? "png" : "jpg"}`, { type: blob.type || "image/jpeg" });
      }
    } catch (e) {}

    // スマホ等：Web Share API で「画像つき」共有 → 共有シートから X を選ぶとそのまま画像が添付される
    if (file && typeof navigator !== "undefined" && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // ユーザーがキャンセル
        // それ以外（活性切れ等）は下のフォールバックへ
      }
    }

    // フォールバック（PC・画像共有非対応端末）：X の投稿インテントは画像を自動添付できないため、
    // 画像をダウンロードしておき（手動添付できるように）テキスト投稿画面を開く。
    if (file) {
      try {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (e) {}
    }
    window.open(intentUrl, "_blank");
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
    <div key={kit.id} style={{ borderRadius: 0, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer", position: "relative" }} onClick={() => setDetail(kit)}>
      {(kit.completedPhotoUrl || kit.photoUrl)
        ? <KitImage src={kit.completedPhotoUrl || kit.photoUrl} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", aspectRatio: "1/1", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}><PhotoPlaceholderIcon size={32} /></div>
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
      {bulkMode && (
        <div style={{ width: 24, height: 24, borderRadius: 0, border: `2px solid ${bulkSelected.has(kit.id) ? "#4f8ef7" : "#d1d5db"}`, background: bulkSelected.has(kit.id) ? "#4f8ef7" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {bulkSelected.has(kit.id) && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
        </div>
      )}
      {reorderMode && !bulkMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
          <button style={{ width: 28, height: 28, border: "1.5px solid #e5e7eb", borderRadius: 0, background: index === 0 ? "#f3f4f6" : "#fff", color: index === 0 ? "#ccc" : "#374151", fontSize: 14, cursor: index === 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { e.stopPropagation(); moveKit(kit.id, -1); }} disabled={index === 0}>▲</button>
          <button style={{ width: 28, height: 28, border: "1.5px solid #e5e7eb", borderRadius: 0, background: index === filtered.length - 1 ? "#f3f4f6" : "#fff", color: index === filtered.length - 1 ? "#ccc" : "#374151", fontSize: 14, cursor: index === filtered.length - 1 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { e.stopPropagation(); moveKit(kit.id, 1); }} disabled={index === filtered.length - 1}>▼</button>
        </div>
      )}
      {(kit.completedPhotoUrl || kit.photoUrl) ? <KitImage src={kit.completedPhotoUrl || kit.photoUrl} style={s.thumb} /> : <div style={{ ...s.thumbPh, display: "flex", alignItems: "center", justifyContent: "center" }}><PhotoPlaceholderIcon size={24} /></div>}
      <div style={s.cardBody}>
        <div style={s.cardName}>{kit.name}</div>
        <div style={s.cardMeta}>
          {kit.series && <span>{kit.series}</span>}
          {kit.scale && <span style={s.badge}>{kit.scale}</span>}
          {kit.completed && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 700, marginLeft: 6 }}>✓ 完成済み</span>}
          {kit.tags?.length > 0 && kit.tags.map(tag => (
            <span key={tag} style={{ background: "#f0fdf4", color: "#166534", borderRadius: 0, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>#{tag}</span>
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
            style={{ marginTop: 8, alignSelf: "flex-start", padding: "5px 16px", background: "#f0fdf4", color: "#166534", border: "1.5px solid #bbf7d0", borderRadius: 0, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            アルバム
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
        style={{ borderRadius: 0, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer", position: "relative" }}>
        <div style={{ width: "100%", aspectRatio: "1/1", background: "#f3f4f6", position: "relative" }}>
          {cover
            ? <KitImage src={cover} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}><PhotoPlaceholderIcon size={32} /></div>}
          {photos.length > 1 && (
            <span style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 0 }}>{photos.length}枚</span>
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
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowSearch(v => !v)} title="検索">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowBackup(true)} title="バックアップ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              <path d="M12 8v8M8 12l4 4 4-4" />
            </svg>
          </button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30 }} onClick={() => setShowHelp(true)} title="ヘルプ">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.2 9.2a2.8 2.8 0 015.4 1c0 1.8-2.6 2.2-2.6 4" />
              <line x1="12" y1="17.5" x2="12" y2="17.51" />
            </svg>
          </button>
          <button style={{ ...s.shareBtn, width: 30, height: 30, fontSize: 13 }} onClick={() => setShowShare(true)} title="Xでシェア">𝕏</button>
          <button style={{ ...s.searchIconBtn, width: 30, height: 30, padding: 0, overflow: "hidden" }} onClick={() => setShowModelerAlbum(true)} title="モデラーズアルバム">
            <img src="/modelers-logo.jpg" alt="Modelers Album" style={{ width: 30, height: 30, objectFit: "cover", display: "block" }} />
          </button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "8px 16px", display: bulkMode ? "none" : "flex", alignItems: "center", gap: 6, flexWrap: "nowrap", overflowX: "auto" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: rank.color, background: rank.color + "18", borderRadius: 0, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>{rank.label}</span>
        <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap", flexShrink: 0 }}>登録数 {totalKits}</span>
        <a href="/tips/" target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: "auto", flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 0, padding: "3px 8px", textDecoration: "none", whiteSpace: "nowrap", lineHeight: 1.2 }}>
          プラモTIPS
        </a>
        <a href="/gears.html" target="_blank" rel="noopener noreferrer"
          style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#9a3412", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 0, padding: "2px 8px", textDecoration: "none", textAlign: "center", lineHeight: 1.15 }}>
          おすすめ<br/>定番アイテム
        </a>
      </div>

      {/* モデラーズアルバムの入口は完成まで非公開。再公開するときは下記ボタンを戻す：
      <button onClick={() => setShowModelerAlbum(true)}
        style={{ display: bulkMode ? "none" : "flex", alignItems: "center", justifyContent: "center", gap: 12, width: "100%", boxSizing: "border-box", padding: "11px 16px", background: "#111", color: "#fff", border: "none", cursor: "pointer", fontFamily: "'Helvetica Neue', 'Inter', 'Noto Sans JP', sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: "0.28em" }}>
        MODELERS ALBUM
        <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "#9ca3af", fontWeight: 600 }}>PORTFOLIO ›</span>
      </button>
      */}

      {showSearch && !bulkMode && (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "10px 16px" }}>
          <input autoFocus
            style={{ width: "100%", padding: "8px 12px", border: "1.5px solid #4f8ef7", borderRadius: 0, fontSize: 14, background: "#fafafa", outline: "none", boxSizing: "border-box" }}
            placeholder="キット名・シリーズで検索..."
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      )}

      {/* 塗料（マイパレット）の入口は完成まで非公開。公開時に下記セグメント切替を戻す：
      {!bulkMode && (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "8px 14px", display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", border: "1.5px solid #111", overflow: "hidden" }}>
            <button style={{ padding: "6px 18px", fontSize: 12, fontWeight: 800, border: "none", cursor: "pointer", background: "#111", color: "#fff" }}>キット</button>
            <button style={{ padding: "6px 18px", fontSize: 12, fontWeight: 800, border: "none", cursor: "pointer", background: "#fff", color: "#111" }} onClick={() => setShowPaints(true)}>🎨 塗料</button>
          </div>
        </div>
      )}
      */}

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
        const displayLabel = filter === "done" ? "完成品の総額" : filter === "all" ? "総計" : "積みプラ総額";
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
                style={{ fontSize: 10, padding: "2px 8px", border: "1px solid #e5e7eb", borderRadius: 0, background: showPriceTotal ? "#f0fdf4" : "#f3f4f6", color: showPriceTotal ? "#16a34a" : "#9ca3af", cursor: "pointer" }}
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
            <select style={{ padding: "3px 4px", borderRadius: 0, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterScale ? "#059669" : "#e5e7eb"}`, background: filterScale ? "#ecfdf5" : "#fafafa" }}
              value={filterScale} onChange={(e) => setFilterScale(e.target.value)}>
              <option value="">スケール</option>
              <option value="__unset__">未設定</option>
              {[...new Set(kits.map(k => k.scale).filter(Boolean))].sort().map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 0, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterSeries ? "#4f8ef7" : "#e5e7eb"}`, background: filterSeries ? "#eff6ff" : "#fafafa" }}
              value={filterSeries} onChange={(e) => setFilterSeries(e.target.value)}>
              <option value="">シリーズ</option>
              <option value="__unset__">未設定</option>
              {[...new Set(kits.map(k => (k.series || "").replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim()).filter(Boolean))].sort().map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 0, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterRating ? "#f59e0b" : "#e5e7eb"}`, background: filterRating ? "#fffbeb" : "#fafafa" }}
              value={filterRating} onChange={(e) => setFilterRating(e.target.value)}>
              <option value="">評価</option>
              <option value="5">★5</option>
              <option value="4">★4</option>
              <option value="3">★3</option>
              <option value="2">★2</option>
              <option value="1">★1</option>
            </select>
            <select style={{ padding: "3px 4px", borderRadius: 0, fontSize: 10, outline: "none", color: "#111", minWidth: 0, width: "100%", border: `1.5px solid ${filterCondition ? "#8b5cf6" : "#e5e7eb"}`, background: filterCondition ? "#f5f3ff" : "#fafafa" }}
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
                    style={{ background: active ? "#166534" : "#f0fdf4", color: active ? "#fff" : "#166534", border: `1.5px solid ${active ? "#166534" : "#bbf7d0"}`, borderRadius: 0, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
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

      {scanLoading && <div style={s.loadingBar}>商品情報を検索中...</div>}

      <div style={s.list}>
        {filtered.length === 0 && (
          <div style={s.empty}>
            {kits.length === 0
              ? <><div style={{ fontSize: 40, marginBottom: 12 }}></div><div>右下のボタンからキットを登録しよう</div></>
              : "該当するキットがありません"}
          </div>
        )}
        {filtered.length > 0 && !bulkMode && (
          <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 5, marginBottom: 4, overflowX: "auto", paddingBottom: 2 }}>
            <button style={{ fontSize: 11, padding: "4px 8px", border: `1.5px solid ${viewMode === "list" ? "#111" : "#e5e7eb"}`, borderRadius: 0, background: viewMode === "list" ? "#111" : "#fff", color: viewMode === "list" ? "#fff" : "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setViewMode("list")}>☰ 詳細</button>
            <button style={{ fontSize: 11, padding: "4px 8px", border: `1.5px solid ${viewMode === "grid" ? "#111" : "#e5e7eb"}`, borderRadius: 0, background: viewMode === "grid" ? "#111" : "#fff", color: viewMode === "grid" ? "#fff" : "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setViewMode("grid")}>⊞ サムネ</button>
            <select style={{ fontSize: 11, padding: "3px 6px", border: "1.5px solid #e5e7eb", borderRadius: 0, background: "#fff", color: "#6b7280", cursor: "pointer", flexShrink: 0 }}
              value={sortKey} onChange={(e) => { setSortKey(e.target.value); setReorderMode(false); }}>
              <option value="name">名前順</option>
              <option value="date">登録順</option>
              <option value="purchaseDate">購入日順</option>
            </select>
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #e5e7eb", borderRadius: 0, background: "#fff", color: "#6b7280", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}>
              {sortDir === "asc" ? "↑昇" : "↓降"}
            </button>
            {filtered.length > 1 && sortKey === "custom" && (
              <button style={{ fontSize: 11, padding: "3px 8px", border: `1.5px solid ${reorderMode ? "#4f8ef7" : "#e5e7eb"}`, borderRadius: 0, background: reorderMode ? "#eff6ff" : "#fff", color: reorderMode ? "#4f8ef7" : "#6b7280", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
                onClick={() => setReorderMode(v => !v)}>
                {reorderMode ? "✓完了" : "↕手動"}
              </button>
            )}
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #e5e7eb", borderRadius: 0, background: "#fff", color: "#6b7280", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => { setBulkMode(true); setBulkSelected(new Set()); }}>
              ☑ 一括
            </button>
            <button style={{ fontSize: 11, padding: "3px 8px", border: "1.5px solid #111", borderRadius: 0, background: "#111", color: "#fff", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}
              onClick={() => setShowTagEditor(true)}>
              タグ編集
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
            <button style={{ fontSize: 12, padding: "4px 12px", background: "#fff", color: "#111", border: "none", borderRadius: 0, fontWeight: 700, cursor: "pointer" }}
              onClick={() => { setBulkMode(false); setBulkSelected(new Set()); }}>✕ 解除</button>
          </div>
        )}
        {bulkMode && (() => {
          const allExistingTags = [...new Set([...tagMasterList, ...kits.flatMap(k => k.tags || [])])];
          return (
            <div style={{ background: "#fff", borderRadius: 0, marginBottom: 8, border: "1.5px solid #e5e7eb", overflow: "hidden" }}>
              {/* ヘッダー：件数・削除 */}
              <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <span style={{ fontSize: 12, color: "#6b7280", flex: 1 }}>{bulkSelected.size}件選択中</span>
                <button style={{ fontSize: 12, padding: "6px 12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 0, cursor: "pointer", fontWeight: 700 }}
                  onClick={handleBulkDelete}>削除</button>
              </div>
              {/* 状態 */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>状態を一括設定</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CONDITION_OPTIONS.map(opt => (
                    <button key={opt} onClick={() => handleBulkSetField("condition", opt)}
                      style={{ padding: "5px 12px", borderRadius: 0, border: "1.5px solid #e5e7eb", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "#f3f4f6", color: "#374151" }}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              {/* シリーズ */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>シリーズを一括設定</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 12, outline: "none", background: "#fafafa" }}
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
                  <select style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 12, outline: "none", background: "#fafafa" }}
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
                {bulkSelected.size === 0 && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6 }}>タグ名タップはキット選択後に有効になります</div>}
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
                  <input style={{ flex: 1, padding: "6px 10px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 12, outline: "none" }}
                    placeholder="新しいタグを入力..."
                    value={bulkTagInput}
                    onChange={(e) => setBulkTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { handleBulkAddTag(bulkTagInput); setBulkTagInput(""); } }}
                  />
                  <button style={{ padding: "6px 14px", background: "#111", color: "#fff", border: "none", borderRadius: 0, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
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
          <a href="/paint/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>塗料大全</a>
          <a href="/sell.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>積みを売る</a>
          <a href="/storage.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#9ca3af", textDecoration: "underline" }}>プラモを預ける</a>
        </div>
        <div style={{ fontSize: 10, color: "#cbd5e1" }}>© 2026 TSUMI TSUMI</div>
      </div>

      {/* バックグラウンド価格自動取得の通知トースト（総額が増えた理由の説明） */}
      {priceAutoToast && (
        <div style={{ position: "fixed", bottom: 92, left: "50%", transform: "translateX(-50%)", zIndex: 60, maxWidth: "92%", background: "#1e293b", color: "#fff", borderRadius: 0, padding: "10px 14px", fontSize: 12, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.28)", display: "flex", alignItems: "center", gap: 12 }}>
          <span>{priceAutoToast}</span>
          <span onClick={() => setPriceAutoToast(null)} style={{ cursor: "pointer", opacity: 0.7, flexShrink: 0 }}>✕</span>
        </div>
      )}

      {/* フロート式「プラモを預ける」リンク。トップから移動して左下に常駐させる。
          z-index は右下の FAB（50）より下げて、スキャン/手動登録の操作を邪魔しないようにする。 */}
      <a href="/storage.html" target="_blank" rel="noopener noreferrer"
        style={{ position: "fixed", bottom: 24, left: 16, zIndex: 40, fontSize: 11, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 0, padding: "6px 12px", textDecoration: "none", whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
        プラモを預ける
      </a>

      <div style={{ position: "fixed", bottom: 24, right: 20, display: "flex", flexDirection: "column", gap: 12, zIndex: 50, alignItems: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <span style={{ background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, padding: "4px 10px", borderRadius: 20 }}>スキャン登録</span>
            <button
              style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", fontSize: 10, padding: "2px 8px", borderRadius: 20, cursor: "pointer" }}
              onClick={() => { setContinuousScan(v => !v); }}>
              {continuousScan ? "連続ON" : "1回のみ"}
            </button>
          </div>
          <button style={{ ...s.fab, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowScanner(true)} title="バーコードでスキャン登録">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
              <line x1="7" y1="12" x2="17" y2="12" />
            </svg>
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
                  情報の誤りを報告
                </button>
              </div>
              {detail.tags?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>タグ</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {detail.tags.map(tag => (
                      <span key={tag} style={{ background: "#f0fdf4", color: "#166534", borderRadius: 0, padding: "3px 10px", fontSize: 12, fontWeight: 600 }}>#{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {!detail.completed && (
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button style={{ ...s.wantBtn, marginTop: 0, width: "auto", flex: 1 }} onClick={() => handleWant(detail)}>
                    これを作ってくれる人に譲りたい！とポストする
                  </button>
                  <a href="/sell.html" target="_blank" rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      padding: "12px 8px",
                      background: "#ecfdf5",
                      color: "#059669",
                      border: "1.5px solid #a7f3d0",
                      borderRadius: 0,
                      fontSize: 13,
                      fontWeight: 700,
                      textAlign: "center",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                    積みを売る
                  </a>
                </div>
              )}
              {/* 完成品：Amazon送客の代わりに「完成品をシェア」を表示 */}
              {detail.completed && (
                <div style={{ marginTop: 10 }}>
                  <button
                    onClick={() => { setDetail(null); setShareKit(detail); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "11px", background: "#000", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    この完成品をXでシェア
                  </button>
                </div>
              )}
              {/* Amazonアソシエイト（未完成のみ）：JAN または商品名で Amazon 検索へ送客。
                  譲る・売るの下に小さめサイズで配置（控えめなセカンダリ動線）。完成品には出さない。 */}
              {!detail.completed && makeAmazonAffUrl(detail) && (
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
                      borderRadius: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      textDecoration: "none",
                    }}>
                    Amazonで関連商品を見る
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
          <div style={{ background: "#fff", borderRadius: 0, width: "100%", maxWidth: 360, padding: 20, boxShadow: "0 10px 40px rgba(0,0,0,0.3)", boxSizing: "border-box" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", marginBottom: 10 }}>
              このJANは既に{dupConfirm.where}です
            </div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16, padding: "10px 12px", background: "#f9fafb", borderRadius: 0, lineHeight: 1.5, wordBreak: "break-all" }}>
              「{dupConfirm.kit?.name || dupConfirm.kit?.jan || "（名称なし）"}」
            </div>
            <div style={{ fontSize: 13, color: "#374151", marginBottom: 16 }}>
              それでも追加しますか？
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                style={{ flex: 1, padding: "12px 0", background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => resolveDup(false)}>
                キャンセル
              </button>
              <button
                style={{ flex: 1, padding: "12px 0", background: "#ef4444", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
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
                  スキャン済み {continuousQueue.length}件
                </div>
                <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                  {continuousQueue.map((k, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151" }}>
                      {(k.completedPhotoUrl || k.photoUrl) && <KitImage src={k.completedPhotoUrl || k.photoUrl} style={{ width: 30, height: 30, borderRadius: 0, objectFit: "cover" }} />}
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name || k.jan}</span>
                      <button style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}
                        onClick={() => setContinuousQueue(q => q.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <button style={{ width: "100%", padding: "10px 0", background: "#22c55e", color: "#fff", border: "none", borderRadius: 0, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
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

      {showModelerAlbum && (
        <ModelerAlbum
          onClose={() => setShowModelerAlbum(false)}
          tagMasterList={tagMasterList}
          setTagMasterList={setTagMasterList}
          kits={kits}
          setKits={setKits} />
      )}

      {showPaints && <PaintStock onClose={() => setShowPaints(false)} />}

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
                  style={{ padding: "6px 14px", borderRadius: 0, border: "1.5px solid", fontSize: 13, fontWeight: 600, cursor: "pointer",
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
              <option value="__custom__">自由入力...</option>
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
                  style={{ padding: "8px 12px", background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 0, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
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
                  自動取得
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
                  この価格・情報の誤りを報告
                </button>
              </div>
            )}

            <label style={s.label}>スケール</label>
            <select style={s.input}
              value={SCALE_OPTIONS.includes(form.scale) ? form.scale : form.scale ? "__custom__" : ""}
              onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value === "__custom__" ? "" : e.target.value }))}>
              <option value="">選択してください</option>
              {SCALE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              <option value="__custom__">自由入力...</option>
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
              <button style={{ width: 36, height: 36, borderRadius: 0, border: "1.5px solid #e5e7eb", background: "#f3f4f6", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setForm((f) => ({ ...f, count: Math.max(1, (f.count || 1) - 1) }))}>−</button>
              <span style={{ fontSize: 18, fontWeight: 700, minWidth: 32, textAlign: "center" }}>{form.count || 1}</span>
              <button style={{ width: 36, height: 36, borderRadius: 0, border: "1.5px solid #e5e7eb", background: "#f3f4f6", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                onClick={() => setForm((f) => ({ ...f, count: (f.count || 1) + 1 }))}>＋</button>
            </div>

            <label style={s.label}>箱の写真</label>
            <div style={{ position: "relative" }}>
              <div style={s.photoArea} onClick={() => fileRef.current.click()}>
                {form.photoUrl ? <KitImage src={form.photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 0 }} />
                  : <span style={{ color: "#9ca3af", fontSize: 14 }}>タップして写真を選択</span>}
              </div>
              {form.photoUrl && (
                <button style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 0, width: 28, height: 28, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
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
                    <div key={i} style={{ position: "relative", width: 88, height: 88, borderRadius: 0, overflow: "hidden", border: `1.5px solid ${i === 0 ? "#22c55e" : "#e5e7eb"}` }}>
                      <KitImage src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      {i === 0 && <span style={{ position: "absolute", left: 0, bottom: 0, background: "#22c55e", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderTopRightRadius: 6 }}>表紙</span>}
                      <button type="button" style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: 0, width: 22, height: 22, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        onClick={(e) => { e.stopPropagation(); removeCompletedPhoto(i); }}>✕</button>
                    </div>
                  ))}
                  {photos.length < MAX_COMPLETED_PHOTOS && (
                    <div onClick={() => completedFileRef.current.click()}
                      style={{ width: 88, height: 88, borderRadius: 0, border: "1.5px dashed #d1d5db", background: "#fafafa", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 11, cursor: "pointer", textAlign: "center", lineHeight: 1.4 }}>
                      <span style={{ fontSize: 22 }}></span>追加<br/>{photos.length}/{MAX_COMPLETED_PHOTOS}
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
                style={{ padding: "8px 10px", background: "#f3f4f6", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
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
                マスタ照合
              </button>
            </div>

            <label style={s.label}>メモ</label>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical" }} placeholder="自由にメモを残そう" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />

            {/* 編集時のみ：このキットを削除（積みプラ・完成品とも編集の中に集約） */}
            {editId !== null && (
              <button style={{ width: "100%", marginTop: 18, padding: "11px 0", background: "#fff", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: 0, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                onClick={() => setConfirmDelete({ id: editId, name: form.name })}>
                このキットを削除
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

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setConfirmDelete(null)}>
          <div style={{ background: "#fff", borderRadius: 0, width: "100%", maxWidth: 340, padding: "24px 20px 18px", boxSizing: "border-box", boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111", textAlign: "center", marginBottom: 8 }}>本当に削除しますか？</div>
            <div style={{ fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 1.6, marginBottom: 20 }}>
              「{confirmDelete.name || "このキット"}」を削除します。<br />この操作は元に戻せません。
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ flex: 1, padding: "12px 0", background: "#f3f4f6", color: "#111", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => setConfirmDelete(null)}>
                いいえ
              </button>
              <button style={{ flex: 1, padding: "12px 0", background: "#ef4444", color: "#fff", border: "none", borderRadius: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" }}
                onClick={() => { handleDelete(confirmDelete.id); setForm(makeEmptyForm()); setEditId(null); setShowForm(false); setConfirmDelete(null); }}>
                はい、削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ====== 塗料ストック（マイパレット）======
// キット管理と同じ発想で「持っている塗料」を端末内（localStorage）で管理する独立機能。
// 既存のキット一覧ロジックには一切触れず、上部セグメントから全画面で開く（ModelerAlbum と同じ安全パターン）。
const PAINT_LS_KEY = "tsumitsumi_paints";
const PAINT_BRANDS = ["GSIクレオス Mr.カラー", "GSIクレオス 水性ホビーカラー", "Mr.カラー GX", "ガイアカラー", "ガイア 水性", "タミヤ ラッカー(LP)", "タミヤ アクリル", "タミヤ エナメル", "フィニッシャーズ", "Vallejo", "シタデルカラー", "その他"];
const PAINT_TYPES = ["ラッカー", "水性アクリル", "エナメル", "その他"];
const PAINT_FINISHES = ["光沢", "半光沢", "つや消し", "メタリック", "クリア", "サーフェイサー", "その他"];
const PAINT_REMAIN = ["なし", "少ない", "半分", "多い", "新品"]; // index 0..4
function makePaintId() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function PaintStock({ onClose }) {
  const [paints, setPaints] = useState([]);
  const [editing, setEditing] = useState(null); // 編集/追加中の塗料 or null
  const [q, setQ] = useState("");
  const [fBrand, setFBrand] = useState("");
  const [fType, setFType] = useState("");
  const [fCat, setFCat] = useState(""); // "" | "塗料" | "トップコート"
  const [onlyLow, setOnlyLow] = useState(false);
  const [scanning, setScanning] = useState(false); // バーコードスキャナ表示
  const [looking, setLooking] = useState(false); // JAN→商品情報の取得中
  const loaded = useRef(false);

  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(PAINT_LS_KEY) || "[]"); if (Array.isArray(v)) setPaints(v); } catch (e) {}
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return; // 初回マウントの保存スキップ（既存データの空上書き防止）
    try { localStorage.setItem(PAINT_LS_KEY, JSON.stringify(paints)); } catch (e) {}
  }, [paints]);

  const blank = () => ({ id: makePaintId(), category: "塗料", jan: "", brand: PAINT_BRANDS[0], name: "", code: "", type: PAINT_TYPES[0], finish: PAINT_FINISHES[0], swatch: "#9aa0a6", remain: 4, count: 1, purchaseDate: "", amazonUrl: "", memo: "", createdAt: Date.now() });
  const AMZ_TAG = "tsumitsumi232-22";
  const amazonSearchUrl = (p) => `https://www.amazon.co.jp/s?k=${encodeURIComponent([p.brand, p.code, p.name].filter(Boolean).join(" "))}&tag=${AMZ_TAG}`;

  // 商品名からメーカー/種類を推測（Yahoo検索結果の補助。確実ではないので後から手で直せる）
  const guessBrand = (name) => {
    const n = name || "";
    if (/水性\s*ホビー/.test(n)) return "GSIクレオス 水性ホビーカラー";
    if (/(Mr\.?\s*カラー|クレオス|GSI).*GX|GX\s*メタル|スーパーメタリック/i.test(n)) return "Mr.カラー GX";
    if (/Mr\.?\s*カラー|クレオス|GSI|ガンダムカラー/i.test(n)) return "GSIクレオス Mr.カラー";
    if (/ガイア.*水性|水性.*ガイア/.test(n)) return "ガイア 水性";
    if (/ガイア|GAIA/i.test(n)) return "ガイアカラー";
    if (/タミヤ|TAMIYA/i.test(n)) { if (/エナメル/.test(n)) return "タミヤ エナメル"; if (/LP-?\d|ラッカー/.test(n)) return "タミヤ ラッカー(LP)"; return "タミヤ アクリル"; }
    if (/フィニッシャーズ|Finisher/i.test(n)) return "フィニッシャーズ";
    if (/vallejo|ファレホ/i.test(n)) return "Vallejo";
    if (/citadel|シタデル/i.test(n)) return "シタデルカラー";
    return "その他";
  };
  const typeOfBrand = (brand) => {
    if (/水性|アクリル|Vallejo|シタデル/.test(brand)) return "水性アクリル";
    if (/エナメル/.test(brand)) return "エナメル";
    if (/Mr\.|GX|ガイア|ラッカー|フィニッシャーズ/.test(brand)) return "ラッカー";
    return PAINT_TYPES[0];
  };
  // JANで商品情報を取得（キット登録と同じ /api/search を流用：マスタ→Rakuten→Yahoo の順で名前/画像を返す）
  const lookupJan = async (jan, base) => {
    setLooking(true);
    try {
      const r = await fetch(`/api/search?jan=${encodeURIComponent(jan)}`);
      const d = r.ok ? await r.json() : null;
      if (d && d.name) {
        const brand = guessBrand(d.name);
        return { ...(base || blank()), jan, name: d.name, brand, type: typeOfBrand(brand) };
      }
      return null;
    } catch (e) { return null; }
    finally { setLooking(false); }
  };
  // スキャナでJAN検出 → 商品情報を引いてフォームを開く（編集中ならその下書きに上書き、無ければ新規）
  const onScanDetected = async (code) => {
    setScanning(false);
    const jan = String(code || "").replace(/[^0-9]/g, "");
    if (!jan) return;
    const base = editing || blank();
    const filled = await lookupJan(jan, base);
    if (filled) setEditing(filled);
    else { alert("商品情報が見つかりませんでした。JANを保存したので、色名などは手入力してください。"); setEditing({ ...base, jan }); }
  };
  const scannerOverlay = scanning && (
    <div style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", justifyContent: "center" }} onClick={() => setScanning(false)}>
      <div onClick={(ev) => ev.stopPropagation()} style={{ width: "100%", maxWidth: 480 }}>
        <BarcodeScanner onDetected={onScanDetected} onClose={() => setScanning(false)} />
      </div>
    </div>
  );
  const lookingOverlay = looking && (
    <div style={{ position: "fixed", inset: 0, zIndex: 410, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>商品情報を取得中…</div>
  );

  const save = () => {
    if (!editing) return;
    const d = { ...editing, name: (editing.name || "").trim(), code: (editing.code || "").trim() };
    if (!d.name && !d.code) { alert("色名または色番号のどちらかを入力してください。"); return; }
    setPaints(prev => prev.some(x => x.id === d.id) ? prev.map(x => x.id === d.id ? d : x) : [d, ...prev]);
    setEditing(null);
  };
  const remove = (id) => { if (!window.confirm("この塗料を削除しますか？")) return; setPaints(prev => prev.filter(x => x.id !== id)); setEditing(null); };
  const upd = (patch) => setEditing(e => ({ ...e, ...patch }));

  const filtered = paints.filter(p => {
    if (fCat && (p.category || "塗料") !== fCat) return false;
    if (onlyLow && (p.remain ?? 4) > 1) return false;
    if (fBrand && p.brand !== fBrand) return false;
    if (fType && p.type !== fType) return false;
    if (q) { const hay = `${p.name} ${p.code} ${p.brand} ${p.finish}`.toLowerCase(); if (!hay.includes(q.toLowerCase())) return false; }
    return true;
  });

  const ps = {
    wrap: { position: "fixed", inset: 0, zIndex: 300, background: "#f6f7f8", color: "#111", display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', Meiryo, sans-serif" },
    bar: { background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 },
    seg: { display: "flex", border: "1.5px solid #111", borderRadius: 0, overflow: "hidden", flexShrink: 0 },
    segBtn: (on) => ({ padding: "6px 14px", fontSize: 12, fontWeight: 800, border: "none", cursor: "pointer", background: on ? "#111" : "#fff", color: on ? "#fff" : "#111" }),
    body: { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "10px 14px 90px" },
    row: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 0, padding: "10px 12px", display: "flex", alignItems: "center", gap: 11, marginBottom: 8, cursor: "pointer" },
    swatch: (c) => ({ width: 40, height: 40, flexShrink: 0, background: c || "#ccc", border: "1px solid rgba(0,0,0,0.18)" }),
    tag: { display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 7px", border: "1px solid #d1d5db", color: "#4b5563", marginRight: 4 },
    label: { display: "block", fontSize: 11, fontWeight: 700, color: "#6b7280", margin: "12px 0 4px" },
    input: { width: "100%", boxSizing: "border-box", border: "1px solid #d1d5db", borderRadius: 0, padding: "8px 10px", fontSize: 15, outline: "none", background: "#fff" },
    fab: { position: "fixed", right: 18, bottom: 22, height: 50, padding: "0 18px", borderRadius: 0, background: "#111", color: "#fff", border: "none", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.25)", zIndex: 2 },
    black: { background: "#111", color: "#fff", border: "1px solid #111", padding: "11px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer", borderRadius: 0 },
    ghost: { background: "#fff", color: "#111", border: "1px solid #111", padding: "11px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", borderRadius: 0 },
  };

  const RemainBar = ({ v }) => (
    <span style={{ display: "inline-flex", gap: 2, verticalAlign: "middle" }}>
      {[0, 1, 2, 3].map(i => (
        <span key={i} style={{ width: 7, height: 12, background: i < (v ?? 4) ? (v <= 1 ? "#ef4444" : v === 2 ? "#f59e0b" : "#22c55e") : "#e5e7eb" }} />
      ))}
    </span>
  );

  // ---- 追加/編集フォーム ----
  if (editing) {
    const e = editing;
    return (
      <div style={ps.wrap}>
        <div style={ps.bar}>
          <button style={ps.ghost} onClick={() => setEditing(null)}>キャンセル</button>
          <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800 }}>{paints.some(x => x.id === e.id) ? "塗料を編集" : "塗料を追加"}</div>
          <button style={ps.black} onClick={save}>保存</button>
        </div>
        <div style={ps.body}>
          <label style={{ ...ps.label, marginTop: 0 }}>種別</label>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            {["塗料", "トップコート"].map(c => (
              <button key={c} onClick={() => upd({ category: c })}
                style={{ flex: 1, padding: "8px 0", fontSize: 12, fontWeight: 700, border: "1px solid #111", borderRadius: 0, cursor: "pointer", background: (e.category || "塗料") === c ? "#111" : "#fff", color: (e.category || "塗料") === c ? "#fff" : "#111" }}>{c}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#fff", border: "1px solid #e5e7eb", padding: 12 }}>
            <div style={ps.swatch(e.swatch)} />
            <div style={{ flex: 1 }}>
              <label style={{ ...ps.label, margin: "0 0 4px" }}>色（カラーピッカー）</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="color" value={e.swatch} onChange={ev => upd({ swatch: ev.target.value })} style={{ width: 46, height: 34, border: "1px solid #d1d5db", background: "#fff", padding: 0, cursor: "pointer" }} />
                <input style={{ ...ps.input, width: 110, flex: "none" }} value={e.swatch} onChange={ev => upd({ swatch: ev.target.value })} />
              </div>
            </div>
          </div>

          <label style={ps.label}>JANコード（任意・スキャンや手入力から商品名を取得）</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...ps.input, flex: 1 }} inputMode="numeric" value={e.jan || ""} onChange={ev => upd({ jan: ev.target.value.replace(/[^0-9]/g, "") })} placeholder="例：4973028000000" />
            <button style={{ ...ps.ghost, whiteSpace: "nowrap" }} disabled={looking || !(e.jan && e.jan.length >= 8)}
              onClick={async () => { const f = await lookupJan(e.jan, e); if (f) setEditing(f); else alert("商品情報が見つかりませんでした。"); }}>
              {looking ? "取得中…" : "商品名を取得"}
            </button>
            <button style={{ ...ps.ghost, whiteSpace: "nowrap" }} onClick={() => setScanning(true)}>📷</button>
          </div>

          <label style={ps.label}>メーカー / シリーズ</label>
          <select style={ps.input} value={e.brand} onChange={ev => upd({ brand: ev.target.value })}>
            {PAINT_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={ps.label}>色名</label>
              <input style={ps.input} value={e.name} onChange={ev => upd({ name: ev.target.value })} placeholder="例：ニュートラルグレー" />
            </div>
            <div style={{ width: 120 }}>
              <label style={ps.label}>色番号</label>
              <input style={ps.input} value={e.code} onChange={ev => upd({ code: ev.target.value })} placeholder="例：13" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={ps.label}>種類</label>
              <select style={ps.input} value={e.type} onChange={ev => upd({ type: ev.target.value })}>
                {PAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={ps.label}>仕上げ</label>
              <select style={ps.input} value={e.finish} onChange={ev => upd({ finish: ev.target.value })}>
                {PAINT_FINISHES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>

          <label style={ps.label}>残量</label>
          <div style={{ display: "flex", gap: 6 }}>
            {PAINT_REMAIN.map((r, i) => (
              <button key={i} onClick={() => upd({ remain: i })}
                style={{ flex: 1, padding: "8px 0", fontSize: 11, fontWeight: 700, border: "1px solid #111", borderRadius: 0, cursor: "pointer", background: e.remain === i ? "#111" : "#fff", color: e.remain === i ? "#fff" : "#111" }}>{r}</button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 110 }}>
              <label style={ps.label}>所持数</label>
              <input type="number" min="1" style={ps.input} value={e.count} onChange={ev => upd({ count: Math.max(1, parseInt(ev.target.value) || 1) })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={ps.label}>購入日</label>
              <input type="date" style={ps.input} value={e.purchaseDate || ""} onChange={ev => upd({ purchaseDate: ev.target.value })} />
            </div>
          </div>

          <label style={ps.label}>Amazonリンク（任意・再購入用の直リンク）</label>
          <input style={ps.input} value={e.amazonUrl || ""} onChange={ev => upd({ amazonUrl: ev.target.value })} placeholder="https://www.amazon.co.jp/dp/..." />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button style={{ ...ps.ghost, flex: 1 }} onClick={() => upd({ amazonUrl: amazonSearchUrl(e) })}>商品名で検索リンクを作成</button>
            {e.amazonUrl && <a href={e.amazonUrl} target="_blank" rel="noopener noreferrer" style={{ ...ps.black, flex: 1, textAlign: "center", textDecoration: "none" }}>🛒 リンクを開く</a>}
          </div>

          <label style={ps.label}>メモ（調色レシピ・使い道など）</label>
          <textarea style={{ ...ps.input, minHeight: 70, resize: "vertical" }} value={e.memo} onChange={ev => upd({ memo: ev.target.value })} placeholder="例：本体色のベース。○○と1:1で調色。" />

          {paints.some(x => x.id === e.id) && (
            <button onClick={() => remove(e.id)} style={{ ...ps.ghost, borderColor: "#c00", color: "#c00", width: "100%", marginTop: 22 }}>この塗料を削除</button>
          )}
        </div>
        {scannerOverlay}
        {lookingOverlay}
      </div>
    );
  }

  // ---- 一覧 ----
  const brandsInUse = [...new Set(paints.map(p => p.brand))];
  return (
    <div style={ps.wrap}>
      <div style={ps.bar}>
        <div style={ps.seg}>
          <button style={ps.segBtn(false)} onClick={onClose}>キット</button>
          <button style={ps.segBtn(true)}>🎨 塗料</button>
        </div>
        <div style={{ flex: 1, textAlign: "right", fontSize: 11, color: "#6b7280" }}>所持 {paints.length} 色 / {paints.reduce((a, p) => a + (p.count || 1), 0)} 本</div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "8px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["", "塗料", "トップコート"].map(c => (
            <button key={c || "all"} onClick={() => setFCat(c)}
              style={{ flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700, border: "1px solid #111", borderRadius: 0, cursor: "pointer", background: fCat === c ? "#111" : "#fff", color: fCat === c ? "#fff" : "#111" }}>{c || "すべて"}</button>
          ))}
        </div>
        <input style={ps.input} value={q} onChange={ev => setQ(ev.target.value)} placeholder="色名・番号・メーカーで検索…" />
        <div style={{ display: "flex", gap: 6 }}>
          <select style={{ ...ps.input, fontSize: 12, padding: "6px 8px" }} value={fBrand} onChange={ev => setFBrand(ev.target.value)}>
            <option value="">全メーカー</option>
            {brandsInUse.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select style={{ ...ps.input, fontSize: 12, padding: "6px 8px" }} value={fType} onChange={ev => setFType(ev.target.value)}>
            <option value="">全種類</option>
            {PAINT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={() => setOnlyLow(v => !v)} style={{ flexShrink: 0, padding: "0 12px", fontSize: 11, fontWeight: 700, border: "1px solid #111", borderRadius: 0, cursor: "pointer", background: onlyLow ? "#ef4444" : "#fff", color: onlyLow ? "#fff" : "#111" }}>要補充</button>
        </div>
      </div>

      <div style={ps.body}>
        {paints.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px 20px", fontSize: 13, lineHeight: 1.9 }}>
            まだ塗料が登録されていません。<br />右下の「＋ 塗料を追加」から、手持ちの塗料を登録しましょう。
          </div>
        )}
        {paints.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px 20px", fontSize: 13 }}>条件に合う塗料がありません。</div>
        )}
        {filtered.map(p => (
          <div key={p.id} style={ps.row} onClick={() => setEditing({ ...p })}>
            <div style={ps.swatch(p.swatch)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{p.brand}{p.code ? ` ・ No.${p.code}` : ""}</div>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "（色名なし）"}</div>
              <div style={{ marginTop: 3 }}>
                {(p.category === "トップコート") && <span style={{ ...ps.tag, borderColor: "#111", color: "#111", fontWeight: 800 }}>トップコート</span>}
                <span style={ps.tag}>{p.type}</span><span style={ps.tag}>{p.finish}</span>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <RemainBar v={p.remain} />
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{PAINT_REMAIN[p.remain ?? 4]} ×{p.count || 1}</div>
            </div>
            {p.amazonUrl && (
              <a href={p.amazonUrl} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} title="Amazonで見る"
                style={{ flexShrink: 0, marginLeft: 8, width: 34, height: 34, border: "1px solid #111", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, textDecoration: "none" }}>🛒</a>
            )}
          </div>
        ))}
      </div>

      <div style={{ position: "fixed", right: 18, bottom: 22, display: "flex", gap: 8, zIndex: 2 }}>
        <button style={{ ...ps.fab, position: "static", background: "#fff", color: "#111", border: "1.5px solid #111" }} onClick={() => setScanning(true)}>📷 バーコード</button>
        <button style={{ ...ps.fab, position: "static" }} onClick={() => setEditing(blank())}>＋ 追加</button>
      </div>

      {scannerOverlay}
      {lookingOverlay}
    </div>
  );
}

const s = {
  root: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f8f9fa", fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", paddingBottom: 120 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 14px", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#111", letterSpacing: 1 },
  headerSub: { fontSize: 8, color: "#aaa", letterSpacing: 2, marginTop: 1 },
  shareBtn: { background: "#000", color: "#fff", border: "none", borderRadius: 0, padding: "8px 12px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  searchIconBtn: { background: "#f3f4f6", border: "none", borderRadius: 0, padding: 0, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
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
  card: { background: "#fff", borderRadius: 0, padding: "14px 12px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer" },
  thumb: { width: 56, height: 56, borderRadius: 0, objectFit: "cover", flexShrink: 0 },
  thumbPh: { width: 56, height: 56, borderRadius: 0, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 13, fontWeight: 700, color: "#111", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.4 },
  cardMeta: { fontSize: 12, color: "#6b7280", marginTop: 3, display: "flex", gap: 6, alignItems: "center" },
  badge: { background: "#f3f4f6", borderRadius: 0, padding: "1px 6px", fontSize: 11, color: "#374151" },
  cardBottom: { display: "flex", gap: 8, marginTop: 6, alignItems: "center" },
  stars: { fontSize: 13, color: "#f59e0b", letterSpacing: 1 },
  countBadge: { fontSize: 11, background: "#f3f4f6", color: "#374151", borderRadius: 0, padding: "2px 8px", fontWeight: 600 },
  condBadge: { fontSize: 10, borderRadius: 0, padding: "2px 8px", fontWeight: 600 },
  checkBtn: { width: 32, height: 32, borderRadius: 0, border: "none", fontSize: 15, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  fab: { width: 56, height: 56, borderRadius: "50%", color: "#fff", border: "none", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.25)" },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  modal: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
  modalPhoto: { width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 0 },
  modalBody: { padding: "20px 20px 32px" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#111", marginBottom: 6 },
  doneBadge: { display: "inline-block", background: "#f0fdf4", color: "#166534", borderRadius: 0, padding: "2px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  td1: { padding: "6px 0", fontSize: 12, color: "#9ca3af", width: 80, verticalAlign: "top" },
  td2: { padding: "6px 0", fontSize: 14, color: "#111" },
  wantBtn: { width: "100%", marginTop: 16, padding: "12px 0", background: "#fff0f3", color: "#e11d48", border: "1.5px solid #fecdd3", borderRadius: 0, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  modalBtns: { display: "flex", gap: 8, marginTop: 12 },
  editBtn: { flex: 1, padding: "10px 0", background: "#f3f4f6", border: "none", borderRadius: 0, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#111" },
  deleteBtn: { flex: 1, padding: "10px 0", background: "#fee2e2", border: "none", borderRadius: 0, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#b91c1c" },
  closeBtn: { flex: 1, padding: "10px 0", background: "#111", border: "none", borderRadius: 0, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#fff" },
  formModal: { background: "#fff", borderRadius: 0, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", padding: "24px 20px 40px", boxSizing: "border-box" },
  formTitle: { fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 20 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6, marginTop: 14 },
  input: { width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 0, fontSize: 14, color: "#111", background: "#fafafa", boxSizing: "border-box", outline: "none" },
  photoArea: { width: "100%", height: 120, border: "1.5px dashed #d1d5db", borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", marginTop: 2 },
  formBtns: { display: "flex", gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, padding: "12px 0", background: "#f3f4f6", border: "none", borderRadius: 0, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#374151" },
  saveBtn: { flex: 2, padding: "12px 0", background: "#111", border: "none", borderRadius: 0, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#fff" },
};
