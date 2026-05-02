# TSUMITSUMI プロジェクト概要（Claude Code 用メモリ）

このファイルは Claude Code が TSUMITSUMI プロジェクトを理解するための
コンテキスト・ブリーフィングです。作業前に必ず参照してください。

---

## 1. プロダクト基本情報

- **プロダクト名**: TSUMITSUMI（ツミツミ）
- **用途**: プラモデル（積みプラ）管理ツール
- **ターゲット**: 日本の積みプラ愛好家（積み師）
- **運営者**: TSUMI TSUMI（※ TAKE35 ではない。すべての公式表記で「TSUMI TSUMI」を使用）
- **本番URL**: https://tsumitsumi.vercel.app
- **管理ツール**: https://tsumitsumi.vercel.app/admin.html（パスワード `Take35@pla`）
- **取説**: https://tsumitsumi.vercel.app/manual.html
- **プライバシーポリシー**: https://tsumitsumi.vercel.app/privacy.html
- **GitHub**: https://github.com/take35-jp/tsumitsumi
- **公式X**: @tsumitsumi_pla
- **ホスティング**: Vercel（Hobby Plan、Function 12個まで。現在11個で運用中）
- **DB**: Supabase（PostgreSQL）
- **Supabase URL**: https://oxtfwmcdtngvicrcjyue.supabase.co
- **正式リリース日**: 2026/5/1
- **マスタ件数**: 約7,000件

---

## 2. 現在のバージョン

**v1.08（2026/05/02）**

### バージョニングルール
- リリース時点（2026/5/1）= v1.00
- 大きめの改修 = +0.1
- 細かい修正 = +0.01
- **アプリのヘルプ画面の更新履歴も、コード修正と一緒に必ず更新する（忘れない）**

### バージョン履歴
- **v1.00**: 正式リリース
- **v1.01**: 参考価格の自動取得（Yahoo!フォールバック、後にバックグラウンド側は削除済み、手動ボタンのみ残存）
- **v1.02**: 価格訂正報告にWeb検索ショートカット
- **v1.03**: 価格訂正報告のバリデーション強化
- **v1.04**: 価格・タグ不具合修正＋タグ削除ボタン改善（24px常時表示）
- **v1.05**: 商品画像の補完取得
- **v1.06**: 欠番（永続化が真っ白事件で巻き戻ったため v1.08 として再出）
- **v1.07**: プライバシーポリシー独立ページ化＋アフィリエイト広告表記追加＋LegalModal削除
- **v1.08**: 並び順・表示モードの永続化（useEffect方式・初回マウント保存スキップ）＋更新履歴文言の簡潔化

---

## 3. ディレクトリ構造

```
tsumitsumi/
├── src/
│   ├── App.jsx          # メインアプリ（約2,936行・SPA）
│   └── ...
├── public/
│   ├── admin.html       # 管理ツール（パスワード保護）
│   ├── manual.html      # 取扱説明書
│   ├── privacy.html     # プライバシーポリシー
│   └── ...
├── api/                 # Vercel Functions（11個）
│   ├── search.js
│   ├── admin-search.js
│   ├── browse.js
│   ├── master.js
│   ├── price.js
│   ├── scan-barcode.js
│   ├── image-proxy.js
│   ├── seed-bandai.js
│   ├── seed-maker.js
│   ├── auto-seed.js
│   └── rakuten-books.js
├── local-tools/         # ローカル支援スクリプト群（Node.js）
│   ├── .env             # 環境変数（gitignore）
│   ├── check-prices.js
│   ├── apply-updates.js
│   ├── debug-headers.js
│   ├── inspect-shops.js
│   └── bandai-jan-mapper.js
└── CLAUDE.md            # このファイル
```

---

## 4. 重要な設計方針

### 4-1. データの保存場所
- **ユーザーのキット情報は localStorage に保存**（サーバーには送らない）
- 商品マスタ（products テーブル）のみ Supabase に置く
- これがプライバシー上の最大の信頼ポイント

### 4-2. 価格取得方針（不採用パターンに注意）
- **マスタDBの retail_price からのみ取得が原則**
- Yahoo!ショッピングの販売価格は転売プレミア混入で信用不可（自動取得は不採用）
- 楽天市場API も同様に転売混入で価格用途では不採用
- ただし「💴一括取得」ボタン（手動）押下時のみ Yahoo フォールバック許可（v1.01）
- マスタHITで画像なし → /api/search?jan=00000000&name=商品名 で画像のみフォールバック取得（v1.05）

