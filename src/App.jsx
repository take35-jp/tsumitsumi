import { useState, useRef, useEffect } from "react";

const SERIES_OPTIONS = [
  // バンダイ - ガンプラ
  "ガンプラ（HG）", "ガンプラ（MG）", "ガンプラ（RG）", "ガンプラ（PG）", "ガンプラ（SD）", "ガンプラ（EG）",
  // バンダイ - その他
  "ポケプラ",
  "Figure-rise Standard", "Figure-rise Bust", "Figure-rise Mechanics",
  "30 Minutes Sisters", "30 Minutes Missions",
  // コトブキヤ
  "フレームアームズ", "フレームアームズ・ガール", "ヘキサギア",
  "メガミデバイス", "アーマーガールズプロジェクト",
  // グッドスマイルカンパニー
  "MODEROID", "PLAMATE",
  // ボークス
  "FSS（ファイブスター物語）", "ドルフィードリーム",
  // タミヤ
  "タミヤ（戦車）", "タミヤ（飛行機）", "タミヤ（艦船）", "タミヤ（車）", "タミヤ（バイク）", "タミヤ（フィギュア）", "タミヤ（SF・キャラ）",
  "ミニ四駆",
  // ハセガワ
  "ハセガワ（飛行機）", "ハセガワ（艦船）", "ハセガワ（車）", "ハセガワ（キャラ）",
  // フジミ
  "フジミ（艦船）", "フジミ（車）", "フジミ（飛行機）",
  // アオシマ
  "アオシマ（艦船）", "アオシマ（車）", "アオシマ（バイク）",
  // その他メーカー
  "ピットロード", "ファインモールド", "ドラゴン", "トランペッター",
  // ガレージキット・その他
  "ガレージキット", "レジンキット", "その他",
];
const SCALE_OPTIONS = ["1/144", "1/100", "1/60", "MG", "HG", "RG", "PG", "その他"];


function formatDate(str) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${y}/${m}/${d}`;
}
function formatPrice(n) {
  if (!n && n !== 0) return "—";
  return `¥${Number(n).toLocaleString()}`;
}

const emptyForm = {
  name: "", series: "", scale: "", purchaseDate: "", price: "",
  count: 1, rating: 0, photo: null, photoUrl: "", completed: false, memo: "", jan: "",
};

function guessSeriesFromName(name) {
  // ガンダム以外のシリーズ
  if (/MODEROID/i.test(name)) return "MODEROID";
  if (/フレームアームズ・ガール|FA:G/i.test(name)) return "フレームアームズ・ガール";
  if (/フレームアームズ|Frame Arms/i.test(name)) return "フレームアームズ";
  if (/ヘキサギア|Hexa Gear/i.test(name)) return "ヘキサギア";
  if (/メガミデバイス/i.test(name)) return "メガミデバイス";
  if (/30MS|30 Minutes Sisters/i.test(name)) return "30 Minutes Sisters";
  if (/30MM|30 Minutes Missions/i.test(name)) return "30 Minutes Missions";
  if (/Figure-rise/i.test(name)) return "Figure-rise Standard";
  if (/ポケモン|ポケプラ|Pokemon/i.test(name)) return "ポケプラ";
  if (/ミニ四駆/i.test(name)) return "ミニ四駆";
  // ガンプラ系はグレードで分類
  if (/\bPG\b/i.test(name)) return "ガンプラ（PG）";
  if (/\bMG\b/i.test(name)) return "ガンプラ（MG）";
  if (/\bRG\b/i.test(name)) return "ガンプラ（RG）";
  if (/\bEG\b/i.test(name)) return "ガンプラ（EG）";
  if (/\bSD\b/i.test(name)) return "ガンプラ（SD）";
  if (/\bHG\b|ガンダム|Gundam/i.test(name)) return "ガンプラ（HG）";
  return "";
}
function guessScaleFromName(name) {
  if (/\bPG\b/i.test(name)) return "PG";
  if (/\bMG\b/i.test(name)) return "MG";
  if (/\bRG\b/i.test(name)) return "RG";
  if (/\bHG\b/i.test(name)) return "HG";
  if (/1\/60/i.test(name)) return "1/60";
  if (/1\/100/i.test(name)) return "1/100";
  if (/1\/144/i.test(name)) return "1/144";
  return "";
}

async function fetchProductByJAN(jan) {
  // Vercelサーバーレス関数経由で楽天APIを叩く
  try {
    const res = await fetch(`/api/search?jan=${jan}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.name) {
        return {
          name: data.name,
          photoUrl: data.photoUrl || "",
          price: data.price || "",
          series: guessSeriesFromName(data.name),
          scale: guessScaleFromName(data.name),
        };
      }
    }
  } catch (_) {}
  return null;
}

