# US Industries Dataset

このツールチェーンは FinanceDatabase のメタデータを基に、米国 GICS インダストリー（レベル3）それぞれについて最大5銘柄を抽出し、Yahoo Finance (query2 API) の終値を用いて等ウェイト合成指数を作成します。生成されたデータは `data/us-industries/history.json` と `web/public/data/us-industries-history.json` に保存されます。

## スクリプト構成
- `build_universe.py` - FinanceDatabase から米国プライマリ上場／USD 建の代表銘柄を収集し、`data/us-industries/universe.json` を生成します。
- `update_dataset.py` - 指定期間の終値を取得して指数を再計算し、`history.json` と公開用コピーを更新します（404 はスキップ、レート制限は指数バックオフで再試行）。

## 自動更新の仕組み
- バックエンドに追加した `GET /api/us-industries/history` をフロントエンドから呼び出すと、直近 24 時間以内に生成されたデータであればそのまま返却、古い場合はキャッシュを返しつつバックグラウンドで再計算を実行します。
- 初回起動や `force=1` クエリを指定した場合は同期的に再計算し、完了後のデータを返します。
- 生成後の JSON には `generatedAt` の ISO8601 タイムスタンプやカバレッジ統計が含まれており、フロントエンドのステータス表示に利用されます。

## 手動メンテナンス
1. （任意）FinanceDatabase を更新した際はユニバースを再生成します。
   ```powershell
   backend/.venv/Scripts/python.exe tools/us_industries/build_universe.py
   ```
2. 強制的にデータセットを再計算したい場合は以下を実行します。
   ```powershell
   backend/.venv/Scripts/python.exe tools/us_industries/update_dataset.py --period 5y
   ```
   `--period` は Yahoo Finance の `range` 引数にそのまま渡されます（初回ロード時のみ長期間に設定すると安定します）。

## フロントエンド連携
- `web/src/lib/usIndustries.ts` が `/api/us-industries/history` をフェッチし、結果を `buildUSIndustryOverrides` に渡して Analysis 画面の「US Industries」ビューで利用します。
- ビュー切り替え時は既存データを即座に表示し、バックエンド側で必要に応じて再計算が行われます。
- カバレッジ表示にはメタデータ内の `withHistory`、`longCount`、`start`、`end` を用いており、更新状況が一目で確認できます。

手動で更新した場合は `npm run build` を実行して公開用バンドルに最新データを取り込むことを推奨します。

## クイックトンネルで外部確認したい場合

1. `cloudflared-windows-amd64.exe` を `tools` ディレクトリ直下に配置します。
2. 初回だけ Cloudflare ログインを実行します。
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/cloudflared_quick_tunnel.ps1 -Login
   ```
   ブラウザが開くので認証を完了させてください。
3. トンネルを開始して一時 URL を発行します。
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/cloudflared_quick_tunnel.ps1
   ```
   コンソールに表示される `https://*.trycloudflare.com` の URL をスマホ等から開くと、ローカル `http://127.0.0.1:8080` の UI を確認できます。
4. PowerShell を閉じたり `Ctrl + C` で停止するとトンネルも終了し、URL は無効になります（再実行すると新しい URL が発行されます）。

- launch_tunnel.bat をダブルクリックすると PowerShell 経由で同じ処理が実行されます (初回は launch_tunnel.bat -Login)。
