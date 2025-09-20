# TOPIX-33 dataset utilities

このディレクトリには TOPIX 33 業種指数のデータを整備するスクリプトを置いています。

## 準備

1. `tools/topix33/sectors.json` に業種リストを定義済みです。必要に応じて J-Quants のインデックスコード（`jquantsCode`）を編集してください。
2. `JQUANTS_EMAIL` と `JQUANTS_PASSWORD` を環境変数として設定します。

Windows PowerShell の例:

```powershell
$env:JQUANTS_EMAIL = "your-account@example.com"
$env:JQUANTS_PASSWORD = "your-password"
```

## 履歴データの生成（J-Quants）

初期化の際は J-Quants API から任意期間のデータを取得します。

```powershell
python tools/topix33/update_dataset.py jquants `
  --date-from 2020-01-01 `
  --history data/topix33/history.json `
  --public web/public/data/topix33-history.json
```

> **NOTE:** 開発環境によっては `api.jpx-jquants.com` へのアクセスが制限されている場合があります。その場合はネットワーク設定をご確認ください。

## 日次更新（JPX リアルタイム指数）

JPX が提供する `indices_stock_price3.txt` を利用して日次の終値を追記します。タスク スケジューラ等で 1 日 1 回実行してください。

```powershell
python tools/topix33/update_dataset.py daily `
  --history data/topix33/history.json `
  --public web/public/data/topix33-history.json
```

スクリプトは指定した JSON を更新し、同じ内容を `web/public/data/topix33-history.json` にコピーします。React アプリ側はこの JSON を参照する想定です。

## 出力形式

`history.json` / `topix33-history.json` は以下のような構造になります。

```json
{
  "sectors": [
    {
      "id": "AirTransport",
      "nameJa": "空運業",
      "nameEn": "Air Transportation",
      "qcode": "343",
      "jquantsCode": "343",
      "series": [
        { "date": "2024-01-04", "close": 241.73, "source": "jquants" },
        { "date": "2025-09-19", "close": 241.52, "source": "jpx" }
      ]
    },
    ...
  ]
}
```

`source` には `jquants` または `jpx` が入ります。必要に応じて他ソースの値も追記可能です。


