// api/dedup-master.js
// SupabaseのproductsテーブルのJAN重複を統合する
// GET /api/dedup-master?dry=1

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

export default async function handler(req, res) {
  const dry = req.query.dry === "1";
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    // JANがある全レコードを取得（id昇順 = 古い順）
    let allProducts = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/products?select=id,jan,name,image_url,series,scale&jan=not.is.null&jan=neq.&limit=${batchSize}&offset=${offset}&order=id.asc`,
        { headers }
      );
      const batch = await r.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      allProducts = allProducts.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    // JAN別にグループ化
    const janMap = {};
    for (const p of allProducts) {
      if (!janMap[p.jan]) janMap[p.jan] = [];
      janMap[p.jan].push(p);
    }

    // 重複があるJANを抽出
    const duplicates = Object.entries(janMap).filter(([, items]) => items.length > 1);

    if (dry) {
      const samples = duplicates.slice(0, 10).map(([jan, items]) => ({
        jan,
        count: items.length,
        keep: items[0].id,
        delete: items.slice(1).map(i => i.id),
        names: items.map(i => i.name.slice(0, 40)),
      }));
      return res.status(200).json({
        totalProducts: allProducts.length,
        uniqueJans: Object.keys(janMap).length,
        duplicateJans: duplicates.length,
        willDelete: duplicates.reduce((s, [, items]) => s + items.length - 1, 0),
        samples,
      });
    }

    // 重複を削除（最初のレコード=古いものを残す、image_urlがあれば優先）
    let deleted = 0;
    for (const [, items] of duplicates) {
      // image_urlがあるものを優先して残す
      const sorted = [...items].sort((a, b) => {
        if (a.image_url && !b.image_url) return -1;
        if (!a.image_url && b.image_url) return 1;
        return a.id - b.id; // 古い順
      });
      const keep = sorted[0];
      const toDelete = sorted.slice(1);

      for (const p of toDelete) {
        await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${p.id}`, {
          method: "DELETE", headers,
        });
        deleted++;
      }
    }

    return res.status(200).json({
      totalProducts: allProducts.length,
      duplicateJans: duplicates.length,
      deleted,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
