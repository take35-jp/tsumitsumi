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

  // 初回実行
  async function init() {
    await loadAll();
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
