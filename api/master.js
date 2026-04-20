const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET");

  const { jan } = req.query;
    if (!jan) return res.status(400).json({ error: "jan required" });

  try {
        const url = `${SUPABASE_URL}/rest/v1/products?jan=eq.${encodeURIComponent(jan)}&limit=1`;
        const r = await fetch(url, {
                headers: {
                          "apikey": SUPABASE_ANON_KEY,
                          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
                }
        });
        const data = await r.json();
        const item = data?.[0];
        if (item) {
                return res.json({
                          name: item.name,
                          maker: item.maker || "",
                          series: item.series || "",
                          scale: item.scale || "",
                          image_url: item.image_url || "",
                          source: "master",
                });
        }
        return res.status(404).json({ error: "not found" });
  } catch (e) {
        return res.status(500).json({ error: String(e) });
  }
}