### 4-3. やってはいけないこと
- ❌ Yahoo販売価格をretail_priceに自動投入する（転売プレミア混入）
- ❌ 楽天市場/楽天ブックスから価格取得（同上）
- ❌ バンダイホビーサイトに JANを期待する（載っていない）
- ❌ ヨドバシ.com からスクレイピングで JAN取得（平文では無い）
- ❌ Vercel Function を 12個 超えるエンドポイント追加（Hobby Plan上限）
- ❌ 商品名で機械的にマッチング（表記ゆれ多発）
- ❌ /api/admin-search を一般クライアントから叩く（管理用）

### 4-4. 運営者表記
**すべての公式表記で「TSUMI TSUMI」に統一**。アプリ内・取説・LP・ポリシー・フッター・コピーライト全部。`© 2026 TSUMI TSUMI`。「TAKE35」は内部識別子として残るが、ユーザーに見える場所には出さない。

---

## 5. products テーブル構造（マスタDB）

| カラム | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | int(serial) | ✅ | 主キー（自動採番）|
| `jan` | text | ✅ | JANコード（UNIQUE）|
| `name` | text | ✅ | 商品名 |
| `maker` | text | △ | メーカー名（※`maker_name`ではない）|
| `series` | text | △ | シリーズ名 |
| `scale` | text | △ | スケール・グレード |
| `image_url` | text | △ | 商品画像URL |
| `retail_price` | int | △ | 希望小売価格（税込）|
| `created_at` | timestamp | ✅ | |
| `updated_at` | timestamp | ✅ | |

### Excel入出力の列順
`jan, name, maker, series, scale, image_url, retail_price`
JANで突合してUPSERT。

---

## 6. price_reports テーブル（価格訂正報告）

| カラム | 説明 |
|---|---|
| `id`, `product_id`(FK→products), `jan`, `product_name`, `current_price`, `reported_price`, `comment` | データ |
| `status` | pending / resolved / rejected |
| `admin_note`, `created_at`, `updated_at`, `resolved_at` | 管理用 |

RLS 有効、anon に INSERT/SELECT/UPDATE 許可（暫定）。

---

## 7. APIエンドポイント一覧（Vercel Function 11個）

| エンドポイント | 用途 | メモ |
|---|---|---|
| `/api/search` | 一般検索（Yahoo） | JAN含めず返す |
| `/api/admin-search` | 管理用検索（Yahoo） | JAN含めて返す |
| `/api/browse` | 複数キーワードAND検索 | LP/閲覧UI向け |
| `/api/master` | マスタプロキシ取得 | |
| `/api/price` | retail_priceを返すだけ | v9マスタ格納方式 |
| `/api/scan-barcode` | バーコードスキャン解析 | |
| `/api/image-proxy` | CORS対策 | |
| `/api/seed-bandai` | バンダイ系シード | |
| `/api/seed-maker` | メーカー別シード | |
| `/api/auto-seed` | 月次cron | |
| `/api/rakuten-books` | 楽天本API | 価格用途では不採用 |

---

## 8. ユーザーアプリ機能（App.jsx）

- JANバーコードスキャン登録
- 連続スキャン＋一括登録（ID生成は連番 baseTime+i、Math.random は使わない）
- 手動登録
- キット一覧（リスト/グリッド表示切替）
- タグ・状態（未組立/組立中/完成済み）・評価・購入日管理
- 希望小売価格 × 個数で総額表示
- X（Twitter）シェア画像生成（完成済みは除外）
- バックアップ（Excel/CSVエクスポート/インポート）
- 価格訂正報告フォーム（1分5件まで、価格と現状価格が同じ＆コメント無しは送信NG、Web検索ショートカット有り）
- ヘルプ・更新履歴表示

### 並び順・表示モード（v1.08で永続化）
- 初期値: 登録順（date）+ 降順（desc）
- localStorage キー: `tsumitsumi_view_settings`
- 値: `{ viewMode, sortKey, sortDir }`
- 実装: useEffect で読み込み（マウント時1回）、変更検知で保存（初回マウントスキップ）

### タグ削除
- 24px赤丸×を常時表示（v1.04）

---

## 9. admin.html（管理ツール）の機能

