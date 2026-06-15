-- ============================================================
-- asin_map に anon の INSERT/UPDATE を許可する（管理ツールから直リンク補完するため）
-- ------------------------------------------------------------
-- 背景:
--   admin.html は anon キーで動作しており、products / gears_catalog は
--   既に anon 書き込みを許可済み（password保護の管理画面前提の暫定運用）。
--   asin_map も同じ運用に揃え、管理ツールから手動で ASIN を補完できるようにする。
--
-- 実行手順:
--   Supabase Dashboard → SQL Editor → このファイルを貼り付けて Run
--
-- セキュリティ注意:
--   anon キーは公開されている。これにより匿名でも asin_map を書き換え可能になる
--   （products / gears_catalog と同等のリスク）。affiliate マッピングのみで重要データではない。
-- ============================================================

DROP POLICY IF EXISTS "anon insert asin_map" ON asin_map;
CREATE POLICY "anon insert asin_map"
  ON asin_map FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon update asin_map" ON asin_map;
CREATE POLICY "anon update asin_map"
  ON asin_map FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- 確認用:
-- SELECT polname, cmd FROM pg_policies JOIN pg_policy ON true WHERE tablename = 'asin_map';
