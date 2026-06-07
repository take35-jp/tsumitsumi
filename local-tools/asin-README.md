# ASIN マッピング運用ガイド

塗料大全・トップコート大全・TIPS記事の商品カードを、Amazonの**直リンク＋商品画像＋価格**表示に切り替えるためのインフラ。

## 全体像

```
[Amazon商品マスター]
   ↓ (登録手段3つ)
   ↓
[Supabase: asin_map テーブル]
   ↓ (loader.js が anon キーで読む)
   ↓
[paint/topcoat大全 / TIPS記事の商品カード]
   → 画像・価格・/dp/ASIN/?tag=tsumitsumi232-22 が表示される
```

## ASINの登録手段（3段階）

| 段階 | 方式 | Amazon接触 | 自動化 | 件数想定 |
|---|---|:-:|:-:|---:|
| **Phase 1** | gears_catalog から自動コピー | ❌ なし | ⭕ 完全自動 | 30〜50 |
| **Phase 2** | Amazon検索のHTMLスクレイピング | ⭕ あり（自分のIPで限定回数）| ⚠️ 半自動 | 60〜100 |
| **Phase 3** | 本承認後にPA-API でバルク取得 | ⭕ あり（公式API）| ⭕ 完全自動 | 残り全部 |

**今は Phase 1 まで実装済み**。Phase 2/3 は別ファイル（未実装）。

---

## 🟢 Phase 1: クロスマッチ（gears_catalog → asin_map）

### 前提
- `local-tools/.env` に以下が設定されていること:
  ```
  SUPABASE_URL=https://oxtfwmcdtngvicrcjyue.supabase.co
  SUPABASE_ANON_KEY=...  (READ用)
  SUPABASE_SERVICE_ROLE_KEY=...  (WRITE用・--upsert時のみ必須)
  ```

### 手順

#### Step 1. asin_map テーブルを作る（1回限り）
1. Supabase Dashboard を開く
2. 左メニュー「SQL Editor」
3. `local-tools/setup-asin-map.sql` の中身を全部コピペ → Run
4. テーブル一覧に `asin_map` が現れることを確認

#### Step 2. クロスマッチを Dry-Run（READのみ・完全安全）
```bash
node local-tools/asin-crossref.js
```
出力例：
```
▶ paint大全 を読み込み中...
  716 件
▶ トップコート大全 を読み込み中...
  39 件
▶ Supabase gears_catalog を取得中...
  92 件 / うち ASIN登録済 47 件

▶ マッチング処理中...

▼ マッチ結果
  HIGH (高信頼): 23 件
  MEDIUM       : 18 件
  合計マッチ   : 41 件 / 候補 755 件

💡 --json でJSON出力 / --upsert でSupabase asin_mapに書き込み
```

#### Step 3. 結果を確認したい場合
```bash
node local-tools/asin-crossref.js --json
# → local-tools/asin-matches.json が生成される（gitignore推奨）
```
JSONを開いて、商品名と Amazon タイトルが正しく対応してるかチェック。

#### Step 4. 問題なければ Supabase に書き込む
```bash
node local-tools/asin-crossref.js --upsert
```
これで `asin_map` テーブルに HIGH と MEDIUM の両方が入る。

---

## 🟡 Phase 2: Amazonスクレイピング（未実装）

**実装予定の場所**: `local-tools/bulk-asin-fetcher.js`

### 設計方針
- 1件3秒間隔（Amazon BOTガイドラインに準拠）
- 1日1バッチまで（rate-limit遵守）
- User-Agent を本物のブラウザに偽装
- robots.txt CAPTCHA に当たったら即停止
- 失敗時もリトライしない
- 「主要商品セット 150件程度」のみ対象

### 実行前のチェックリスト（実装時に確認すること）
- [ ] amazon.co.jp/robots.txt を読んで `/s?k=` 経路が許可されているか確認
- [ ] スクレイピング後、Amazon Associates 規約違反でないか確認
- [ ] **本承認後はPhase 3に移行してこのスクリプトは廃止**

---

## 🔵 Phase 3: PA-API（本承認後・未実装）

**実装予定の場所**: Cloudflare Worker (別repo) + `local-tools/refresh-from-paapi.js`

### 設計方針
- Cloudflare Worker (6時間 cron) で `asin_map` 全件を refresh
- PA-API SearchItems で未登録ASINも自動取得
- 価格・在庫の最新値を `asin_map` に反映
- 失敗時はリトライ・スキップ

### 必要な鍵（本承認後にAmazonから付与される）
- AWS Access Key ID
- AWS Secret Access Key
- Partner Tag: `tsumitsumi232-22`

---

## 🔄 loader.js との連携（未実装）

`public/tips/loader.js` を以下のように拡張予定:

```js
// 既存: gears_catalog から data-product-id で引く
// 新規: なければ asin_map から key で引く
const asinMap = await fetch(`${SUPABASE_URL}/rest/v1/asin_map?select=*`, {...}).then(r=>r.json());
const byKey = Object.fromEntries(asinMap.map(r => [r.key, r]));

document.querySelectorAll('.paint-card[data-product-id]').forEach(card => {
  const k = card.dataset.productId;
  const a = byKey[k];
  if (a && a.asin) {
    // 画像差し替え
    if (a.image_url) card.querySelector('.paint-image').innerHTML =
      `<img src="${a.image_url}" alt="${a.title || ''}" loading="lazy">`;
    // リンクを /dp/ に書き換え
    const link = card.querySelector('.paint-amazon');
    if (link) link.href = `https://www.amazon.co.jp/dp/${a.asin}/?tag=tsumitsumi232-22`;
    // 価格を表示
    if (a.price) {
      const priceEl = document.createElement('div');
      priceEl.className = 'paint-price';
      priceEl.textContent = `¥${a.price.toLocaleString()}`;
      card.querySelector('.paint-body').appendChild(priceEl);
    }
  }
});
```

paint大全・トップコート大全のJSの `renderCard` で `data-product-id={makeKey(p, ns)}` を付与する変更も必要。

---

## ❓ FAQ

**Q. クロスマッチが0件になる**
A. gears_catalog にASIN登録されている商品が paint/topcoat 大全に存在しない可能性。`node local-tools/asin-crossref.js --json` で実態確認を。

**Q. 同じASINが複数 key に紐づくのは問題？**
A. 問題なし。「同じ商品を複数の場所で扱う」のは正常。`idx_asin_map_asin` インデックスで検出は可能。

**Q. 信頼度 medium の精度は？**
A. 商品名が部分一致しただけのケース。`asin-matches.json` を Excel で開いて、`notes` フィールドを目視確認すれば判定可能。

**Q. asin_map の中身を一覧したい**
A. Supabase SQL Editor で:
```sql
SELECT * FROM asin_map_summary;  -- 統計
SELECT * FROM asin_map ORDER BY confidence DESC, created_at DESC LIMIT 50;
```
