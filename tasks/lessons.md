# Lessons Learned

## 2026-02-24: CLAUDE.md 必読ルール
- **ルール**: 変更前に必ず `md/CLAUDE.md` を読むこと
- **背景**: ユーザーから指摘を受けた
- **対策**: 全作業の最初のステップとして CLAUDE.md を view_file する

## 2026-02-24: jsPDF 日本語フォント問題
- **問題**: jsPDF のデフォルトフォント (Helvetica) は日本語未対応 → 文字化け
- **解決策**: html2canvas + jsPDF のアプローチ。HTMLをブラウザでレンダリング→画像キャプチャ→PDFに埋め込み
- **教訓**: CJK文字を含むPDF生成は直接 jsPDF.text() ではなく HTML-based rendering を使う

## 2026-02-24: 仕様書ベースの実装
- **ルール**: ユーザー提供の仕様書がある場合、そのレイアウト・フォーマット・テキストを正確に再現する
- **例**: ORDER_DOCUMENT_SPEC.md の固定テキスト（発注元住所、取引条件、秘密保持条項）をそのまま使う

## 2026-02-24: Vue runtime compilation エラー
- **問題**: `defineComponent({ template: '...' })` は Vite のデフォルト Vue ビルドでランタイムコンパイル未対応
- **解決策**: string template を使わず、必ず SFC (.vue) として分離する
- **教訓**: インラインコンポーネントを定義する場合は `h()` render function を使うか、SFC に分離する

## 2026-02-24: Google OAuth アクセストークン有効期限
- **問題**: `signInWithPopup` で取得した `googleAccessToken` は約1時間で期限切れ。`onAuthStateChanged` では復元されない
- **解決策**: `getAccessToken()` メソッドで、トークンが無い場合は再認証して取得する
- **教訓**: OAuth アクセストークンに依存する処理（Calendar API等）は、使用直前にトークンの有効性を確認する
- **追加教訓**: トークンは sessionStorage にキャッシュしてページリロード後も使えるようにする

## 2026-02-24: Google Calendar API attendees PATCH は上書き
- **問題**: `PATCH { attendees: [{ email: newPerson }] }` は既存の attendees を**上書き**する（追加ではない）
- **解決策**: 先に GET でイベントの既存 attendees を取得し、配列に追加してから PATCH する
- **教訓**: Calendar API の attendees は常に完全なリストを送る必要がある
