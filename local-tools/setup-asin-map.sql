-- ============================================================
-- asin_map テーブル作成 (Supabase)
-- ------------------------------------------------------------
-- 用途: 塗料大全・トップコート大全・TIPS記事の商品カードを
--       Amazon直リンク化するための ASIN マッピング・キャッシュ。
--
-- 実行手順:
--   1. Supabase Dashboard → 該当プロジェクト → 左メニュー「SQL Editor」
--   2. このファイル全体をコピペして Run
--   3. テーブル一覧で asin_map が出来てることを確認
--
-- 安全性:
--   - 既存の products / gears_catalog / price_reports には触らない
--   - CREATE TABLE IF NOT EXISTS なので二回流しても安全
--   - RLS により anon は SELECT のみ、書き込みは service_role のみ
-- ============================================================

CREATE TABLE IF NOT EXISTS asin_map (
  key             text PRIMARY KEY,                        -- 商品の安定ID (mfr-hash)
  asin            text NOT NULL,                           -- Amazon ASIN
  title           text,                                    -- Amazonでの商品タイトル
  image_url       text,                                    -- 商品画像URL
  price           int,                                     -- 価格（円）
  currency        text DEFAULT 'JPY',
  confidence      text DEFAULT 'medium',                   -- 'high' | 'medium' | 'low' | 'manual'
  source          text NOT NULL,                           -- 'gears_crossref' | 'amazon_scrape' | 'manual' | 'paapi'
  notes           text,                                    -- 補足（マッチした根拠など）
  last_checked_at timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

-- ASIN自体での逆引きインデックス（同じASINが複数keyに紐づくケース検出用）
CREATE INDEX IF NOT EXISTS idx_asin_map_asin ON asin_map(asin);

-- 信頼度別の件数をすばやく見たい
CREATE INDEX IF NOT EXISTS idx_asin_map_confidence ON asin_map(confidence);

-- ------------------------------------------------------------
-- Row Level Security
--   - anon: SELECTのみ許可（loader.jsが匿名キーで読む）
--   - service_role: 全て許可（local-tools/ のスクリプトから書く）
-- ------------------------------------------------------------
ALTER TABLE asin_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read asin_map" ON asin_map;
CREATE POLICY "anon read asin_map"
  ON asin_map FOR SELECT
  TO anon
  USING (true);

-- 任意: 簡易チェック用ビュー（管理時に便利）
CREATE OR REPLACE VIEW asin_map_summary AS
SELECT
  confidence,
  source,
  COUNT(*) AS n,
  MIN(created_at) AS first_added,
  MAX(last_checked_at) AS latest_check
FROM asin_map
GROUP BY confidence, source
ORDER BY n DESC;
