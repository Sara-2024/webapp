# FXデモ取引プラットフォーム

## プロジェクト概要
- **名称**: GOLD取引デモプラットフォーム
- **目的**: GOLDのデモ取引を通じてFX取引の練習ができるWebアプリケーション
- **価格データ**: Twelve Data API（XAU/USD）からリアルタイム取得
- **TradingView連動チャート**: 
  - **最推奨**: [FX_IDC:XAUUSDG](https://www.tradingview.com/chart/?symbol=FX_IDC%3AXAUUSDG) - Gold/USD Gram単位、$4,900-$5,100範囲
  - **推奨**: [OANDA:XAUUSD](https://www.tradingview.com/chart/?symbol=OANDA%3AXAUUSD) - $4,900-$5,100範囲
  - または: [FX:XAUUSD](https://www.tradingview.com/chart/?symbol=FX%3AXAUUSD) - Forex市場
  - ❌ **間違い**: TVC:GOLD や COMEX:GC1!（約$2,650、トロイオンス単位）は使用しないでください
- **価格帯**: $4,900-$5,100
- **重要**: Twelve DataのXAU/USD価格は約$4,900-$5,100の範囲で、TradingViewの標準XAUUSDスポット（約$2,650）とは異なります
- **主な機能**: 
  - GOLD（XAU/USD）取引（買い/売り）
  - リアルタイム価格表示（Twelve Data Grow Plan）
  - 30秒ごとに実価格更新（0秒、30秒に同期）
  - キャッシュ期間中は±10円のランダム変動
  - エントリー・決済時のポップアップ通知
  - 個別ポジション決済
  - ポイントシステム
  - ランキング機能
  - 動画教材視聴
  - トレード画面内蔵チャット
  - 管理者によるユーザー管理

## URL
- **開発環境**: https://3000-iuwg74237l68z4a0hnj15-5634da27.sandbox.novita.ai
- **本番環境**: https://236061af.webapp-303.pages.dev
- **管理者ページ**: https://236061af.webapp-303.pages.dev/admin-login

## トレードルール
- **ローソク足**: 1分足（60秒ごとに確定、途中経過は10秒ごとに更新）
- **ロット**: 1ロット固定
- **最大ポジション数**: 3ポジションまで
- **自動決済**: エントリーから15分経過で自動決済
- **初期残高**: ¥1,000,000

## Twelve Data API設定

このプラットフォームは**Twelve Data API（Grow Plan）**を使用してGOLD（XAU/USD）のリアルタイム価格を取得します。

### 必須プラン
- **Grow Plan**: $79/月（年払いで37%割引）
- **API制限**: 15,000リクエスト/日
- **シンボル**: XAU/USD（ゴールドスポット価格、$4,900-$5,100範囲）

### API Keyの設定
1. https://twelvedata.com/ でGrow Planを契約
2. API Keyを取得
3. API Key制限：
   - Grow プラン: **15,000リクエスト/日**
   - このプラットフォームでは10秒間キャッシュで効率的に利用
   - 実質的な更新頻度: **5秒ごとにフロントエンド更新、10秒ごとにAPI呼び出し**
   - 1日の使用量: 約8,640リクエスト（制限の58%）

### ローカル開発でのAPI Key設定
`.dev.vars` ファイルに設定（既に作成済み）:
\`\`\`bash
TWELVE_DATA_API_KEY=your_api_key_here
\`\`\`

### 本番環境でのAPI Key設定
\`\`\`bash
# Cloudflare Pages Secretとして設定
wrangler pages secret put TWELVE_DATA_API_KEY --project-name webapp
# プロンプトでAPI Keyを入力
\`\`\`

### API Keyが未設定の場合
- 自動的にダミー価格（4900-5100 USD範囲）を生成
- 正常に動作しますが、実際の市場価格は反映されません

## 実装済み機能

### ✅ ユーザー機能
1. **認証システム**
   - **7文字パスワード（数字6桁+英字1文字）でログイン**
     - 例: `123456a`, `a234567`, `12a3456`
     - 大文字・小文字は区別しない
   - セッション管理（Cookie）
   - デイリーログインボーナス（10pt）
   - 7日連続ログインボーナス（+50pt）

2. **トレード機能**（`/trade`）
   - GOLD（XAU/USD）価格のリアルタイム表示
     - Twelve Data API Grow Planから取得
     - **10秒間キャッシュ（リアルタイム性と効率性のバランス）**
     - **フロントエンドは5秒ごとに更新**
     - **ランダム変動なし - 実際のAPI価格のみ使用**
     - 最大誤差: 10秒以内
     - TradingViewと価格が一致
   - **エントリー時のポップアップ通知**（緑色）
   - **決済時のポップアップ通知**（利益：青色、損失：赤色）
   - 購入金額設定（0.3、0.5、1.0 lot）
   - 買いポジション/売りポジション
   - **各ポジションに×ボタンで個別決済**
   - リアルタイム損益表示（整数表示、小数点なし）
   - エントリー価格・現在価格表示（正確に同期）
   - 取引完了ポイント（1pt/取引、5分以内連続取引は対象外）
   - **トレード画面内蔵チャット**（開閉可能、5秒自動更新）

3. **マイページ**（`/mypage`）
   - アカウント名変更
   - 残高・総利益・取引数表示
   - ポイント残高表示
   - 連続ログイン日数表示
   - 取引履歴一覧（最新50件）

4. **ランキング**（`/ranking`）
   - 利益総額ランキング（Top 100）
   - 取引数ランキング（Top 100）
   - 週次ランキング報酬表示
     - 1位: 10,000pt
     - 2位: 5,000pt
     - 3位: 1,000pt

5. **動画教材**（`/videos`）
   - YouTube動画埋め込み視聴
   - 初期動画：「エントリーの基礎」(https://youtu.be/pRlyBmJ_3Ks)

6. **オンラインチャット**（`/chat`）
   - リアルタイムメッセージング（5秒ごと更新）
   - ユーザー名・タイムスタンプ表示
   - 自分のメッセージを右側に表示

### ✅ 管理者機能
1. **管理者ログイン**（`/admin-login`）
   - メール: kondo@leagan.group
   - パスワード: Leagan-0000

2. **管理者ダッシュボード**（`/admin`）
   - **ユーザー管理**
     - ユーザー一覧表示（パスワード含む）
     - 新規ユーザー追加（**7文字パスワード：数字6桁+英字1文字**）
     - ランダムなユーザー名自動生成
   - **動画管理**
     - 動画一覧表示
     - 新規動画追加（タイトル、YouTube URL、表示順序）
     - 動画削除

## データアーキテクチャ

### データモデル
1. **users**: ユーザー情報
   - id, password, username, balance, total_profit, total_trades
   - points, last_login_date, consecutive_login_days

2. **trades**: 取引履歴
   - id, user_id, type (BUY/SELL), amount, entry_price, exit_price
   - profit_loss, status (OPEN/CLOSED), entry_time, exit_time

3. **point_transactions**: ポイント履歴
   - id, user_id, points, type, description

4. **videos**: 動画教材
   - id, title, youtube_url, order_index

5. **admin_users**: 管理者アカウント
   - id, email, password

6. **chat_messages**: チャットメッセージ
   - id, user_id, username, message, created_at

### ストレージサービス
- **Cloudflare D1 Database**: すべてのデータを保存
- **ローカル開発**: `.wrangler/state/v3/d1` にSQLiteデータベース

## ユーザーガイド

### 一般ユーザー
1. **ログイン**: トップページで7文字（数字6桁+英字1文字）のパスワードを入力
   - 例: `123456a`, `a987654`, `12b3456`
2. **取引開始**: 
   - 購入金額を選択（0.1, 0.3, 0.5, 1.0 lot）
   - 「買う」または「売る」ボタンをクリック
   - ポジションの損益をリアルタイムで確認
   - 「購入」ボタンで決済
3. **ポイント獲得**:
   - 毎日ログイン: 10pt
   - 7日連続ログイン: 追加50pt
   - 取引完了: 1pt（5分以内連続取引は対象外）
   - ランキング報酬: 1位10,000pt / 2位5,000pt / 3位1,000pt

### 管理者
1. **ログイン**: トップページ下部の「・」をクリック
2. **ユーザー追加**: 
   - 6桁パスワードを入力
   - ユーザー名は任意（空欄で自動生成）
3. **動画追加**: タイトルとYouTube URLを入力

## デプロイ

### ローカル開発
```bash
# データベース初期化
npm run db:migrate:local

# ビルド
npm run build

# PM2でサービス起動
pm2 start ecosystem.config.cjs

# ログ確認
pm2 logs --nostream
```

### Cloudflare Pages本番デプロイ
```bash
# Cloudflare D1データベース作成
wrangler d1 create webapp-production

# wrangler.jsonc にdatabase_idを設定

# 本番データベースにマイグレーション適用
npm run db:migrate:prod

# ビルドとデプロイ
npm run deploy:prod
```

## 技術スタック
- **フレームワーク**: Hono (v4.11.9)
- **ランタイム**: Cloudflare Workers
- **データベース**: Cloudflare D1 (SQLite)
- **フロントエンド**: 
  - TailwindCSS (CDN)
  - Font Awesome (CDN)
  - Axios (CDN)
- **ビルドツール**: Vite (v6.3.5)
- **プロセス管理**: PM2 (開発環境)

## プロジェクト構造
```
webapp/
├── src/
│   └── index.tsx           # メインアプリケーション（API + HTML）
├── migrations/
│   └── 0001_initial_schema.sql  # データベーススキーマ
├── public/
│   └── static/
├── wrangler.jsonc          # Cloudflare設定
├── ecosystem.config.cjs    # PM2設定
├── package.json
└── README.md
```

## API エンドポイント

### 認証
- `POST /api/auth/login` - ユーザーログイン
- `POST /api/auth/admin-login` - 管理者ログイン
- `POST /api/auth/logout` - ログアウト
- `GET /api/auth/me` - 現在のユーザー情報取得

### トレード
- `GET /api/trade/gold-price` - GOLD価格取得
- `POST /api/trade/open` - ポジション開く
- `POST /api/trade/close/:tradeId` - ポジション決済
- `GET /api/trade/open-positions` - オープンポジション一覧
- `GET /api/trade/history` - 取引履歴

### ユーザー
- `PUT /api/user/username` - ユーザー名更新

### ランキング
- `GET /api/ranking/profit` - 利益総額ランキング
- `GET /api/ranking/trades` - 取引数ランキング

### 動画
- `GET /api/videos` - 動画一覧取得

### 管理者
- `GET /api/admin/users` - ユーザー一覧取得（管理者のみ）
- `POST /api/admin/users` - ユーザー追加（管理者のみ）
- `POST /api/admin/videos` - 動画追加（管理者のみ）
- `DELETE /api/admin/videos/:id` - 動画削除（管理者のみ）

### チャット
- `GET /api/chat/messages` - メッセージ一覧取得
- `POST /api/chat/messages` - メッセージ送信

## 今後の改善案
1. **残高リセット機能**: マイページから残高を初期値にリセット
2. **週次ランキング自動計算**: 毎週自動でポイント付与
3. **価格チャート表示**: TradingView埋め込み
4. **プッシュ通知**: ポジション決済時の通知
5. **モバイル最適化**: レスポンシブデザインの改善
6. **リアルタイムチャット**: WebSocketによる即時更新
7. **多言語対応**: 英語・中国語サポート

## 最終更新
- **日付**: 2026-02-13
- **ステータス**: ✅ ローカル開発環境で完全稼働中
- **次のステップ**: Cloudflare Pagesへの本番デプロイ
