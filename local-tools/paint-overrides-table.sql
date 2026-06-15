-- ============================================================
-- paint_overrides テーブル：塗料大全/トップコート大全の「非表示（欠番削除）」「名前上書き」を
-- 管理ツールから設定するためのオーバーレイ。元の静的データ(PAINTS/ITEMS)は変更せず、
-- ページ側がこのテーブルを読んで「隠す/改名」を適用する（可逆）。
--
-- 実行手順: Supabase Dashboard → SQL Editor に貼り付けて Run
-- セキュリティ: admin(password保護)の anon 書き込み前提（products/gears_catalog/asin_map と同等）
-- ============================================================

CREATE TABLE IF NOT EXISTS paint_overrides (
  key           text PRIMARY KEY,            -- makeKey(p, ns)  例: paint-gsi-xxxx / topcoat-gsi-xxxx
  hidden        boolean DEFAULT false,       -- true なら一覧から非表示（欠番削除）
  name_override text,                         -- 表示名の上書き（null なら元の名前）
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE paint_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read paint_overrides" ON paint_overrides;
CREATE POLICY "anon read paint_overrides"  ON paint_overrides FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon insert paint_overrides" ON paint_overrides;
CREATE POLICY "anon insert paint_overrides" ON paint_overrides FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon update paint_overrides" ON paint_overrides;
CREATE POLICY "anon update paint_overrides" ON paint_overrides FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon delete paint_overrides" ON paint_overrides;
CREATE POLICY "anon delete paint_overrides" ON paint_overrides FOR DELETE TO anon USING (true);
