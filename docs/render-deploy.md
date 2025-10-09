# Render Blueprint デプロイ手順

このリポジトリには Render 用の Blueprint 定義ファイル render.yaml が含まれています。以下の手順に沿えば、無料プランでバックエンドとフロントエンドをまとめてデプロイできます。

## 1. Blueprint を GitHub に反映

    git add render.yaml docs/render-deploy.md
    git commit -m "Add Render blueprint"
    git push

## 2. Render で Blueprint をデプロイ

1. https://render.com にログインし、左メニューの **Blueprints** を開きます。
2. **New Blueprint Instance** をクリックし、この GitHub リポジトリを選択します。
3. プランは Free、リージョンは US のまま **Deploy** を押します。これで次の 2 つの Web サービスが作成されます。
   - myfinance-backend (Python / FastAPI)
   - myfinance-frontend (Node / Express)

デプロイ後は、デフォルトブランチへの push ごとに自動で再デプロイされます。

## 3. バックエンド URL の連携

render.yaml の `VITE_BACKEND_URL` には `https://myfinance-backend.onrender.com` を設定しています。Render のデフォルトドメインはサービス名に依存するため、もしカスタムドメインや別名を使う場合はフロントエンドサービスの Environment から `VITE_BACKEND_URL` を編集してください。

## 4. 動作確認

- フロントエンドの URL (例: https://myfinance-frontend.onrender.com) にアクセスし、画面が表示されることを確認します。
- /api/yf/quote?symbols=USDJPY%3DX などのエンドポイントへアクセスして、バックエンドが応答するか確認します。

## 補足

- Render の無料プランでは一定時間アクセスがないとサービスがスリープし、再アクセス時に数十秒かかる場合があります。
- ポートフォリオのデータはブラウザの localStorage に保存されます。端末をまたいで利用したい場合はバックアップ JSON をダウンロードするか、バックエンド側に保存機能を追加してください。
- Yahoo Finance はリクエストが集中すると HTTP 429 を返すことがあります。必要に応じてキャッシュやリトライ制御を検討してください。