5タブ構成:
1. **🔍 Yahoo検索から登録**: 自動一括登録（緑エリア）+ 手動検索
2. **✏️ 直接入力**: JAN/商品名/メーカー/シリーズ/スケール/画像URL
3. **📋 マスタ一覧**: 検索・インライン編集・削除・一括処理
4. **📊 Excel入出力**: エクスポート（件数・並び順指定可）+ インポート（JAN突合UPSERT）
5. **📨 報告キュー**: 価格訂正報告の管理（未対応バッジ赤丸表示）

### マスタ一覧タブの一括処理ボタン（5つ）
- 📷 画像なし商品の画像を一括取得（青）
- 📊 スケール・シリーズ自動補完（緑）
- 🧹 商品名を一括クリーニング（黄）
- 🔄 商品名を並び替え（紫・実験的）
- 🔄 更新（黒）

### 自動一括登録の検索クエリ
グレード+作品の組み合わせで膨大な選択肢:
- HG/MG/RG/PG/EG/MGSD/MGEX/RE/100/フルメカニクス/ハロプラ/HAROPLA等 × 各作品
- BB戦士は古いキット重視で13種類のクエリ追加
- ハロプラは optgroup（全般/HAROPLA/ガンダム検索の3クエリ）
- メーカー別自動一括登録もあり（BANDAI→「バンダイ プラモデル」等カタカナ表記でヒット率改善済み）

### 商品名クリーニング（cleanName関数、18ステップ）
HTMLエンティティ変換 / スケール表記正規化 / 全角英数→半角 / 装飾記号除去 / プレバン関連除去 / 限定店表記除去 / 予約・発売予定日除去 / 各種カッコ除去 / ノイズキーワード直接除去 / メーカー名末尾・先頭除去 / JAN13桁数字除去 / スケール・サイズ表記整理 / 空括弧除去 / 連続スペース整理 など。

### 商品名並び替え（reorderName関数、実験的）
「グレード→スケール→キット名→メーカー→作品名」に並び替え。誤判定リスクあるので個別ボタンで実行する設計。

### 報告キュータブの一括処理
- 🆕 未登録の報告をマスタに一括登録（価格は登録せず商品名のみ）
- ✅ 報告された価格をマスタに一括反映（JAN紐付け済み＆価格報告ありのみ）
- 個別: 🔍検索してマスタ更新 / 📝編集して採用（同JAN一括処理対応）/ ✗却下 / ↺未対応に戻す

---

## 10. 環境変数（Vercel + ローカル .env）

```
RAKUTEN_APP_ID=42e3f5e9-0e32-4e0d-b5e3-2df6b593b6ff
RAKUTEN_ACCESS_KEY=pk_xxxxxxxxxxxxxxxx  # 新API用
REFERER=https://tsumitsumi.vercel.app/
SUPABASE_URL=https://oxtfwmcdtngvicrcjyue.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
YAHOO_CLIENT_ID=...  # /api/search、/api/admin-search で使用
```

### 楽天新API（openapi.rakuten.co.jp）の注意
- 必須ヘッダー: Referer / Origin / User-Agent
- Node.js の fetch は Referer を Forbidden Header として削除する → **`https.request()` を使う**
- ※価格用途では不採用なので積極的に触らなくてよい

---

## 11. ローカル支援ツール（local-tools/）

| ツール | 用途 |
|---|---|
| `check-prices.js` | 楽天価格チェック（価格用途では不採用、参考用）|
| `apply-updates.js` | CSV→DB一括更新 |
| `debug-headers.js` | HTTPヘッダー検証 |
| `inspect-shops.js` | 楽天ショップ実態調査 |
| `bandai-jan-mapper.js` | バンダイ全件と既存DBの突合（部分動作・改善余地あり）|
| `bandai-all-items.json` | 過去取得済みバンダイ全件（再マッチング用に保管）|

---

## 12. リリース後の改善タスク（優先順）

1. **bandai-all-items.json 再マッチング**（30分、価格反映率+5%）
2. **タミヤ公式マッチング**（2-4時間）
   - URL: `https://www.tamiya.com/japan/products/list.html?genre_item={ID}`
   - shift_jis 処理必要、ITEM番号でDBマッチング
3. **コトブキヤ・グッスマ等の追加マッチング**
4. **楽天プロダクト検索APIの副産物活用**（商品名正規化・画像URL補完）
5. **admin.html のデバッグログ削除**
6. **報告キュー運用調整**

