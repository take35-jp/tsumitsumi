import { useState, useRef, useEffect } from "react";

const SERIES_OPTIONS = [
  // ── バンダイ ガンプラ ──
  "ガンプラ",
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
const SCALE_OPTIONS = ["1/144", "1/100", "1/72", "1/60", "1/48", "1/32", "1/24", "HG", "RG", "MG", "RE/100", "MGSD", "MGEX", "PG", "SD", "フルメカニクス", "UNLEASHED", "その他"];

const RANKS = [
  { min: 500, label: "模型屋", color: "#7c3aed" },
  { min: 300, label: "ルナティックツミニスト", color: "#dc2626" },
  { min: 200, label: "ヘルモードツミニスト", color: "#ea580c" },
  { min: 150, label: "ライフイズツミニスト", color: "#d97706" },
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
  count: 1, rating: 0, photo: null, photoUrl: "", completedPhotoUrl: "", completed: false, memo: "", jan: "",
  condition: "", conditionNote: "", tags: [],
};

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

function guessSeriesFromName(name) {
  if (/MODEROID/i.test(name)) return "MODEROID";
  if (/フレームアームズ・ガール|FA:G/i.test(name)) return "フレームアームズ・ガール";
  if (/フレームアームズ|Frame Arms/i.test(name)) return "フレームアームズ";
  if (/ヘキサギア|Hexa Gear/i.test(name)) return "ヘキサギア";
  if (/メガミデバイス/i.test(name)) return "メガミデバイス";
  if (/アーマーガールズ/i.test(name)) return "アーマーガールズプロジェクト";
  if (/アーマードコア|ARMORED CORE/i.test(name)) return "アーマードコア（コトブキヤ）";
  if (/創彩少女庭園/i.test(name)) return "創彩少女庭園";
  if (/30MF|30 Minutes Fantasy/i.test(name)) return "30 Minutes Fantasy";
  if (/30MP|30 Minutes Preference/i.test(name)) return "30 Minutes Preference";
  if (/30MS|30 Minutes Sisters/i.test(name)) return "30 Minutes Sisters";
  if (/30MM|30 Minutes Missions/i.test(name)) return "30 Minutes Missions";
  if (/Figure-rise/i.test(name)) return "Figure-rise Standard";
  if (/ポケモン|ポケプラ|Pokemon/i.test(name)) return "ポケプラ";
  if (/ゾイド|ZOIDS/i.test(name)) return "ゾイド";
  if (/トランスフォーマー|Transformers/i.test(name)) return "トランスフォーマー";
  if (/マシーネンクリーガー|Ma.K\.|Maschinen Krieger/i.test(name)) return "マシーネンクリーガー";
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
  if (/ファイブスター|F\.S\.S\.|FSS/i.test(name)) return "FSS（ファイブスター物語）";
  if (/マクロス|バルキリー|VF-/i.test(name)) return "マクロス（バンダイ）";
  if (/スターウォーズ|STAR WARS/i.test(name)) return "スターウォーズ（バンダイ）";
  if (/ウルトラマン/i.test(name)) return "ウルトラマン（バンダイ）";
  if (/仮面ライダー/i.test(name)) return "仮面ライダー（バンダイ）";
  if (/ミニ四駆/i.test(name)) return "ミニ四駆";
  if (/\bPG\b|\bMG\b|\bRG\b|\bHG\b|\bEG\b|\bSD\b|ガンダム|Gundam/i.test(name)) return "ガンプラ";
  return "";
}
function guessScaleFromName(name) {
  if (/\bMGSD\b/i.test(name)) return "MGSD";
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
        const tick = async (ts) => {
          if (cancelled || detectedRef.current) return;
          animRef.current = requestAnimationFrame(tick);

          if (ts - lastTs < 150) return;
          lastTs = ts;
          frameCount++;

          const vw = video.videoWidth;
          const vh = video.videoHeight;

          if (frameCount % 5 === 0) {
            setDebugInfo(`ZBar: ${vw}x${vh} (${frameCount}f)`);
          }

          if (vw === 0 || vh === 0) return;

          try {
            canvas.width = vw;
            canvas.height = vh;
            ctx.drawImage(video, 0, 0, vw, vh);
            const imageData = ctx.getImageData(0, 0, vw, vh);
            const symbols = await zbar.scanImageData(imageData);

            if (symbols && symbols.length > 0 && !detectedRef.current) {
              const raw = symbols[0].decode();
              if (raw && raw.length >= 8) {
                setDebugInfo(`✅ ZBar検出: ${raw}`);
                resolve(raw);
              }
            }
          } catch (e) {
            // WASM エラー - 継続
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
                resolve(code);
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

            const code = await runZBar(video);
            if (!cancelled) {
              onDetected(code);
              if (continuous) {
                // 連続モード：カメラを止めずに再スキャン開始
                setDebugInfo("次のバーコードをスキャン...");
                // detectedRefは既に2秒後リセット予定 → runZBarを再帰的に呼ぶ
                const loopZBar = async () => {
                  while (!cancelled) {
                    try {
                      const nextCode = await runZBar(video);
                      if (!cancelled) onDetected(nextCode);
                      setDebugInfo("次のバーコードをスキャン...");
                    } catch { break; }
                  }
                };
                loopZBar();
              } else {
                detectedRef.current = true;
                stream.getTracks().forEach(t => t.stop());
              }
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
              v1.10 | スキャン中...
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
        `${SUPABASE_URL}/rest/v1/products?name=ilike.*${encodeURIComponent(q)}*&select=name,scale,image_url,jan,series&limit=5&order=name.asc`,
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
              {item.photoUrl && <img src={item.photoUrl} style={suggS.thumb} alt="" />}
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
  const GRADES = ["HG", "RG", "MG", "MGEX", "MGSD", "PG", "EG", "SD", "FM", "RE"];
  const [grade, setGrade] = useState("HG");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedItems, setSelectedItems] = useState({}); // key: "name_jan", value: item
  const [searched, setSearched] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");

  const getKey = (item) => `${item.name}_${item.jan}`;

  const search = async (g, p, q) => {
    setLoading(true);
    setSearched(true);
    try {
      const query = q !== undefined ? q : browseQuery;
      const url = query.trim()
        ? `/api/browse?grade=${g}&page=${p}&q=${encodeURIComponent(query.trim())}`
        : `/api/browse?grade=${g}&page=${p}`;
      const res = await fetch(url);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {}
    setLoading(false);
  };

  const toggleSelect = (item) => {
    const key = getKey(item);
    setSelectedItems(prev => {
      const next = { ...prev };
      next[key] ? delete next[key] : next[key] = item;
      return next;
    });
  };

  const isSelected = (item) => !!selectedItems[getKey(item)];
  const selectedCount = Object.keys(selectedItems).length;

  const handleBulkAdd = () => {
    const toAdd = Object.values(selectedItems).map((item, idx) => ({
      ...{ name: "", series: "", scale: "", purchaseDate: "", price: "", count: 1, rating: 0,
           photo: null, photoUrl: "", completedPhotoUrl: "", completed: false, memo: "", jan: "", condition: "", conditionNote: "", tags: [] },
      ...item,
      id: Date.now() + idx,
      priority: "中",
    }));
    onBulkAdd(toAdd);
    onClose();
  };

  return (
    <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box", padding: "20px 20px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "#111" }}>📋 リストから一括登録</span>
        <button style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6b7280" }} onClick={onClose}>✕</button>
      </div>

      {/* グレード選択 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {GRADES.map(g => (
          <button key={g} style={{ padding: "6px 14px", borderRadius: 20, border: "1.5px solid", fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: grade === g ? "#111" : "#f3f4f6", color: grade === g ? "#fff" : "#374151", borderColor: grade === g ? "#111" : "#e5e7eb" }}
            onClick={() => { setGrade(g); setItems([]); setPage(1); setSearched(false); }}>
            {g}
          </button>
        ))}
      </div>

      <div style={{ background: "#fff8e1", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.7, wordBreak: "break-word" }}>
          ⚠️ <strong>注意：</strong>登録される情報は商品名・画像のみです。購入日・価格・状態などの詳細は登録後に個別に編集してください。
        </div>
      </div>

      <button style={{ width: "100%", padding: "10px 0", background: "#111", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}
        onClick={() => { setPage(1); search(grade, 1); }}>
        🔍 {grade} の一覧を表示
      </button>

      {loading && <div style={{ textAlign: "center", padding: "20px 0", color: "#9ca3af", fontSize: 13 }}>読み込み中...</div>}

      {!loading && searched && items.length === 0 && (
        <div style={{ textAlign: "center", padding: "20px 0", color: "#9ca3af", fontSize: 13 }}>見つかりませんでした</div>
      )}

      {/* キット一覧 */}
      {items.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
            約{total.toLocaleString()}件中 {(page-1)*30+1}〜{Math.min(page*30, total)}件表示
            　{selectedCount > 0 && <span style={{ color: "#22c55e", fontWeight: 700 }}>{selectedCount}件選択中（ページをまたいで保持）</span>}
          </div>

          {/* 全選択 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <button style={{ fontSize: 12, padding: "4px 10px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#f3f4f6", cursor: "pointer", color: "#374151", flexShrink: 0 }}
              onClick={() => setSelectedItems(prev => { const next = {...prev}; filteredItems.forEach(item => next[getKey(item)] = item); return next; })}>全選択</button>
            <button style={{ fontSize: 12, padding: "4px 10px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#f3f4f6", cursor: "pointer", color: "#374151", flexShrink: 0 }}
              onClick={() => setSelectedItems({})}>全解除</button>
            <input
              style={{ flex: 1, padding: "4px 10px", border: "1.5px solid #e5e7eb", borderRadius: 20, fontSize: 12, outline: "none", background: "#fafafa", minWidth: 0 }}
              placeholder="例：ザク シャア（スペースでAND検索）"
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); search(grade, 1, browseQuery); } }}
            />
            <button style={{ fontSize: 11, padding: "4px 10px", border: "1.5px solid #111", borderRadius: 20, background: "#111", color: "#fff", cursor: "pointer", flexShrink: 0 }}
              onClick={() => { setPage(1); search(grade, 1, browseQuery); }}>検索</button>
          </div>

          {(() => { const filteredItems = items; return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {filteredItems.map((item, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                background: isSelected(item) ? "#f0fdf4" : "#fafafa", border: `1.5px solid ${isSelected(item) ? "#22c55e" : "#e5e7eb"}` }}
                onClick={() => toggleSelect(item)}>
                <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${isSelected(item) ? "#22c55e" : "#d1d5db"}`,
                  background: isSelected(item) ? "#22c55e" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isSelected(item) && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                </div>
                {item.photoUrl && <img src={item.photoUrl} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} alt="" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111", wordBreak: "break-word" }}>{item.name}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{item.scale}</div>
                </div>
              </div>
            ))}
          </div>
          ); })()}

          {/* ページネーション */}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
            {page > 1 && (
              <button style={{ padding: "6px 16px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#fff", fontSize: 13, cursor: "pointer" }}
                onClick={() => { const p = page - 1; setPage(p); search(grade, p); }}>← 前へ</button>
            )}
            <span style={{ fontSize: 12, color: "#9ca3af", alignSelf: "center" }}>{page}ページ</span>
            {page * 30 < total && (
              <button style={{ padding: "6px 16px", border: "1.5px solid #e5e7eb", borderRadius: 20, background: "#fff", fontSize: 13, cursor: "pointer" }}
                onClick={() => { const p = page + 1; setPage(p); search(grade, p); }}>次へ →</button>
            )}
          </div>

          {/* 一括登録ボタン */}
          {selectedCount > 0 && (
            <button style={{ width: "100%", padding: "14px 0", background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
              onClick={handleBulkAdd}>
              ✓ {selectedCount}件をまとめて登録
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---- Backup Modal ----
function BackupModal({ kits, onImport, onClose }) {
  const fileRef = useRef();
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState(""); // "ok" | "err"

  const handleExport = () => {
    const data = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), kits }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tsumitsumi_backup_${new Date().toLocaleDateString("ja-JP").replace(/\//g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("バックアップファイルをダウンロードしました！");
    setMsgType("ok");
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
    </div>
  );
}

// ---- Legal Modal ----
function LegalModal({ type, onClose }) {
  const isPrivacy = type === "privacy";
  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>{isPrivacy ? "🔒 プライバシーポリシー" : "📋 利用規約"}</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>
      {isPrivacy ? (
        <>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>収集する情報</div>
            <div style={hs.desc}>本アプリはお客様の個人情報を収集・サーバーへ送信しません。登録されたキット情報はお使いの端末のブラウザ（localStorage）にのみ保存されます。</div>
          </div>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>お問い合わせ</div>
            <div style={hs.desc}>プライバシーに関するお問い合わせは X（@tsumitsumi_pla）のDMにてご連絡ください。</div>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingTop: 8 }}>最終更新：2025年4月</div>
        </>
      ) : (
        <>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>サービスについて</div>
            <div style={hs.desc}>ツミツミ（以下「本アプリ」）は、プラモデルの積みプラ管理を目的とした個人開発のWebアプリです。</div>
          </div>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>禁止事項</div>
            <div style={hs.desc}>以下の行為を禁止します。</div>
            <div style={hs.item}><span style={hs.warn}>!</span>本アプリを利用した詐欺・不正行為</div>
            <div style={hs.item}><span style={hs.warn}>!</span>他のユーザーへの迷惑行為・嫌がらせ</div>
            <div style={hs.item}><span style={hs.warn}>!</span>本アプリの無断複製・改変・再配布</div>
          </div>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>免責事項</div>
            <div style={hs.desc}>本アプリの利用により生じたいかなる損害についても、開発者は責任を負いません。ユーザー間の取引（譲渡・売買等）は当事者間の責任で行ってください。</div>
          </div>
          <div style={hs.section}>
            <div style={hs.sectionTitle}>サービスの変更・終了</div>
            <div style={hs.desc}>予告なく機能の変更・サービスの終了を行う場合があります。データのバックアップは定期的に行ってください。</div>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "center", paddingTop: 8 }}>最終更新：2025年4月</div>
        </>
      )}
    </div>
  );
}

// ---- Bulk Tag Badge ----
function BulkTagBadge({ tag, onApply, onRemove, onDeleteMaster }) {
  const [showDel, setShowDel] = useState(false);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: showDel ? "#fef2f2" : "#f0fdf4", border: `1px solid ${showDel ? "#fca5a5" : "#bbf7d0"}`, borderRadius: 20, padding: "3px 6px 3px 10px", fontSize: 11, fontWeight: 600, userSelect: "none", WebkitUserSelect: "none", transition: "background 0.15s" }}>
      <span onClick={onApply} style={{ color: showDel ? "#b91c1c" : "#166534", cursor: "pointer" }}>#{tag}</span>
      {/* キットから削除 */}
      <button onClick={onRemove} title="選択キットから削除"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, background: "#f59e0b", borderRadius: "50%", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>
        −
      </button>
      {/* 一覧から削除トグル */}
      <button onClick={() => setShowDel(v => !v)} title="一覧から削除"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, background: showDel ? "#ef4444" : "#e5e7eb", borderRadius: "50%", color: showDel ? "#fff" : "#6b7280", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>
        🗑
      </button>
      {showDel && (
        <button onClick={onDeleteMaster}
          style={{ fontSize: 10, padding: "2px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>
          削除確定
        </button>
      )}
    </div>
  );
}

// ---- Tag Input ----
function TagInput({ tags, onChange, allTags = [] }) {
  const [input, setInput] = useState("");
  const [selectedTag, setSelectedTag] = useState(null);

  const addTag = (val) => {
    const tag = val.trim();
    if (!tag || tags.includes(tag)) { setInput(""); return; }
    onChange([...tags, tag]);
    setInput("");
    setSelectedTag(null);
  };

  const removeTag = (tag) => {
    onChange(tags.filter(t => t !== tag));
    setSelectedTag(null);
  };

  const suggestions = input.trim()
    ? allTags.filter(t => t.includes(input.trim()) && !tags.includes(t)).slice(0, 5)
    : allTags.filter(t => !tags.includes(t)).slice(0, 5);

  return (
    <div style={{ border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fafafa" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: tags.length > 0 ? 8 : 0 }}>
        {tags.map(tag => {
          const isSelected = selectedTag === tag;
          return (
            <span key={tag}
              onClick={() => setSelectedTag(isSelected ? null : tag)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: isSelected ? "#fee2e2" : "#f0fdf4",
                color: isSelected ? "#b91c1c" : "#166534",
                borderRadius: 20, padding: "3px 10px 3px 10px", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "background 0.15s",
                userSelect: "none", WebkitUserSelect: "none",
              }}
            >
              #{tag}
              {isSelected && (
                <span
                  onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, background: "#ef4444", borderRadius: "50%", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>
                  ×
                </span>
              )}
            </span>
          );
        })}
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
    { ver: "v1.5.1", date: "2026/04/19", isNew: true, items: ["希望小売価格をマスタDB格納方式に変更（正確な定価を保持）", "JAN編集フォームにマスタ照合機能追加", "一括定価取得の進捗インジケーター改善"] },
    { ver: "v1.5.0", date: "2026/04/19", isNew: false, items: ["税込希望小売価格の自動取得（バーコードスキャン時）", "積みプラ総額の表示（税込希望小売価格×個数）・表示/非表示切替", "連続スキャンモード追加", "月1自動マスタ更新（Cron Job）", "更新履歴ページ追加"] },
    { ver: "v1.4.0", date: "2026/04/19", items: ["スケール・シリーズフィルターに「未設定」を追加", "マスタDB 5,900件超に拡充（タミヤ/ハセガワ/コトブキヤ等）", "商品名クリーニング強化（爆買・中古・発送日等を除去）"] },
    { ver: "v1.3.0", date: "2026/04/18", items: ["マスタDB 3,000件超に拡充", "バーコードスキャン精度向上（ZBar WASM対応）", "グレード別一括登録（☰ボタン）追加"] },
    { ver: "v1.2.0", date: "2026/04/13", items: ["タグ機能追加", "一括編集モード追加", "Xシェア画像生成機能追加"] },
    { ver: "v1.1.0", date: "2026/04/11", items: ["バックアップ（エクスポート/インポート）機能追加", "グリッド表示モード追加", "状態・評価フィルター追加"] },
    { ver: "v1.0.0", date: "2026/04/10", items: ["TSUMI TSUMI リリース 🎉", "バーコードスキャン登録", "積みプラ一覧管理の基本機能"] },
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

function HelpModal({ onClose }) {
  return (
    <div style={hs.wrap}>
      <div style={hs.header}>
        <span style={hs.title}>❓ ヘルプ・使い方</span>
        <button style={hs.closeBtn} onClick={onClose}>✕</button>
      </div>

      <div style={hs.section}>
        <div style={hs.sectionTitle}>📱 基本的な使い方</div>
        <div style={hs.item}><span style={hs.num}>1</span>右下の📷ボタンでバーコードをスキャン登録</div>
        <div style={hs.item}><span style={hs.num}>2</span>右下の＋ボタンでキット名を直接入力して登録</div>
        <div style={hs.item}><span style={hs.num}>3</span>キットをタップして詳細・編集・削除</div>
        <div style={hs.item}><span style={hs.num}>4</span>✓ボタンで完成済みに変更</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>📷 バーコードスキャン（iPhone）</div>
        <div style={hs.desc}>ライブカメラでスキャンします。読み取れない場合はタップでフォーカス調整してください。</div>
        <div style={hs.tip}>💡 精度向上のヒント：「設定」→「Safari」→「詳細」→「機能フラグ」→「Shape Detection API」をオン</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>📷 バーコードスキャン（Android）</div>
        <div style={hs.item}><span style={hs.num}>1</span>📷ボタンをタップしてカメラを起動</div>
        <div style={hs.item}><span style={hs.num}>2</span>バーコード部分だけをアップで撮影</div>
        <div style={hs.item}><span style={hs.num}>3</span>自動でJANコードを読み取って登録画面へ</div>
        <div style={hs.tip}>💡 明るい場所でバーコードに近づいて撮影すると精度が上がります</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>🔍 キット名で検索して登録</div>
        <div style={hs.desc}>手動登録時にキット名を2文字以上入力すると候補が表示されます。候補をタップすると画像・名前が自動入力されます。</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>⚠ データについての注意</div>
        <div style={hs.item}><span style={hs.warn}>!</span>データはブラウザ内に保存されます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>Safariの「履歴とデータを消去」でデータが消えます</div>
        <div style={hs.item}><span style={hs.warn}>!</span>SafariとChromeなど別ブラウザ間でデータは共有されません</div>
        <div style={hs.item}><span style={hs.warn}>!</span>機種変更・初期化の際はデータが引き継がれません</div>
      </div>
      <div style={hs.section}>
        <div style={hs.sectionTitle}>↕ 並び替え</div>
        <div style={hs.desc}>リスト右上の「↕ 並び替え」ボタンをタップすると▲▼ボタンが表示され、1つずつ順番を変えられます。</div>
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
          href="https://twitter.com/messages/compose?recipient_id=tsumitsumi_pla"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#000", color: "#fff", borderRadius: 20, padding: "10px 20px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
          𝕏 @tsumitsumi_pla にDM
        </a>
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
          {/* v1.5.0 */}
          <div style={{ background: "#f0fdf4", border: "1.5px solid #bbf7d0", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ background: "#22c55e", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "1px 7px" }}>NEW</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.5.1</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/04/19</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・税込希望小売価格の自動取得（バーコードスキャン時）<br/>
              ・積みプラ総額の表示（税込希望小売価格×個数）<br/>
              ・連続スキャンモード追加<br/>
              ・月1自動マスタ更新（Cron Job）<br/>
              ・希望小売価格をあみあみ参考価格から取得（プレ値除去）
            </div>
          </div>
          {/* v1.4.0 */}
          <div style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.4.0</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/04/19</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・スケール・シリーズフィルターに「未設定」を追加<br/>
              ・マスタDB 5,900件超に拡充（タミヤ/ハセガワ/コトブキヤ等）<br/>
              ・商品名クリーニング強化
            </div>
          </div>
          {/* v1.3.0 */}
          <div style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#111" }}>v1.3.0</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>2026/04/18</span>
            </div>
            <div style={{ fontSize: 11, color: "#374151", lineHeight: 1.8 }}>
              ・マスタDB 3,000件超に拡充<br/>
              ・バーコードスキャン精度向上（ZBar WASM対応）<br/>
              ・グレード別一括登録（☰ボタン）追加
            </div>
          </div>
        </div>
      </div>
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

  // 画像ロードヘルパー（外部URLはプロキシ経由）
  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    if (src.startsWith("data:")) {
      // Base64はそのまま
      img.src = src;
    } else {
      // 外部URLはサーバープロキシ経由でCORSを回避
      img.crossOrigin = "anonymous";
      img.src = `/api/image-proxy?url=${encodeURIComponent(src)}`;
    }
  });

  // 全画像を事前ロード
  const imgCache = {};
  await Promise.all(kits.map(async (k) => {
    if (k.photoUrl) imgCache[k.id] = await loadImage(k.photoUrl);
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

function XShareModal({ kits, myXId, setMyXId, onClose }) {
  const pending = kits.filter((k) => !k.completed);
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState("all");
  const [generating, setGenerating] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
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

  const handleGenerateImages = async () => {
    setGenerating(true);
    setGeneratedCount(0);
    try {
      const blobs = await generateShareImages(targetKits, "");
      setGeneratedCount(blobs.length);
      // 画像を順番にダウンロード
      for (let i = 0; i < blobs.length; i++) {
        const url = URL.createObjectURL(blobs[i]);
        const a = document.createElement("a");
        a.href = url;
        a.download = `tsumitsumi_${String(i + 1).padStart(2, "0")}.png`;
        a.click();
        await new Promise(r => setTimeout(r, 400));
        URL.revokeObjectURL(url);
      }
      // ダウンロード完了 → ボタン表示のみ（iOSではsetTimeout内のwindow.openはブロックされる）
    } catch (e) {
      alert("画像生成エラー: " + e.message);
    }
    setGenerating(false);
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
      <div style={xs.header}><span style={xs.title}>𝕏 積みプラをシェア</span><button style={xs.closeBtn} onClick={onClose}>✕</button></div>
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
                {k.photoUrl && <img src={k.photoUrl} style={xs.kitThumb} alt="" />}
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
                {generatedCount}枚のダウンロードが完了しました
              </div>
              <div style={{ fontSize: 11, color: "#166534", lineHeight: 1.7, marginBottom: 10 }}>
                次のステップ：<br/>
                1. カメラロールに保存された画像を確認<br/>
                2. 下のボタンでXを開く<br/>
                3. 投稿画面で画像を添付して投稿
              </div>
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildTweetForImage(targetKits.length, generatedCount))}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", padding: "13px 0", background: "#000", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>
                𝕏 Xを開いて投稿する
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
    </div>
  );
}

const xs = {
  wrap: { background: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "20px 20px 32px", maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" },
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
    try { const s = localStorage.getItem("tsumitsumi_kits"); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem("tsumitsumi_kits", JSON.stringify(kits)); } catch {} }, [kits]);

  // 希望小売価格が未取得のキットにバックグラウンドで自動取得
  useEffect(() => {
    if (priceLoading) return; // 一括取得中はバックグラウンド取得しない
    const kitsWithoutPrice = kits.filter(k => k.jan && !k.retailPrice);
    if (kitsWithoutPrice.length === 0) return;
    // 5件ずつ順次取得（API負荷軽減）
    let cancelled = false;
    const fetchPrices = async () => {
      for (const kit of kitsWithoutPrice.slice(0, 30)) { // 一度に最大30件
        if (cancelled) break;
        try {
          const r = await fetch(`/api/price?jan=${kit.jan}`);
          const d = await r.json();
          if (d.price && !cancelled) {
            setKits(prev => prev.map(k =>
              k.id === kit.id ? { ...k, retailPrice: String(d.price) } : k
            ));
          }
        } catch {}
        await new Promise(r => setTimeout(r, 300)); // 0.3秒間隔
      }
    };
    fetchPrices();
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
  const [myXId, setMyXId] = useState("");
  const [filterSeries, setFilterSeries] = useState("");
  const [filterRating, setFilterRating] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showLegal, setShowLegal] = useState(null);
  const [showBackup, setShowBackup] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false); // "privacy" | "terms" | null
  const [filterCondition, setFilterCondition] = useState("");
  const [filterTags, setFilterTags] = useState([]); // 選択中のタグ
  const [filterScale, setFilterScale] = useState("");
  const [showAppShare, setShowAppShare] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [continuousScan, setContinuousScan] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false); // 一括取得中フラグ
  const [priceProgress, setPriceProgress] = useState({ current: 0, total: 0 }); // 進捗
  const [showPriceTotal, setShowPriceTotal] = useState(() => {
    try { return localStorage.getItem("tsumitsumi_showPrice") !== "false"; } catch { return true; }
  });
  // 設定変更時にlocalStorageへ保存
  useEffect(() => {
    try { localStorage.setItem("tsumitsumi_showPrice", showPriceTotal ? "true" : "false"); } catch {}
  }, [showPriceTotal]);
  const [continuousQueue, setContinuousQueue] = useState([]); // 連続スキャンキュー
  const [searchQuery, setSearchQuery] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const [viewMode, setViewMode] = useState("list");
  const [sortKey, setSortKey] = useState("custom"); // custom | name | date | purchaseDate
  const [sortDir, setSortDir] = useState("asc");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState(new Set());
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [tagMasterList, setTagMasterList] = useState(() => []);
  const fileRef = useRef();
  const completedFileRef = useRef();

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await compressImageToBase64(file);
    if (base64) setForm((f) => ({ ...f, photo: null, photoUrl: base64 }));
  };
  const handleCompletedPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const base64 = await compressImageToBase64(file);
    if (base64) setForm((f) => ({ ...f, completedPhotoUrl: base64 }));
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

  const handleEdit = (kit) => { setForm({ ...kit }); setEditId(kit.id); setShowForm(true); setDetail(null); };
  const handleDelete = (id) => { setKits((ks) => ks.filter((k) => k.id !== id)); setDetail(null); };
  const toggleComplete = (id) => {
    setKits((ks) => ks.map((k) => (k.id === id ? { ...k, completed: !k.completed } : k)));
    if (detail?.id === id) setDetail((d) => ({ ...d, completed: !d.completed }));
  };

  const handleJanDetected = async (jan) => {
    if (continuousScan) {
      // 連続スキャンモード：スキャナーを閉じずにキューに追加
      setScanLoading(true);
      const data = await fetchProductByJAN(jan);
      setScanLoading(false);
      const newKit = data?.name
        ? { ...emptyForm, jan, name: data.name, series: data.series, scale: data.scale, price: data.price, photoUrl: data.photoUrl, id: Date.now() + Math.random() }
        : { ...emptyForm, jan, id: Date.now() + Math.random() };
      setContinuousQueue(q => [...q, newKit]);
      // スキャナーはそのまま継続
      return;
    }
    setShowScanner(false);
    setScanLoading(true);
    const data = await fetchProductByJAN(jan);
    setScanLoading(false);
    setForm(data?.name ? { ...emptyForm, jan, name: data.name, series: data.series, scale: data.scale, price: data.price, retailPrice: data.retailPrice || data.price || "", photoUrl: data.photoUrl } : { ...emptyForm, jan });
    setEditId(null);
    setShowForm(true);
  };

  // 連続スキャンキューを一括登録
  const handleBulkScanRegister = () => {
    if (continuousQueue.length === 0) return;
    setKits(prev => [...prev, ...continuousQueue.map(k => ({ ...k, id: Date.now() + Math.random() }))]);
    setContinuousQueue([]);
    setShowScanner(false);
  };

  const handleBulkAdd = (newKits) => {
    setKits(prev => [...prev, ...newKits]);
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

  const handleRemoveFromTagMaster = (tag) => {
    setTagMasterList(prev => prev.filter(t => t !== tag));
  };

  const handleBulkDelete = () => {
    if (bulkSelected.size === 0) return;
    if (!window.confirm(`選択した${bulkSelected.size}件を削除しますか？`)) return;
    setKits(prev => prev.filter(k => !bulkSelected.has(k.id)));
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

  let filtered = kits.filter((k) =>
    filter === "pending" ? !k.completed : filter === "done" ? k.completed : true
  );
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(k =>
      k.name.toLowerCase().includes(q) ||
      (k.series || "").toLowerCase().includes(q) ||
      (k.scale || "").toLowerCase().includes(q)
    );
  }
  if (filterSeries === "__unset__") filtered = filtered.filter(k => !(k.series || "").trim());
  else if (filterSeries) filtered = filtered.filter(k => (k.series || "").replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim() === filterSeries);
  if (filterRating) filtered = filtered.filter(k => (k.rating || 0) === Number(filterRating));
  if (filterCondition) filtered = filtered.filter(k => (k.condition || "") === filterCondition);
  if (filterScale === "__unset__") filtered = filtered.filter(k => !(k.scale || "").trim());
  else if (filterScale) filtered = filtered.filter(k => (k.scale || "") === filterScale);
  if (filterTags.length > 0) filtered = filtered.filter(k => filterTags.every(tag => (k.tags || []).includes(tag)));

  // ソート（手動並び替えモード以外）
  if (sortKey !== "custom") {
    filtered = [...filtered].sort((a, b) => {
      let va, vb;
      if (sortKey === "name") { va = (a.name || ""); vb = (b.name || ""); }
      else if (sortKey === "date") { va = (a.id || 0); vb = (b.id || 0); }
      else if (sortKey === "purchaseDate") { va = (a.purchaseDate || ""); vb = (b.purchaseDate || ""); }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
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
          <button style={{ ...s.shareBtn, width: 30, height: 30, fontSize: 13 }} onClick={() => setShowShare(true)}>𝕏</button>
        </div>
      </div>

      <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "8px 20px", display: bulkMode ? "none" : "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: rank.color, background: rank.color + "18", borderRadius: 20, padding: "3px 10px" }}>{rank.label}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>登録数 {totalKits}</span>
        {kits.some(k => k.jan) && (
          priceLoading ? (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                </path>
              </svg>
              <span style={{ fontSize: 10, color: "#1d4ed8" }}>
                取得中 {priceProgress.current}/{priceProgress.total}件...
              </span>
            </div>
          ) : (
            <button
              style={{ marginLeft: "auto", fontSize: 10, padding: "2px 8px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 20, cursor: "pointer" }}
              onClick={async () => {
                const targets = kits.filter(k => k.jan);
                const alreadyHave = targets.filter(k => k.retailPrice).length;
                const msg = alreadyHave > 0
                  ? `登録中の全${targets.length}件のキットの希望小売価格を上書き取得します。\n（うち${alreadyHave}件はすでに価格が設定されています）\n\n※キット数によっては数分かかります。完了まで画面を閉じないでください。\n※ボタンを連続して押さないでください。\n\nよろしいですか？`
                  : `登録中の全${targets.length}件のキットの希望小売価格を取得します。\n\n※キット数によっては数分かかります。完了まで画面を閉じないでください。\n※ボタンを連続して押さないでください。\n\nよろしいですか？`;
                if (!window.confirm(msg)) return;
                setPriceLoading(true);
                setPriceProgress({ current: 0, total: targets.length });
                let updated = 0;
                for (let i = 0; i < targets.length; i++) {
                  const kit = targets[i];
                  setPriceProgress({ current: i + 1, total: targets.length });
                  try {
                    // JANがあればJANで、なければ商品名で検索
                    const url = kit.jan
                      ? `/api/price?jan=${kit.jan}`
                      : `/api/price?jan=00000000&name=${encodeURIComponent(kit.name?.slice(0,30)||"")}`;
                    const r = await fetch(url);
                    const d = await r.json();
                    if (d.price) {
                      setKits(prev => prev.map(k => k.id === kit.id ? { ...k, retailPrice: String(d.price) } : k));
                      updated++;
                    } else {
                      // 取得できなかった場合：既存のretailPriceは消さない（手動入力値を守る）
                    }
                  } catch {}
                  await new Promise(r => setTimeout(r, 350));
                }
                setPriceLoading(false);
                setPriceProgress({ current: 0, total: 0 });
                alert(`希望小売価格を更新しました：${updated}/${targets.length}件\n（取得できなかった${targets.length - updated}件は変更されていません）`);
              }}>
              💴 定価を一括取得（全{kits.filter(k => k.jan).length}件）
            </button>
          )
        )}
      </div>

      {showSearch && !bulkMode && (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "10px 16px" }}>
          <input autoFocus
            style={{ width: "100%", padding: "8px 12px", border: "1.5px solid #4f8ef7", borderRadius: 10, fontSize: 14, background: "#fafafa", outline: "none", boxSizing: "border-box" }}
            placeholder="キット名・シリーズで検索..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
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
      {/* 積みプラ総額バー（表示/非表示切替可） */}
      {!bulkMode && (
        <div style={{ background: "#fff", borderBottom: "1px solid #f0f0f0", padding: "6px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>💴 積みプラ総額</span>
              {showPriceTotal && totalPrice > 0 && (
                <>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#ef4444" }}>¥{pendingPrice.toLocaleString()}</span>
                  {done > 0 && <span style={{ fontSize: 10, color: "#9ca3af" }}>（完成含む ¥{totalPrice.toLocaleString()}）</span>}
                </>
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
      )}

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
              <option value="custom">手動順</option>
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
          </div>
        )}
        {viewMode === "grid" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {filtered.map((kit) => (
              <div key={kit.id} style={{ borderRadius: 10, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", cursor: "pointer", position: "relative" }} onClick={() => setDetail(kit)}>
                {kit.photoUrl
                  ? <img src={kit.photoUrl} style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", display: "block" }} alt="" />
                  : <div style={{ width: "100%", aspectRatio: "1/1", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>📦</div>
                }
                <div style={{ padding: "6px 6px 8px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#111", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.3 }}>{kit.name}</div>
                  {kit.scale && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{kit.scale}</div>}
                </div>
                {kit.completed && <div style={{ position: "absolute", top: 6, right: 6, background: "#22c55e", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", fontWeight: 700 }}>✓</div>}
              </div>
            ))}
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
<div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>タグ名タップ→選択キットに追加 ／ −→選択キットから削除 ／ 🗑→一覧から削除</div>
                {bulkSelected.size === 0 && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6 }}>⚠ タグ名タップはキット選択後に有効になります</div>}
                {allExistingTags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                    {allExistingTags.map(t => (
                      <BulkTagBadge key={t} tag={t}
                        onApply={() => handleBulkApplyTag(t)}
                        onRemove={() => handleBulkRemoveTag(t)}
                        onDeleteMaster={() => handleRemoveFromTagMaster(t)} />
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
        {viewMode === "list" && filtered.map((kit, index) => (
          <div key={kit.id} style={{ ...s.card, ...(bulkMode && bulkSelected.has(kit.id) ? { border: "2px solid #4f8ef7", background: "#eff6ff" } : {}) }} onClick={() => {
            if (bulkMode) { setBulkSelected(prev => { const n = new Set(prev); n.has(kit.id) ? n.delete(kit.id) : n.add(kit.id); return n; }); return; }
            if (!reorderMode) setDetail(kit);
          }}>
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
            {kit.photoUrl ? <img src={kit.photoUrl} style={s.thumb} alt="" /> : <div style={s.thumbPh}>📦</div>}
            <div style={s.cardBody}>
              <div style={s.cardName}>{kit.name}</div>
              <div style={s.cardMeta}>
                {kit.series && <span>{kit.series}</span>}
                {kit.scale && <span style={s.badge}>{kit.scale}</span>}
                {kit.tags?.length > 0 && kit.tags.map(tag => (
                  <span key={tag} style={{ background: "#f0fdf4", color: "#166534", borderRadius: 20, padding: "1px 7px", fontSize: 10, fontWeight: 600 }}>#{tag}</span>
                ))}
              </div>
              <div style={s.cardBottom}>
                {kit.rating > 0 && <span style={s.stars}>{"★".repeat(kit.rating)}{"☆".repeat(5 - kit.rating)}</span>}
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
            </div>
            <button style={{ ...s.checkBtn, background: kit.completed ? "#22c55e" : "#e5e7eb", color: kit.completed ? "#fff" : "#9ca3af" }}
              onClick={(e) => { e.stopPropagation(); toggleComplete(kit.id); }}>✓</button>
          </div>
        ))}
      </div>

      {/* フッター */}
      <div style={{ textAlign: "center", padding: "16px 20px 100px", borderTop: "1px solid #f0f0f0" }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
          <button style={{ background: "none", border: "none", fontSize: 11, color: "#9ca3af", cursor: "pointer", textDecoration: "underline" }} onClick={() => setShowLegal("privacy")}>プライバシーポリシー</button>
          <button style={{ background: "none", border: "none", fontSize: 11, color: "#9ca3af", cursor: "pointer", textDecoration: "underline" }} onClick={() => setShowLegal("terms")}>利用規約</button>
        </div>
      </div>

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
          <button style={{ ...s.fab, background: "#111" }} onClick={() => { setForm(emptyForm); setEditId(null); setShowForm(true); }}>＋</button>
        </div>
      </div>

      {detail && (
        <div style={s.overlay} onClick={() => setDetail(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            {(detail.completedPhotoUrl || detail.photoUrl) && (
              <img src={detail.completedPhotoUrl || detail.photoUrl} style={s.modalPhoto} alt="" />
            )}
            <div style={s.modalBody}>
              <div style={s.modalTitle}>{detail.name}</div>
              {detail.completed && <div style={s.doneBadge}>✓ 完成済み</div>}
              <table style={s.table}><tbody>
                {[["シリーズ", detail.series], ["スケール", detail.scale], ["希望小売価格", (() => { const ep = getEffectivePrice(detail); return ep > 0 ? `¥${ep.toLocaleString()}（税込）` : null; })()], ["購入日", detail.purchaseDate ? formatDate(detail.purchaseDate) : null], ["個数", detail.count > 1 ? `${detail.count}個` : null], ["合計金額", (() => { const ep = getEffectivePrice(detail); const cnt = detail.count || 1; return ep > 0 && cnt > 1 ? `¥${(ep*cnt).toLocaleString()}（${cnt}個×¥${ep.toLocaleString()}）` : null; })()], ["評価", detail.rating > 0 ? "★".repeat(detail.rating) + "☆".repeat(5 - detail.rating) : null], ["状態", detail.condition ? (detail.conditionNote ? `${detail.condition}（${detail.conditionNote}）` : detail.condition) : null], ["JAN", detail.jan], ["メモ", detail.memo]]
                  .filter(([, v]) => v && v !== "—")
                  .map(([k, v]) => <tr key={k}><td style={s.td1}>{k}</td><td style={s.td2}>{v}</td></tr>)}
              </tbody></table>
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
                <button style={s.wantBtn} onClick={() => handleWant(detail)}>
                  🙋 これを作ってくれる人に譲りたい！とポストする
                </button>
              )}
              {detail.jan && (
                <button
                  style={{ width: "100%", marginTop: 8, padding: "8px 0", background: "#eff6ff", color: "#1d4ed8", border: "1.5px solid #bfdbfe", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  onClick={async () => {
                    const r = await fetch(`/api/price?jan=${detail.jan}`);
                    const d = await r.json();
                    if (d.price) {
                      setKits(prev => prev.map(k => k.id === detail.id ? { ...k, retailPrice: String(d.price) } : k));
                      setDetail(prev => ({ ...prev, retailPrice: String(d.price) }));
                      alert(`希望小売価格を更新しました：¥${d.price.toLocaleString()}`);
                    } else {
                      alert("希望小売価格を取得できませんでした。手動で入力してください。");
                    }
                  }}>
                  🔄 希望小売価格を再取得
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
                      {k.photoUrl && <img src={k.photoUrl} style={{ width: 30, height: 30, borderRadius: 4, objectFit: "cover" }} alt="" />}
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
            <HelpModal onClose={() => setShowHelp(false)} />
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

      {showLegal && (
        <div style={s.overlay} onClick={() => setShowLegal(null)}>
          <div style={{ width: "100%", maxWidth: 480, overflowX: "hidden", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
            <LegalModal type={showLegal} onClose={() => setShowLegal(null)} />
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

            <label style={s.label}>スケール</label>
            <select style={s.input} value={form.scale} onChange={(e) => setForm((f) => ({ ...f, scale: e.target.value }))}>
              <option value="">選択してください</option>
              {SCALE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>

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
                {form.photoUrl ? <img src={form.photoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} alt="" />
                  : <span style={{ color: "#9ca3af", fontSize: 14 }}>📷 タップして写真を選択</span>}
              </div>
              {form.photoUrl && (
                <button style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={(e) => { e.stopPropagation(); setForm((f) => ({ ...f, photoUrl: "", photo: null })); }}>✕</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />

            <label style={s.label}>完成品の写真</label>
            <div style={{ position: "relative" }}>
              <div style={{ ...s.photoArea, borderColor: form.completedPhotoUrl ? "#22c55e" : "#d1d5db" }} onClick={() => completedFileRef.current.click()}>
                {form.completedPhotoUrl ? <img src={form.completedPhotoUrl} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} alt="" />
                  : <span style={{ color: "#9ca3af", fontSize: 14 }}>🏆 完成したら写真を登録</span>}
              </div>
              {form.completedPhotoUrl && (
                <button style={{ position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={(e) => { e.stopPropagation(); setForm((f) => ({ ...f, completedPhotoUrl: "" })); }}>✕</button>
              )}
            </div>
            <input ref={completedFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleCompletedPhoto} />

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

            <div style={{ height: 80 }} />
            <div style={{ position: "sticky", bottom: 0, background: "#fff", paddingTop: 10, paddingBottom: 16, marginTop: 8, borderTop: "1px solid #f0f0f0", display: "flex", gap: 10 }}>
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
  root: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: "#f8f9fa", fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif", paddingBottom: 120 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 20px 14px", background: "#fff", borderBottom: "1px solid #f0f0f0" },
  headerTitle: { fontSize: 15, fontWeight: 700, color: "#111", letterSpacing: 1 },
  headerSub: { fontSize: 8, color: "#aaa", letterSpacing: 2, marginTop: 1 },
  shareBtn: { background: "#000", color: "#fff", border: "none", borderRadius: 20, padding: "8px 12px", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  searchIconBtn: { background: "#f3f4f6", border: "none", borderRadius: 20, padding: "8px 12px", fontSize: 16, cursor: "pointer" },
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
  modalPhoto: { width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "20px 20px 0 0" },
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
