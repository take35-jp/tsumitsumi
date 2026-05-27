// api/instagram-post.js
//
// Instagram 自動投稿（公式 Graph API）— Vercel cron で 1 日 1 回起動。
// instagram_queue テーブルから status='pending' を古い順に 1 件取り出し、
// Instagram Business / Creator アカウントへ写真を投稿する。
//
// ─────────────────────────────────────────────────────────────
// 必要な環境変数（Vercel → Settings → Environment Variables）
//   IG_USER_ID         Instagram Business/Creator アカウントID（数字の長い値）
//   IG_ACCESS_TOKEN    長期アクセストークン（Graph API・要 instagram_content_publish）
//   SUPABASE_URL       （既存）
//   SUPABASE_ANON_KEY  （既存。SUPABASE_SERVICE_KEY があればそちらを優先）
//   CRON_SECRET        （推奨）トリガー保護用の秘密キー。設定すると cron 以外からの
//                      手動起動は ?key=<CRON_SECRET> か Authorization: Bearer <CRON_SECRET> が必須
//   IG_GRAPH_VERSION   （任意）既定 v21.0
//
// ─────────────────────────────────────────────────────────────
// Supabase テーブル定義（Supabase SQL Editor で一度だけ実行）
//
//   create table if not exists instagram_queue (
//     id          bigserial primary key,
//     image_url   text not null,
//     caption     text,
//     status      text not null default 'pending',  -- pending / posting / posted / failed
//     scheduled_at timestamptz,                       -- この日時以降に投稿（null=即時）
//     posted_at   timestamptz,
//     ig_media_id text,
//     error       text,
//     created_at  timestamptz not null default now(),
//     updated_at  timestamptz not null default now()
//   );
//   alter table instagram_queue enable row level security;
//   -- 既存テーブル(products/price_reports)と同じく anon に許可（admin.html が anon キーで操作）
//   create policy ig_anon_all on instagram_queue for all to anon using (true) with check (true);
//
// ─────────────────────────────────────────────────────────────
// Graph API 投稿フロー（画像 1 枚）
//   ① POST /{IG_USER_ID}/media          image_url, caption    → コンテナ id を取得
//   ② POST /{IG_USER_ID}/media_publish  creation_id           → 公開して media id を取得
// ※ 画像は JPEG 推奨。Instagram が image_url を外部から取得するため公開URL必須。

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const IG_USER_ID = process.env.IG_USER_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;
const GRAPH_VERSION = process.env.IG_GRAPH_VERSION || "v21.0";

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

async function patchItem(id, patch, filterPending) {
  const filter = filterPending ? "&status=eq.pending" : "";
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_queue?id=eq.${id}${filter}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: filterPending ? "return=representation" : "return=minimal" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  );
  return r;
}

async function markFailed(id, msg) {
  try {
    await patchItem(id, { status: "failed", error: String(msg).slice(0, 1000) }, false);
  } catch (_) {
    // 失敗記録自体のエラーは握りつぶす
  }
}

export default async function handler(req, res) {
  // ── トリガー保護 ──
  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    const key = req.query.key || "";
    if (auth !== `Bearer ${CRON_SECRET}` && key !== CRON_SECRET) {
      return res.status(401).json({ error: "unauthorized" });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: "supabase env missing" });
  }
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) {
    return res.status(500).json({ error: "instagram env missing (IG_USER_ID / IG_ACCESS_TOKEN)" });
  }

  try {
    // ── 次の投稿対象を取得（FIFO・scheduled_at が未来のものはスキップ） ──
    const listUrl =
      `${SUPABASE_URL}/rest/v1/instagram_queue` +
      `?status=eq.pending&select=*&order=created_at.asc&limit=50`;
    const r = await fetch(listUrl, { headers: sbHeaders });
    if (!r.ok) throw new Error(`queue fetch HTTP ${r.status}`);
    const rows = await r.json();

    const now = Date.now();
    const item = (Array.isArray(rows) ? rows : []).find(
      (x) => !x.scheduled_at || new Date(x.scheduled_at).getTime() <= now
    );
    if (!item) {
      return res.status(200).json({ ok: true, message: "no_pending_item" });
    }

    // ── 楽観ロック：pending のまま残っている時だけ posting に確保（二重投稿防止） ──
    const lock = await patchItem(item.id, { status: "posting" }, true);
    const locked = await lock.json().catch(() => []);
    if (!Array.isArray(locked) || locked.length === 0) {
      return res.status(200).json({ ok: true, message: "item_already_taken" });
    }

    // ── ① コンテナ作成 ──
    const createBody = new URLSearchParams({
      image_url: item.image_url,
      access_token: IG_ACCESS_TOKEN,
    });
    if (item.caption) createBody.set("caption", item.caption);
    const cr = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}/media`,
      { method: "POST", body: createBody }
    );
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok || !cj.id) {
      await markFailed(item.id, `container: ${JSON.stringify(cj.error || cj)}`);
      return res.status(502).json({ ok: false, step: "create_container", error: cj.error || cj });
    }

    // ── ② 公開 ──
    const publishBody = new URLSearchParams({
      creation_id: cj.id,
      access_token: IG_ACCESS_TOKEN,
    });
    const pr = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${IG_USER_ID}/media_publish`,
      { method: "POST", body: publishBody }
    );
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok || !pj.id) {
      await markFailed(item.id, `publish: ${JSON.stringify(pj.error || pj)}`);
      return res.status(502).json({ ok: false, step: "publish", error: pj.error || pj });
    }

    // ── 成功 ──
    await patchItem(
      item.id,
      { status: "posted", ig_media_id: pj.id, posted_at: new Date().toISOString(), error: null },
      false
    );
    return res.status(200).json({ ok: true, posted_id: item.id, ig_media_id: pj.id });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
