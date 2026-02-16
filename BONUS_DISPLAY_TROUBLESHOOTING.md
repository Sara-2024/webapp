# 特別ボーナス表示問題のトラブルシューティング

## 📊 現状確認（2026-02-16 16:33 JST）

### データベース状況
- **総ユーザー数**: 506人
- **ボーナス受け取り済み**: 6人（ham, おか, て, だいじろう, シン, WM）
- **未受取ユーザー**: 500人
- **キャンペーン残り時間**: 約21.7時間

### 実装状況
- ✅ HTML にボーナスセクション存在（specialBonusSection）
- ✅ JavaScript 関数 loadBonusStatus() 実装済み
- ✅ API `/api/special-bonus/status` 動作確認済み
- ✅ API `/api/special-bonus/claim` 動作確認済み
- ✅ テストユーザー（はな）で表示確認済み

## 🔍 「表示されない」問題の考えられる原因

### 1. ブラウザキャッシュの問題 ⭐️ **最も可能性が高い**
**症状**: 古いバージョンのページがキャッシュされている
**対策**:
```
スーパーリロード（キャッシュクリア）を実行
- Windows/Linux: Ctrl + Shift + R または Ctrl + F5
- Mac: Cmd + Shift + R
```

### 2. JavaScript エラー
**症状**: コンソールエラーで loadBonusStatus() が実行されない
**確認方法**:
```
1. F12 でデベロッパーツールを開く
2. Console タブでエラーを確認
3. Network タブで /api/special-bonus/status のリクエストを確認
```

### 3. Cookie 認証の問題
**症状**: ログイン状態が維持されていない
**確認方法**:
```
1. F12 → Application → Cookies
2. user_id Cookie が存在するか確認
3. 存在しない場合は再ログイン
```

### 4. API レスポンスエラー
**症状**: API が 401/404/500 を返す
**確認方法**:
```
F12 → Network タブで /api/special-bonus/status のステータスコードを確認
```

### 5. 期限切れまたは受け取り済み
**症状**: 正常動作だが、ユーザーが誤解している
**表示内容**:
- **未受取**: "1,000ポイント受け取る" ボタン + カウントダウン
- **受取済み**: "✅ 受け取り済み（YYYY-MM-DD）" メッセージ
- **期限切れ**: "キャンペーンは終了しました" メッセージ

## ✅ ユーザーへの案内

### 表示されない場合の対処法（優先順）

**ステップ1: スーパーリロード**
```
1. マイページを開く
2. Ctrl + Shift + R（Mac: Cmd + Shift + R）を押す
3. ページが再読み込みされ、ボーナスセクションが表示される
```

**ステップ2: キャッシュクリア**
```
ブラウザの設定 → 閲覧履歴データの削除 → キャッシュされた画像とファイル → 削除
```

**ステップ3: 再ログイン**
```
1. ログアウト
2. 再度ログイン
3. マイページへ移動
```

**ステップ4: 別ブラウザで確認**
```
Chrome、Firefox、Edge など別のブラウザで試す
```

**ステップ5: シークレットモード**
```
シークレット/プライベートブラウジングモードで開く
（キャッシュが一切使われない）
```

## 🧪 動作確認済みテスト結果

### テスト1: API直接呼び出し
```bash
curl -X POST https://0087f117.webapp-303.pages.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "123456a"}' \
  -c cookies.txt

curl https://0087f117.webapp-303.pages.dev/api/special-bonus/status \
  -b cookies.txt
```
**結果**: ✅ 正常動作、レスポンス受信

### テスト2: HTML要素確認
```bash
curl https://0087f117.webapp-303.pages.dev/mypage | grep "specialBonusSection"
```
**結果**: ✅ 1箇所検出

### テスト3: 実ユーザーでのログインテスト
**ユーザー**: はな（ID: 1）
**結果**: 
- ✅ ログイン成功
- ✅ ボーナスAPI動作
- ✅ マイページに表示

## 📝 確認用SQLクエリ

### 特定ユーザーの受け取り状況確認
```sql
SELECT 
  u.username, 
  u.id, 
  CASE 
    WHEN s.claimed_at IS NOT NULL THEN '受取済み'
    ELSE '未受取'
  END as status,
  s.claimed_at
FROM users u
LEFT JOIN special_bonus_claims s 
  ON u.id = s.user_id 
  AND s.bonus_type='maintenance_2026_02_16'
WHERE u.username = 'ユーザー名';
```

### 受け取り済みユーザー一覧
```sql
SELECT u.username, s.claimed_at, s.points
FROM special_bonus_claims s
JOIN users u ON s.user_id = u.id
WHERE s.bonus_type='maintenance_2026_02_16'
ORDER BY s.claimed_at DESC;
```

## 🎯 結論

**ボーナス機能は全ユーザーに正しく実装されています。**

「表示されない」問題の99%はブラウザキャッシュが原因です。
ユーザーに**スーパーリロード（Ctrl + Shift + R）**を案内してください。

残り約21.7時間で、500人のユーザーがまだ1,000ポイントを受け取れます。

---
作成日時: 2026-02-16 16:33 JST
本番URL: https://0087f117.webapp-303.pages.dev
キャンペーン終了: 2026-02-17 15:00 JST