// ---- Barcode Scanner ----
function BarcodeScanner({ onDetected, onClose }) {
  const scannerRef = useRef();
  const detectedRef = useRef(false);
  const [status, setStatus] = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const loadQuagga = () => new Promise((resolve, reject) => {
      if (window.Quagga) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/quagga/0.12.1/quagga.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });

    const init = async () => {
      await loadQuagga();
      window.Quagga.init({
        inputStream: {
          name: "Live",
          type: "LiveStream",
          target: scannerRef.current,
          constraints: { facingMode: "environment" },
        },
        decoder: {
          readers: ["ean_reader", "ean_8_reader", "code_128_reader"],
        },
        locate: true,
      }, (err) => {
        if (err) {
          setStatus("error");
          setErrorMsg(err?.name === "NotAllowedError"
            ? "カメラへのアクセスが拒否されました。\nブラウザの設定でカメラを許可してください。"
            : "カメラを起動できませんでした。\n手動でJANコードを入力してください。");
          return;
        }
        window.Quagga.start();
        setStatus("scanning");
      });

      window.Quagga.onDetected((result) => {
        if (detectedRef.current) return;
        const code = result?.codeResult?.code;
        if (code) {
          detectedRef.current = true;
          window.Quagga.stop();
          onDetected(code);
        }
      });
    };

    init().catch(() => {
      setStatus("error");
      setErrorMsg("カメラを起動できませんでした。\n手動でJANコードを入力してください。");
    });

    return () => {
      if (window.Quagga) {
        try { window.Quagga.stop(); } catch (_) {}
      }
    };
  }, []);

  return (
    <div style={sc.wrap}>
      <div style={sc.header}>
        <span style={sc.title}>📷 バーコードをスキャン</span>
        <button style={sc.xBtn} onClick={onClose}>✕</button>
      </div>
      {status === "error"
        ? <div style={sc.errorBox}>{errorMsg}</div>
        : (
          <div style={sc.videoWrap}>
            <div ref={scannerRef} style={{ width: "100%", height: "100%" }} />
            <div style={sc.dimOverlay}><div style={sc.frame} /></div>
            <div style={sc.hint}>{status === "loading" ? "カメラを起動中..." : "バーコードを枠内に合わせてください"}</div>
          </div>
        )}
      <div style={sc.dividerRow}><span style={sc.dividerText}>または手動で入力</span></div>
      <ManualInput onDetected={onDetected} />
    </div>
  );
}

function ManualInput({ onDetected }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, paddingBottom: 8 }}>
      <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none" }}
        placeholder="JANコード（13桁）" inputMode="numeric" value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, "").slice(0, 13))} />
      <button style={{ padding: "10px 16px", background: val.length >= 8 ? "#111" : "#d1d5db", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: val.length >= 8 ? "pointer" : "default" }}
        onClick={() => val.length >= 8 && onDetected(val)}>検索</button>
    </div>
  );
}

