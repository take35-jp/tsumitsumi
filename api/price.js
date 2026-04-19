// api/price.js - v9（マスタ格納方式）
//
// 設計：
//   retail_price はマスタDB（products.retail_price）に格納済み。
//   このAPIはマスタから読むだけ。シンプル・高速・正確。
//
// 取得フロー:
//   JANでSupabaseのretail_priceを引く → 返す
//   未設定の場合はnull（update-prices.jsで事前に格納する）

const SUPABASE_URL = "https://oxtfwmcdtngvicrcjyue.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94dGZ3bWNkdG5ndmljcmNqeXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwMjE2MzMsImV4cCI6MjA5MTU5NzYzM30.ErodQvDmHyBiZuosHAFHWgFutznCreiS4Npx7XFcqtc";

export default async function handler(req, res) {
  const jan = (req.query.jan || "").trim();
  if (!jan || jan.length < 8) return res.status(400).json({ error: "jan required" });

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?jan=eq.${jan}&select=name,retail_price&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await r.json();
    const product = data?.[0];

    if (!product) {
      return res.status(200).json({ jan, price: null, priceStr: null, source: null, message: "not_in_master" });
    }

    const price = product.retail_price || null;
    return res.status(200).json({
      jan,
      price,
      priceStr: price ? `¥${price.toLocaleString("ja-JP")}` : null,
      source: price ? "master" : null,
      message: price ? null : "no_price_in_master",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
