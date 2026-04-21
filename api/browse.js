// ガンプラ一覧API - Supabase DBから直接検索（Yahoo API不使用）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// ガンプラのグレード判定キーワード（商品名に含まれることを期待）
const GRADE_PATTERNS = {
      "PG": /\bPG\b/i,
      "MGEX": /\bMGEX\b/i,
      "MGSD": /\bMGSD\b/i,
      "MG": /\bMG\b/i,
      "RG": /\bRG\b/i,
      "HG": /\bHG\b/i,
      "EG": /\bEG\b|ENTRY\s*GRADE/i,
      "SD": /\bSD\b|SDW|SDCS|SDEX|BB\s*戦士/i,
      "FM": /\bFM\b|フルメカニクス/i,
      "RE": /\bRE\/100\b|\bRE\b/i,
};

export default async function handler(req, res) {
      res.setHeader("Access-Control-Allow-Origin", "*");

  const { grade, page = "1", q = "" } = req.query;
      if (!grade) return res.status(400).json({ error: "grade required" });
      if (!GRADE_PATTERNS[grade]) return res.status(400).json({ error: "invalid grade" });
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
              return res.status(500).json({ error: "Supabase not configured" });
      }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = 20;
      const offset = (pageNum - 1) * pageSize;

  try {
          // バンダイ商品のみ取得（ガンプラに限定）
        const headers = {
                  apikey: SUPABASE_ANON_KEY,
                  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                  Prefer: "count=exact",
        };

        // パラメータ作成: バンダイメーカー + 名前にqueryを含む
        const params = new URLSearchParams();
          params.append("select", "id,name,jan,retail_price,series,scale,image_url");
          params.append("maker", "eq.バンダイ");
          if (q && q.trim()) {
                    params.append("name", `ilike.*${encodeURIComponent(q.trim())}*`);
          }
          params.append("order", "name.asc");

        const url = `${SUPABASE_URL}/rest/v1/products?${params.toString()}`;
          const response = await fetch(url, { headers });
          if (!response.ok) {
                    return res.status(500).json({ error: "Supabase query failed", status: response.status });
          }

        const all = await response.json();

        // グレード判定（他のグレードにマッチするものは除外して厳密化）
        const gradePattern = GRADE_PATTERNS[grade];
          const filtered = all.filter(item => {
                    if (!item.name) return false;
                    // HGはHGUC, HGBF等の下位マッチを除外
                                            if (grade === "HG") {
                                                        const name = item.name;
                                                        // HGUC等にマッチするものはHG単体では除外
                      if (/HGUC|HGBF|HGBC|HGBD|HGCE|HGAC|HGTB|HGIBO|HGBM|HGBG/i.test(name)) return false;
                                                        return /\bHG\b/i.test(name);
                                            }
                    // MGはMGEX, MGSDを除外
                                            if (grade === "MG") {
                                                        const name = item.name;
                                                        if (/MGEX|MGSD/i.test(name)) return false;
                                                        return /\bMG\b/i.test(name);
                                            }
                    // その他は単純マッチ
                                            return gradePattern.test(item.name);
          });

        const total = filtered.length;
          const paged = filtered.slice(offset, offset + pageSize);

        const items = paged.map(item => ({
                  id: item.id,
                  name: item.name,
                  jan: item.jan,
                  retailPrice: item.retail_price || 0,
                  series: item.series || "",
                  scale: item.scale || "",
                  imageUrl: item.image_url || "",
                  grade: grade,
        }));

        return res.status(200).json({
                  items,
                  total,
                  page: pageNum,
                  pageSize,
                  totalPages: Math.ceil(total / pageSize),
        });
  } catch (e) {
          return res.status(500).json({ error: e.message });
  }
}
