const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { page = "1", q = "" } = req.query;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = 20;
  const offset = (pageNum - 1) * pageSize;

  try {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "count=exact",
    };

    const params = new URLSearchParams();
    params.append("select", "id,name,jan,retail_price,series,scale,image_url");

    if (q && q.trim()) {
      const keywords = q.trim().split(/\s+/).filter(Boolean);
      if (keywords.length === 1) {
        params.append("name", `ilike.*${keywords[0]}*`);
      } else if (keywords.length > 1) {
        const andClause = keywords.map(kw => `name.ilike.*${kw}*`).join(",");
        params.append("and", `(${andClause})`);
      }
    }

    params.append("order", "name.asc");
    params.append("limit", String(pageSize));
    params.append("offset", String(offset));

    const url = `${SUPABASE_URL}/rest/v1/products?${params.toString()}`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: "Supabase query failed", detail: errText });
    }

    const contentRange = response.headers.get("content-range") || "";
    const totalMatch = contentRange.match(/\/(\d+)$/);
    const total = totalMatch ? parseInt(totalMatch[1]) : 0;

    const items = await response.json();

    return res.status(200).json({
      items: Array.isArray(items) ? items : [],
      total,
      page: pageNum,
      pageSize,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
