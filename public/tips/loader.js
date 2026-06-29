/* TIPS記事・PAINT GUIDE・TOPCOAT GUIDEの商品カードに、
   gears_catalog または asin_map のデータから
   画像・価格・Amazon ASIN 直リンクを注入する共通スクリプト。

   使い方:
     <div class="product"      data-product-id="...">   ← gears_catalog の id を指定
     <div class="paint-card"   data-product-id="...">   ← asin_map の key と一致
     <div class="pc"           data-product-id="...">   ← 同上

   再レンダリング後に再適用したい場合:
     document.dispatchEvent(new CustomEvent('tsumitsumi:cards-rendered'));
*/
(function () {
  const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";
  const ASSOCIATE_TAG = "tsumitsumi232-22";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function buildAsinUrl(asin) {
    return `https://www.amazon.co.jp/dp/${encodeURIComponent(asin)}/?tag=${encodeURIComponent(ASSOCIATE_TAG)}`;
  }
  function buildSearchUrl(q) {
    return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q || "")}&tag=${encodeURIComponent(ASSOCIATE_TAG)}`;
  }

  // ---- データソース ----
  let gearsMap = null;  // { id -> gears product }
  let asinMap  = null;  // { key -> asin_map row }
  let loadPromise = null;

  async function fetchGears() {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gears_catalog?id=eq.main&select=data`, {
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
        cache: "no-store",
      });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].data) return rows[0].data;
      }
    } catch (e) {}
    try {
      const r = await fetch("/gears.json?ts=" + Date.now());
      if (r.ok) return await r.json();
    } catch (e) {}
    return null;
  }

  async function fetchAsinMap() {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/asin_map?select=key,asin,title,image_url,price`, {
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
        cache: "no-store",
      });
      if (r.ok) {
        const rows = await r.json();
        const m = {};
        for (const row of rows) m[row.key] = row;
        return m;
      }
    } catch (e) {}
    return {};
  }

  async function loadAll() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const [gearsData, asinData] = await Promise.all([fetchGears(), fetchAsinMap()]);
      const gMap = {};
      if (gearsData) {
        (gearsData.sections || []).forEach(s => {
          (s.products || []).forEach(p => { gMap[p.id] = p; });
        });
      }
      gearsMap = gMap;
      asinMap  = asinData || {};
    })();
    return loadPromise;
  }

  // ---- カードクラスごとの設定 ----
  const CARD_CONFIGS = [
    // TIPS記事用（旧来）
    {
      cardSel:  ".product",
      linkSel:  ".product-link",
      thumbSel: ".product-thumb-slot",
      priceSel: ".product-price-slot",
      priceWrap: (s) => s + " ※Amazonで最新価格をご確認ください",
    },
    // PAINT GUIDE
    {
      cardSel:  ".paint-card",
      linkSel:  ".paint-amazon",
      thumbSel: ".paint-image",
      priceSel: ".paint-price",
      priceWrap: (s) => "¥" + s + " ※最新価格はAmazonで",
    },
    // TOPCOAT GUIDE
    {
      cardSel:  ".pc",
      linkSel:  ".pc-amazon",
      thumbSel: ".pc-image",
      priceSel: ".pc-price",
      priceWrap: (s) => "¥" + s + " ※最新価格はAmazonで",
    },
  ];

  function lookup(id) {
    // gears_catalog 優先（TIPS既存）→ なければ asin_map
    const g = gearsMap && gearsMap[id];
    if (g && g.asin) {
      return { asin: g.asin, image: g.image || null, price: g.price || null, title: g.name || "" };
    }
    const a = asinMap && asinMap[id];
    if (a && a.asin) {
      const priceStr = (a.price != null) ? Number(a.price).toLocaleString() : null;
      return { asin: a.asin, image: a.image_url || null, price: priceStr, title: a.title || "" };
    }
    return null;
  }

  function apply() {
    if (!gearsMap || !asinMap) return;
    for (const cfg of CARD_CONFIGS) {
      document.querySelectorAll(cfg.cardSel + "[data-product-id]").forEach(card => {
        const id = card.dataset.productId;
        const info = lookup(id);
        if (!info) return;

        const url = buildAsinUrl(info.asin);

        // リンクを ASIN 直リンクに上書き
        const linkEl = card.querySelector(cfg.linkSel);
        if (linkEl) linkEl.href = url;

        // サムネ画像
        if (info.image && cfg.thumbSel) {
          const thumb = card.querySelector(cfg.thumbSel);
          if (thumb) {
            thumb.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer sponsored" style="display:block;width:100%;height:100%;"><img src="${escapeHtml(info.image)}" alt="${escapeHtml(info.title)}" loading="lazy" style="width:100%;height:100%;object-fit:contain;" /></a>`;
          }
        }

        // 価格
        if (info.price && cfg.priceSel) {
          const slot = card.querySelector(cfg.priceSel);
          if (slot) {
            const text = cfg.priceWrap ? cfg.priceWrap(info.price) : info.price;
            slot.textContent = text;
            slot.style.display = "";
          }
        }
      });
    }
  }

  // Public API: paint/topcoat の render() から呼べる
  window.tsumitsumiApplyAsin = async function () {
    await loadAll();
    apply();
  };

  // カスタムイベント経由でも発火可能（paint/topcoat の render() が dispatch）
  document.addEventListener("tsumitsumi:cards-rendered", () => {
    loadAll().then(apply);
  });

  // ---- 関連アイテム（PR）ウィジェット ----
  // brand-tools.json（アフィリタグ付き工具）から、記事の見出しに関連する商品を表示。
  // 設置: 記事(<article>)があれば末尾に自動挿入。任意で <div id="tt-related-slot"></div> を置けばそこに表示。
  const REL_KEYWORDS = ["ニッパー", "ヤスリ", "やすり", "研磨", "スポンジ", "ペーパー", "デザインナイフ", "ナイフ", "替刃", "ピンセット", "接着", "セメント", "パテ", "マスキング", "スミ入れ", "墨入れ", "塗装", "塗料", "サーフェイサー", "トップコート", "筆", "電動", "リューター", "ペンサンダー", "持ち手", "クリップ", "コンテナ", "収納", "カッター", "ハサミ", "ピンバイス", "スジ彫り"];
  let brandItems = null;
  async function fetchBrandItems() {
    if (brandItems) return brandItems;
    brandItems = [];
    try {
      const r = await fetch("/brand-tools.json?ts=" + Date.now());
      if (r.ok) {
        const d = await r.json();
        (d.brands || []).forEach(b => (b.items || []).forEach(it => { if (it && it.asin) brandItems.push({ ...it, brand: b.name }); }));
      }
    } catch (e) {}
    return brandItems;
  }
  function pageKeywords() {
    const parts = [document.title || ""];
    document.querySelectorAll("h1,h2,h3").forEach(h => parts.push(h.textContent || ""));
    const text = parts.join(" ");
    return REL_KEYWORDS.filter(k => text.indexOf(k) !== -1);
  }
  async function injectRelatedItems() {
    if (document.getElementById("tt-related")) return;
    const slot = document.getElementById("tt-related-slot");
    const article = document.querySelector("article");
    if (!slot && !article) return;
    const items = await fetchBrandItems();
    if (!items.length) return;
    const kws = pageKeywords();
    const scored = items.map(it => { let s = 0; const t = it.title || ""; for (const k of kws) if (t.indexOf(k) !== -1) s++; return { it, s }; });
    const seen = new Set(); const out = [];
    scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s).forEach(x => { if (out.length < 6 && !seen.has(x.it.asin)) { seen.add(x.it.asin); out.push(x.it); } });
    if (out.length < 4) { for (const it of items) { if (out.length >= 6) break; if (!it.image || seen.has(it.asin)) continue; seen.add(it.asin); out.push(it); } }
    if (!out.length) return;

    const yen = (n) => (n == null ? "" : "¥" + Number(n).toLocaleString("ja-JP"));
    const cards = out.map(p => {
      const url = (p.url && /tag=/.test(p.url)) ? p.url : buildSearchUrl(p.title);
      const img = p.image
        ? `<div style="height:110px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="${escapeHtml(p.image)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain;"></div>`
        : `<div style="height:110px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:26px;">🛠</div>`;
      const price = p.price != null ? `<div style="font-size:13px;font-weight:800;color:#b91c1c;margin-top:4px;">${escapeHtml(yen(p.price))}<span style="font-size:9px;color:#9ca3af;font-weight:400;"> 税込・変動あり</span></div>` : `<div style="font-size:10px;color:#9ca3af;margin-top:4px;">価格はAmazonで確認</div>`;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow sponsored noopener" style="display:block;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;text-decoration:none;color:#111827;background:#fff;">
        ${img}
        <div style="padding:8px 10px 10px;">
          <div style="font-size:12px;line-height:1.4;font-weight:700;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">${escapeHtml(p.title)}</div>
          ${price}
          <div style="margin-top:6px;font-size:11px;font-weight:700;color:#fff;background:#111;border-radius:6px;text-align:center;padding:5px 0;">Amazonで見る →</div>
        </div>
      </a>`;
    }).join("");

    const box = document.createElement("section");
    box.id = "tt-related";
    box.style.cssText = "max-width:820px;margin:40px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',Meiryo,sans-serif;";
    box.innerHTML = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 12px;">
        <h2 style="font-size:17px;font-weight:800;margin:0;padding-left:10px;border-left:4px solid #f59e0b;">関連アイテム<span style="font-size:11px;color:#9ca3af;font-weight:600;margin-left:6px;">PR</span></h2>
        <a href="/gears.html" target="_blank" rel="noopener" style="font-size:12px;color:#15803d;text-decoration:none;font-weight:600;white-space:nowrap;">定番アイテム →</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">${cards}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:10px;line-height:1.6;">※ Amazonアソシエイトのリンクを含みます。価格・在庫はAmazonの最新情報をご確認ください。</div>`;
    if (slot) slot.appendChild(box);
    else article.insertAdjacentElement("afterend", box);
  }

  // 初回実行
  async function init() {
    await loadAll();
    apply();
    injectRelatedItems();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
