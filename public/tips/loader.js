/* TIPS 記事の商品カードに、おすすめ定番アイテム（gears_catalog）の
   画像・価格・ASIN直リンクを注入する共有スクリプト。

   使い方：
     <div class="product" data-product-id="nipper-1">
       <div class="product-thumb-slot">📦</div>
       ...
       <div class="product-price-slot" style="display:none"></div>
       <a class="product-link" href="<フォールバックURL>">🛒 Amazonで見る</a>
     </div>

   id がマッチすれば
     - thumb-slot に <img> を差し込み
     - price-slot に価格テキストを設定 + display 解除
     - product-link を ASIN直リンク（あれば）に書き換え
   マッチしなければ何もせず、HTMLに書かれたフォールバックがそのまま使われる。
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

  function buildUrl(p) {
    const tag = encodeURIComponent(ASSOCIATE_TAG);
    return p.asin
      ? `https://www.amazon.co.jp/dp/${encodeURIComponent(p.asin)}/?tag=${tag}`
      : `https://www.amazon.co.jp/s?k=${encodeURIComponent(p.amazonQuery || p.name || "")}&tag=${tag}`;
  }

  async function fetchGears() {
    // Supabase 優先、ダメなら静的JSONフォールバック
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

  async function init() {
    const data = await fetchGears();
    if (!data) return;
    const productMap = {};
    (data.sections || []).forEach(s => {
      (s.products || []).forEach(p => { productMap[p.id] = p; });
    });

    document.querySelectorAll(".product[data-product-id]").forEach(card => {
      const id = card.dataset.productId;
      const p = productMap[id];
      if (!p) return; // 未登録ならフォールバックを維持

      const url = buildUrl(p);

      // サムネ画像（クリックでAmazonへ）
      if (p.image) {
        const slot = card.querySelector(".product-thumb-slot");
        if (slot) {
          slot.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer sponsored" style="display:block;width:100%;height:100%;"><img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name || "")}" loading="lazy" style="width:100%;height:100%;object-fit:contain;" /></a>`;
        }
      }

      // 価格
      if (p.price) {
        const slot = card.querySelector(".product-price-slot");
        if (slot) {
          slot.textContent = p.price + " ※Amazonで最新価格をご確認ください";
          slot.style.display = "";
        }
      }

      // リンクをASIN直リンクに上書き
      const linkEl = card.querySelector(".product-link");
      if (linkEl) linkEl.href = url;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