const sc = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 28px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  xBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
  videoWrap: { position: "relative", background: "#111", borderRadius: 14, overflow: "hidden", aspectRatio: "4/3", marginBottom: 4 },
  video: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  dimOverlay: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  frame: { width: "70%", aspectRatio: "2.2/1", border: "2.5px solid #fff", borderRadius: 10, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" },
  hint: { position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center", color: "rgba(255,255,255,0.85)", fontSize: 12 },
  errorBox: { background: "#fee2e2", color: "#b91c1c", borderRadius: 12, padding: "14px 16px", fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 16 },
  dividerRow: { display: "flex", alignItems: "center", margin: "16px 0 12px" },
  dividerText: { fontSize: 12, color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 20, padding: "3px 12px", margin: "0 auto" },
};

// ---- X Share Modal ----
function XShareModal({ kits, myXId, setMyXId, onClose }) {
  const pending = kits.filter((k) => !k.completed);
  const [selected, setSelected] = useState(new Set()); // empty = 全部
  const [mode, setMode] = useState("all"); // "all" | "select"

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const targetKits = mode === "all" ? pending : pending.filter((k) => selected.has(k.id));

  const buildTweet = () => {
    const id = myXId.trim().replace(/^@/, "");
    const idLine = id ? `DM→ @${id}\n\n` : "";
    const lines = targetKits.slice(0, 10).map((k) => {
      const scale = k.scale ? ` [${k.scale}]` : "";
      return `📦 ${k.name}${scale}`;
    });
    const more = targetKits.length > 10 ? `\n他${targetKits.length - 10}点...` : "";
    return `積みプラ紹介します！\n\n${lines.join("\n")}${more}\n\n${idLine}#積みプラ #プラモデル #ツミツミ #気になるツミはありますか`;
  };

  const handleTweet = () => {
    if (targetKits.length === 0) return;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweet())}`, "_blank");
  };

  return (
    <div style={xs.wrap}>
      <div style={xs.header}>
        <span style={xs.title}>𝕏 積みプラをシェア</span>
        <button style={xs.closeBtn} onClick={onClose}>✕</button>
      </div>

      {pending.length === 0 ? (
        <div style={xs.empty}>積みプラが登録されていません</div>
      ) : (<>
        {/* X ID入力 */}
        <label style={xs.label}>あなたのX ID（省略可）</label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
          <span style={{ color: "#9ca3af", fontSize: 16 }}>@</span>
          <input style={{ flex: 1, padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none" }}
            placeholder="your_x_id" value={myXId}
            onChange={(e) => setMyXId(e.target.value.replace(/^@/, ""))} />
        </div>

        {/* モード切り替え */}
        <div style={xs.modeRow}>
          <button style={{ ...xs.modeBtn, ...(mode === "all" ? xs.modeBtnActive : {}) }} onClick={() => setMode("all")}>全部シェア</button>
          <button style={{ ...xs.modeBtn, ...(mode === "select" ? xs.modeBtnActive : {}) }} onClick={() => setMode("select")}>選んでシェア</button>
        </div>

        {/* キット選択リスト（selectモード時） */}
        {mode === "select" && (
          <div style={xs.kitList}>
            {pending.map((k) => (
              <div key={k.id} style={{ ...xs.kitRow, background: selected.has(k.id) ? "#f0fdf4" : "#fafafa", border: `1.5px solid ${selected.has(k.id) ? "#22c55e" : "#e5e7eb"}` }}
                onClick={() => toggleSelect(k.id)}>
                <div style={{ ...xs.checkbox, background: selected.has(k.id) ? "#22c55e" : "#fff", border: `2px solid ${selected.has(k.id) ? "#22c55e" : "#d1d5db"}` }}>
                  {selected.has(k.id) && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
                {k.photoUrl && <img src={k.photoUrl} style={xs.kitThumb} alt="" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={xs.kitName}>{k.name}</div>
                  <div style={xs.kitMeta}>{[k.scale, k.price ? formatPrice(k.price) : ""].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* プレビュー */}
        <div style={xs.previewBox}>
          <div style={xs.previewLabel}>投稿プレビュー</div>
          <div style={xs.previewText}>{targetKits.length > 0 ? buildTweet() : "キットを選んでください"}</div>
        </div>

        <button style={{ ...xs.tweetBtn, opacity: targetKits.length === 0 ? 0.4 : 1 }} onClick={handleTweet}>
          𝕏 ポストする（{targetKits.length}件）
        </button>
      </>)}
    </div>
  );
}

const xs = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 32px", maxHeight: "90vh", overflowY: "auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700, color: "#111" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" },
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

// ---- Main App ----
export default function App() {
  const [kits, setKits] = useState(() => {
    try {
      const saved = localStorage.getItem("tsumitsumi_kits");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // kitsが変わるたびにローカルストレージに保存
  useEffect(() => {
    try { localStorage.setItem("tsumitsumi_kits", JSON.stringify(kits)); } catch {}
  }, [kits]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [myXId, setMyXId] = useState("");
  const fileRef = useRef();

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setForm((f) => ({ ...f, photo: file, photoUrl: URL.createObjectURL(file) }));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    if (editId !== null) {
      setKits((ks) => ks.map((k) => (k.id === editId ? { ...form, id: editId } : k)));
      setEditId(null);
    } else {
      setKits((ks) => [...ks, { ...form, id: Date.now() }]);
    }
    setForm(emptyForm);
    setShowForm(false);
  };

  const handleEdit = (kit) => {
    setForm({ ...kit });
    setEditId(kit.id);
    setShowForm(true);
    setDetail(null);
  };

  const handleDelete = (id) => {
    setKits((ks) => ks.filter((k) => k.id !== id));
    setDetail(null);
  };

  const toggleComplete = (id) => {
    setKits((ks) => ks.map((k) => (k.id === id ? { ...k, completed: !k.completed } : k)));
    if (detail?.id === id) setDetail((d) => ({ ...d, completed: !d.completed }));
  };

  const handleJanDetected = async (jan) => {
    setShowScanner(false);
    setScanLoading(true);
    const data = await fetchProductByJAN(jan);
    setScanLoading(false);
    if (data?.name) {
      setForm({ ...emptyForm, jan, name: data.name, series: data.series, scale: data.scale, price: data.price, photoUrl: data.photoUrl });
    } else {
      setForm({ ...emptyForm, jan });
    }
    setEditId(null);
    setShowForm(true);
  };

  // 「ほしい！」ボタン — 相手のX IDを聞いてリプライ文を生成
  const handleWant = (kit) => {
    const ownerMention = kit.ownerXId ? `@${kit.ownerXId} ` : "";
    const text = `${ownerMention}「${kit.name}」これを作ってくれる方に譲りたいです！DMお願いします🙏 #積みプラ #プラモデル #ツミツミ`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
  };

  const filtered = kits.filter((k) =>
    filter === "pending" ? !k.completed : filter === "done" ? k.completed : true
  );
  const pending = kits.filter((k) => !k.completed).length;
  const done = kits.filter((k) => k.completed).length;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>ツミツミ</div>
          <div style={s.headerSub}>PLASTIC MODEL TRACKER</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={s.shareBtn} onClick={() => setShowShare(true)}>𝕏 シェア</button>
          <button style={s.scanBtn} onClick={() => setShowScanner(true)}>📷</button>
          <button style={s.addBtn} onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>＋</button>
        </div>
      </div>

      {/* Stats */}
      <div style={s.stats}>
        {[["総数", kits.length, "#111", "all"], ["積みプラ", pending, "#ef4444", "pending"], ["完成", done, "#22c55e", "done"]].map(([label, num, color, f]) => (
          <div key={f} style={s.statBox} onClick={() => setFilter(f)}>
            <div style={{ ...s.statNum, color }}>{num}</div>
            <div style={s.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {[["all","すべて"],["pending","積みプラ"],["done","完成済み"]].map(([val, label]) => (
          <button key={val} style={{ ...s.tab, ...(filter === val ? s.tabActive : {}) }} onClick={() => setFilter(val)}>{label}</button>
        ))}
      </div>

      {scanLoading && <div style={s.loadingBar}>🔍 商品情報を検索中...</div>}

      {/* List */}
      <div style={s.list}>
        {filtered.length === 0 && (
          <div style={s.empty}>
            {kits.length === 0
              ? <><div style={{ fontSize: 40, marginBottom: 12 }}>📦</div><div>「📷」でスキャンするか<br />「＋」でキットを登録しよう</div></>
              : "該当するキットがありません"}
          </div>
        )}
        {filtered.map((kit) => (
          <div key={kit.id} style={s.card} onClick={() => setDetail(kit)}>
            {kit.photoUrl
              ? <img src={kit.photoUrl} style={s.thumb} alt="" />
              : <div style={s.thumbPh}>📦</div>
            }
            <div style={s.cardBody}>
              <div style={s.cardName}>{kit.name}</div>
              <div style={s.cardMeta}>
                {kit.series && <span>{kit.series}</span>}
                {kit.scale && <span style={s.badge}>{kit.scale}</span>}
              </div>
              <div style={s.cardBottom}>
                {kit.rating > 0 && <span style={s.stars}>{"★".repeat(kit.rating)}{"☆".repeat(5 - kit.rating)}</span>}
                {kit.count > 1 && <span style={s.countBadge}>{kit.count}個</span>}
              </div>
            </div>
            <button
              style={{ ...s.checkBtn, background: kit.completed ? "#22c55e" : "#e5e7eb", color: kit.completed ? "#fff" : "#9ca3af" }}
              onClick={(e) => { e.stopPropagation(); toggleComplete(kit.id); }}
            >✓</button>
          </div>
        ))}
      </div>

      {/* Detail modal */}
      {detail && (
        <div style={s.overlay} onClick={() => setDetail(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            {detail.photoUrl && <img src={detail.photoUrl} style={s.modalPhoto} alt="" />}
            <div style={s.modalBody}>
              <div style={s.modalTitle}>{detail.name}</div>
              {detail.completed && <div style={s.doneBadge}>✓ 完成済み</div>}
              <table style={s.table}><tbody>
                {[["シリーズ", detail.series], ["スケール", detail.scale], ["購入日", formatDate(detail.purchaseDate)], ["個数", detail.count > 1 ? `${detail.count}個` : null], ["評価", detail.rating > 0 ? "★".repeat(detail.rating) + "☆".repeat(5 - detail.rating) : null], ["JAN", detail.jan], ["メモ", detail.memo]]
                  .filter(([, v]) => v && v !== "—")
                  .map(([k, v]) => <tr key={k}><td style={s.td1}>{k}</td><td style={s.td2}>{v}</td></tr>)}
              </tbody></table>
              {/* ほしい！ボタン */}
              {!detail.completed && (
                <button style={s.wantBtn} onClick={() => handleWant(detail)}>
                  🙋 これを作ってくれる人に譲りたい！とポストする
                </button>
              )}
              <div style={s.modalBtns}>
                <button style={s.editBtn} onClick={() => handleEdit(detail)}>編集</button>
                <button style={s.deleteBtn} onClick={() => handleDelete(detail.id)}>削除</button>
                <button style={s.closeBtn} onClick={() => setDetail(null)}>閉じる</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scanner */}
      {showScanner && (
        <div style={s.overlay} onClick={() => setShowScanner(false)}>
          <div style={{ width: "100%", maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <BarcodeScanner onDetected={handleJanDetected} onClose={() => setShowScanner(false)} />
          </div>
        </div>
      )}

      {/* X Share modal */}
      {showShare && (
        <div style={s.overlay} onClick={() => setShowShare(false)}>
          <div style={{ width: "100%", maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <XShareModal kits={kits} myXId={myXId} setMyXId={setMyXId} onClose={() => setShowShare(false)} />
          </div>
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div style={s.overlay} onClick={() => setShowForm(false)}>
          <div style={s.formModal} onClick={(e) => e.stopPropagation()}>
            <div style={s.formTitle}>{editId ? "キットを編集" : "キットを追加"}</div>
            {scanMsg && <div style={{ background: "#fee2e2", color: "#b91c1c", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 4 }}>{scanMsg}</div>}

            <label style={s.label}>キット名 *</label>
            <input style={s.input} placeholder="例: νガンダム" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />

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

            <label style={s.label}>スケール</label>
            <select style={s.input} value={form.scale} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))}>
              <option value="">選択してください</option>
              {SCALE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>

            <label style={s.label}>購入日</label>
            <input style={s.input} type="date" value={form.purchaseDate} onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} />

            <label style={s.label}>評価</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              {[1,2,3,4,5].map((star) => (
                <button key={star}
                  style={{ fontSize: 28, background: "none", border: "none", cursor: "pointer", color: star <= form.rating ? "#f59e0b" : "#d1d5db", padding: "0 2px" }}
                  onClick={() => setForm((f) => ({ ...f, rating: f.rating === star ? 0 : star }))}>
                  ★
                </button>
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

            <label style={s.label}>写真</label>
            <div style={s.photoArea} onClick={() => fileRef.current.click()}>
              {form.photoUrl
                ? <img src={form.photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} alt="" />
                : <span style={{ color: "#9ca3af", fontSize: 14 }}>📷 タップして写真を選択</span>
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />

            <label style={s.label}>メモ</label>
            <textarea style={{ ...s.input, minHeight: 60, resize: "vertical" }} placeholder="自由にメモを残そう" value={form.memo} onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))} />

            <div style={s.formBtns}>
              <button style={s.cancelBtn} onClick={() => setShowForm(false)}>キャンセル</button>
              <button style={s.saveBtn} onClick={handleSubmit}>{editId ? "更新" : "追加"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const s = {
  root: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f8f9fa", fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", paddingBottom: 40 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px 20px 16px", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  headerTitle: { fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: -0.5 },
  headerSub: { fontSize: 10, color: "#aaa", letterSpacing: 3, marginTop: 2 },
  shareBtn: { background: "#000", color: "#fff", border: "none", borderRadius: 20, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  scanBtn: { background: "#f3f4f6", color: "#111", border: "none", borderRadius: 20, padding: "8px 12px", fontSize: 16, cursor: "pointer" },
  addBtn: { background: "#111", color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", fontSize: 18, fontWeight: 700, cursor: "pointer" },
  stats: { display: "flex", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  statBox: { flex: 1, padding: "14px 0", textAlign: "center", cursor: "pointer" },
  statNum: { fontSize: 24, fontWeight: 700 },
  statLabel: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  tabs: { display: "flex", padding: "12px 16px 0", gap: 8, background: "#fff", borderBottom: "1px solid #f0f0f0" },
  tab: { flex: 1, padding: "8px 0", border: "none", background: "none", fontSize: 13, color: "#9ca3af", cursor: "pointer", borderBottom: "2px solid transparent", fontWeight: 500 },
  tabActive: { color: "#111", borderBottom: "2px solid #111", fontWeight: 700 },
  loadingBar: { background: "#f0fdf4", color: "#166534", padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #dcfce7" },
  list: { padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 },
  empty: { textAlign: "center", color: "#bbb", padding: "60px 0", fontSize: 14, lineHeight: 1.9 },
  card: { background: "#fff", borderRadius: 12, padding: "14px 12px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", cursor: "pointer" },
  thumb: { width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 },
  thumbPh: { width: 56, height: 56, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: 700, color: "#111", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  cardMeta: { fontSize: 12, color: "#6b7280", marginTop: 3, display: "flex", gap: 6, alignItems: "center" },
  badge: { background: "#f3f4f6", borderRadius: 4, padding: "1px 6px", fontSize: 11, color: "#374151" },
  cardBottom: { display: "flex", gap: 8, marginTop: 6, alignItems: "center" },
  priTag: { display: "flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "2px 8px", fontSize: 11, fontWeight: 600 },
  dot: { width: 6, height: 6, borderRadius: "50%", display: "inline-block" },
  price: { fontSize: 12, color: "#6b7280" },
  stars: { fontSize: 13, color: "#f59e0b", letterSpacing: 1 },
  countBadge: { fontSize: 11, background: "#f3f4f6", color: "#374151", borderRadius: 20, padding: "2px 8px", fontWeight: 600 },
  checkBtn: { width: 32, height: 32, borderRadius: "50%", border: "none", fontSize: 15, cursor: "pointer", fontWeight: 700, flexShrink: 0 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  modal: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" },
  modalPhoto: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "20px 20px 0 0" },
  modalBody: { padding: "20px 20px 32px" },
  modalTitle: { fontSize: 20, fontWeight: 700, color: "#111", marginBottom: 6 },
  doneBadge: { display: "inline-block", background: "#f0fdf4", color: "#166534", borderRadius: 20, padding: "2px 12px", fontSize: 12, fontWeight: 600, marginBottom: 12 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12 },
  td1: { padding: "6px 0", fontSize: 12, color: "#9ca3af", width: 80, verticalAlign: "top" },
  td2: { padding: "6px 0", fontSize: 14, color: "#111" },
  wantBtn: { width: "100%", marginTop: 16, padding: "12px 0", background: "#fff0f3", color: "#e11d48", border: "1.5px solid #fecdd3", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  modalBtns: { display: "flex", gap: 8, marginTop: 12 },
  editBtn: { flex: 1, padding: "10px 0", background: "#f3f4f6", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#111" },
  deleteBtn: { flex: 1, padding: "10px 0", background: "#fee2e2", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#b91c1c" },
  closeBtn: { flex: 1, padding: "10px 0", background: "#111", border: "none", borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer", color: "#fff" },
  formModal: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", padding: "24px 20px 40px" },
  formTitle: { fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 20 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 6, marginTop: 14 },
  input: { width: "100%", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 14, color: "#111", background: "#fafafa", boxSizing: "border-box", outline: "none" },
  row: { display: "flex", gap: 10 },
  priRow: { display: "flex", gap: 8 },
  priBtn: { flex: 1, padding: "8px 0", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600 },
  photoArea: { width: "100%", height: 120, border: "1.5px dashed #d1d5db", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", overflow: "hidden", marginTop: 2 },
  formBtns: { display: "flex", gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, padding: "12px 0", background: "#f3f4f6", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#374151" },
  saveBtn: { flex: 2, padding: "12px 0", background: "#111", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: "pointer", color: "#fff" },
};