---

## 13. アフィリエイト戦略（実装フェーズ）

### 狙い所
- **プラモ買取**: 駿河屋・カイトリワールド・ホビーコレクト等
- **トランクルーム/貸し倉庫**: ハローストレージ等
- 物販系よりも積みプラユーザーとの親和性高く高単価期待

### ASP登録状況
- **A8.net**: 登録済み（2026/5/2）
- **アクセストレード**: 申請中

### 配置設計（予定）
- メイン最上段: 倉庫バナー
- キット詳細下部: 買取カード
- 状況依存:
  - 同JAN複数検知時 → 買取提案
  - 完成済み変更時 → 買取提案
  - 総額大 → 倉庫提案

### 実装前に必須
- ステマ規制対応（2023/10施行）→ ✅ 対応済み（フッターに表記＋privacy.html）

---

## 14. 開発上の注意（過去のハマりどころ）

### React/JSX 関連
- **TDZ（Temporal Dead Zone）エラーに注意**
  - 2026/5/2 に「並び順永続化」を lazy initializer で実装した結果、本番が真っ白になる事故が発生
  - 教訓: useState の lazy initializer よりも、useEffect でマウント後に読み込む方式の方が TDZ リスクゼロ
  - 現在は useEffect 方式で実装済み（v1.08）
- **Babel の構文チェックは TDZ を検出できない** → 本物のViteビルドで確認するのが必須
- **localStorage の保存処理は useEffect の初回マウント保存をスキップする工夫が必要**（useRef でフラグ管理）

### Supabase 関連
- カラム名は `maker`（`maker_name` ではない）
- Supabase クエリで `_=タイムスタンプ` を使うとフィルタ判定でエラー → `ts=...` などを使う

### Vercel 関連
- Hobby Plan の Function 上限 = 12個。現在11個で運用中（余裕は1個）
- Function を増やすときは何かを統合・削除する必要あり

### ビルド・デプロイ
- **修正後は npm run build で本物のビルドを通すこと**（過去の真っ白事件の教訓）
- git push → Vercel が自動デプロイ
- 本番URLでの動作確認まで含めて1サイクル

---

## 15. 開発進行ルール（このプロジェクトの慣例）

### 1コミット1機能を厳守
過去に「複数の修正を同時に入れて真っ白事件」を経験。これ以降:
- 1つの変更だけ入れる
- 動作確認 → 次の修正へ
- 同時に複数を入れない

### リスク評価
- 🟢 JSX要素の追加のみ: 最も安全
- 🟢 JSX要素の削除のみ（独立ブロック）: 安全
- 🟡 既存JSXの構造変更（ネスト変更、map化）: 中リスク
- 🔴 state/effect/const の追加: 高リスク（TDZ・依存配列・初期化順序）

### 高リスク修正は単独で
state/effect/const を触る修正は、他の修正と絶対に同時にやらない。単独で出して動作確認する。

### コードを書いた後は必ず実行
ビルドが通るかを確認。本物のエラーが出ないかを確認してからユーザーに渡す。

---

## 16. ヘルプ画面（HelpModal）の構成

現在のセクション順:
1. 📖 使い方はコチラ →（manual.html へのリンク）
2. 💾 保存容量（localStorage 使用量、容量警告つき）
3. ⚠ データについての注意
4. 💾 データのバックアップ・機種変更
5. お問い合わせ（X DM）
6. 📋 更新履歴（直近3件 + 「すべて見る」）
7. 🔒 プライバシーポリシー（privacy.html へのリンク + アフィリエイト広告利用表記）

直近3件は HelpModal 内に直書きJSX、全件は AllVersionsModal の versions 配列。
**バージョン更新時は両方を必ず修正すること。**

---

## 17. プライバシーポリシー・ステマ規制対応

- privacy.html を独立ページとして配置済み
- 当サイトはアフィリエイト広告を利用していることを明示
- アプリのフッター（キット一覧最下部）にも表記
- ヘルプ画面にもプライバシーポリシーへの導線あり
- 運営者は「TSUMI TSUMI」、お問い合わせは X DM（@tsumitsumi_pla）のみ

---

## このファイルの更新ルール

- 仕様変更があったら必ず更新する
- バージョンを上げたら §2 を更新する
- 新しいハマりどころが見つかったら §14 に追記する
- 開発ルールを変えたら §15 を更新する
