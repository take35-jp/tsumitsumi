// api/brand-tools-save.js
//
// 管理ツール（admin.html）の「ブランド特集」タブから呼ばれる。
// 手動で並び替えた public/brand-tools.json を GitHub Contents API 経由で main へコミットし、
// Vercel の自動再デプロイで本番へ反映する。
//
// セキュリティ:
//   - admin.html は公開ファイルのため、サーバー側シークレット（TIPS_EDIT_SECRET）で保護。
//   - 書き込み先は public/brand-tools.json に固定。
//
// 必要な環境変数（Vercel）: GITHUB_TOKEN / TIPS_EDIT_SECRET（tips-save と共用）
//   GITHUB_REPO（省略時 take35-jp/tsumitsumi）/ GITHUB_BRANCH（省略時 main）

export const config = { runtime: "nodejs" };

const TARGET_PATH = "public/brand-tools.json";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO || "take35-jp/tsumitsumi";
  const BRANCH = process.env.GITHUB_BRANCH || "main";

  if (!TOKEN) {
    return res.status(500).json({ error: "サーバー側に GITHUB_TOKEN が未設定です（Vercelの環境変数を確認してください）" });
  }

  // 合言葉は廃止（運営者の要望）。書込先は public/brand-tools.json 固定＋JSON妥当性チェックで保護。
  const { content, message } = req.body || {};
  if (typeof content !== "string") {
    return res.status(400).json({ error: "content（JSON文字列）が必要です" });
  }
  // JSON として妥当か＆brands 配列を持つかを検証（壊れたデータのコミットを防止）
  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { return res.status(400).json({ error: "JSONとして不正です: " + e.message }); }
  if (!parsed || !Array.isArray(parsed.brands)) {
    return res.status(400).json({ error: "brands 配列がありません" });
  }
  for (const b of parsed.brands) {
    if (!b || typeof b.key !== "string" || !Array.isArray(b.items)) {
      return res.status(400).json({ error: "各ブランドは key と items（配列）を持つ必要があります" });
    }
  }

  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${TARGET_PATH}`;
  const ghHeaders = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "tsumitsumi-admin", Accept: "application/vnd.github+json" };

  try {
    let sha;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(BRANCH)}`, { headers: ghHeaders });
    if (getRes.ok) { sha = (await getRes.json()).sha; }
    else if (getRes.status !== 404) {
      const ej = await getRes.json().catch(() => ({}));
      return res.status(getRes.status).json({ error: "既存ファイルの取得に失敗: " + (ej.message || getRes.status) });
    }

    const putBody = {
      message: (message && String(message).slice(0, 200)) || "chore(brand): ブランド特集の並び順を手動更新（admin）",
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: BRANCH,
    };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(putBody),
    });
    const pj = await putRes.json();
    if (!putRes.ok) return res.status(putRes.status).json({ error: "コミットに失敗: " + (pj.message || putRes.status) });

    return res.status(200).json({
      ok: true,
      commitUrl: pj.commit && pj.commit.html_url,
      message: "コミットしました。Vercel再デプロイ（約1〜2分）後に本番へ反映されます。",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
