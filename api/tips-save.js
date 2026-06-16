// api/tips-save.js
//
// 管理ツール（admin.html）の「TIPS編集」タブから呼ばれる。
// 編集後の TIPS 記事HTMLを GitHub Contents API 経由で main ブランチへコミットし、
// Vercel の自動再デプロイで本番へ反映する。
//
// セキュリティ:
//   - admin.html はクライアント側でしかパスワードを見ていない（公開ファイル）ため、
//     ここでは「サーバー側シークレット（TIPS_EDIT_SECRET）」で保護する。
//   - 書き込み先パスは public/tips/*.html に限定（任意ファイル書き換えを防止）。
//
// 必要な環境変数（Vercel）:
//   GITHUB_TOKEN     ... 対象リポジトリの Contents: read/write 権限を持つトークン
//   TIPS_EDIT_SECRET ... 保存時に入力する合言葉（admin側のフォームで入力）
//   GITHUB_REPO      ... 省略時 "take35-jp/tsumitsumi"
//   GITHUB_BRANCH    ... 省略時 "main"

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const TOKEN = process.env.GITHUB_TOKEN;
  const SECRET = process.env.TIPS_EDIT_SECRET;
  const REPO = process.env.GITHUB_REPO || "take35-jp/tsumitsumi";
  const BRANCH = process.env.GITHUB_BRANCH || "main";

  if (!TOKEN || !SECRET) {
    return res.status(500).json({ error: "サーバー側に GITHUB_TOKEN / TIPS_EDIT_SECRET が未設定です（Vercelの環境変数を確認してください）" });
  }

  const { path, content, secret, message } = req.body || {};

  if (!secret || secret !== SECRET) {
    return res.status(401).json({ error: "合言葉（シークレット）が違います" });
  }
  // 書き込み先は public/tips/ 配下の .html のみ許可
  if (typeof path !== "string" || !/^public\/tips\/[A-Za-z0-9_-]+\.html$/.test(path)) {
    return res.status(400).json({ error: "保存先パスが不正です（public/tips/◯◯.html のみ許可）" });
  }
  if (typeof content !== "string" || content.length < 200) {
    return res.status(400).json({ error: "本文が短すぎます（誤操作防止のため200文字以上必要）" });
  }
  // 最低限の健全性チェック：記事HTMLの体裁を保っているか
  if (!/<\/article>/i.test(content) || !/<\/html>/i.test(content)) {
    return res.status(400).json({ error: "HTMLの構造が壊れています（</article> と </html> が必要）" });
  }

  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const ghHeaders = {
    Authorization: `Bearer ${TOKEN}`,
    "User-Agent": "tsumitsumi-admin",
    Accept: "application/vnd.github+json",
  };

  try {
    // 既存ファイルの sha を取得（更新には sha が必要）
    let sha;
    const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(BRANCH)}`, { headers: ghHeaders });
    if (getRes.ok) {
      const j = await getRes.json();
      sha = j.sha;
    } else if (getRes.status !== 404) {
      const ej = await getRes.json().catch(() => ({}));
      return res.status(getRes.status).json({ error: "既存ファイルの取得に失敗: " + (ej.message || getRes.status) });
    }

    const putBody = {
      message: (message && String(message).slice(0, 200)) || `content: TIPS記事を更新 (${path})`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: BRANCH,
    };
    if (sha) putBody.sha = sha; // 既存なら更新、無ければ新規作成

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(putBody),
    });
    const pj = await putRes.json();
    if (!putRes.ok) {
      return res.status(putRes.status).json({ error: "コミットに失敗: " + (pj.message || putRes.status) });
    }

    return res.status(200).json({
      ok: true,
      path,
      created: !sha,
      commitUrl: pj.commit && pj.commit.html_url,
      message: "コミットしました。Vercelの再デプロイ完了（約1〜2分）後に本番へ反映されます。",
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
