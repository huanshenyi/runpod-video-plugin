# Runpod接続

初めての方は[READMEの初回認証手順](../../README.md#初回だけrunpodアカウントと認証の設定)から進めてください。APIキー作成、端末への一度だけの保存、接続確認を説明しています。

## 前提と認証

利用者自身のRunpodアカウントと [公式runpodctl](https://github.com/runpod/runpodctl) が必要です。実測に使ったCLIは2.14.0。実行ファイルは同梱しません。

```sh
runpodctl doctor
node scripts/runpod.mjs diagnose --workspace /absolute/path/to/my-video
```

`doctor` の案内に従って認証・SSHを設定してください。キーをチャットに貼る必要はありません。CLIの選択は環境変数 `RUNPODCTL_BIN`、未指定ならPATHの `runpodctl` です。

任意のローカルMCPラッパー `scripts/runpod-mcp.mjs` は `RUNPOD_API_KEY` を優先し、未設定なら `~/.runpod/config.toml` のキーを読みます。CLI側も同じキーを使用します。設定ファイルは利用者だけが読める権限にしてください。

## MCPも使う場合

先に `node scripts/board.mjs prepare` で依存関係を導入します。

```sh
node scripts/mcp-config.mjs
```

現在のNodeとチェックアウトのパスに合わせたTOMLを出力します。内容を確認し、自分のCodex設定にそのブロックを追加してMCPへ再接続します。スクリプトは設定を変更せず、キーも出力しません。インストール先を移動したら再生成してください。既存の同名接続へ重複追記しないでください。

これは共有APIキーを使う任意のstdio接続です。公式RunpodのOAuth接続とは別方式で、両方を同時に設定する必要はありません。公式Runpodプラグインの追加スキルは利用できますが、本ボードの必須依存ではありません。

## ローカル準備コマンド

```sh
node scripts/runpod.mjs help
node scripts/runpod.mjs plan --workspace /absolute/path/to/my-video --request /absolute/path/request.json
node scripts/runpod.mjs record --workspace /absolute/path/to/my-video --plan /absolute/path/plan.json
node scripts/runpod.mjs status --workspace /absolute/path/to/my-video
node scripts/runpod.mjs report --workspace /absolute/path/to/my-video --id RUN_UUID
```

`plan` はJSONを標準出力へ返します。必要ならファイルへ保存し `record` に渡します。requestの必須項目は `itemId, prompt, inputs, modelProfile, budgetUsd, maxHourlyUsd, deadlineAt`。modelProfileには固定した `modelId, revision, imageDigest, runtime` が必要です。架空のdigestで検証を通さないでください。入力素材・ボードrevisionも検証します。詳細は `app/lib/runpod/plan.mjs`。

`run/resume/cleanup` の使い方は[実行手順](docs/EXECUTION.md)を参照してください。既定はsimulate。H3 liveは独立期限controllerと明示的な実行指定が必要で、統合後の実機検証は未実施です。MCPのインフラ操作は課金や削除を伴うため、操作内容と予算を理解した上で使用します。

## 実行前に把握する制限

- 起動後の実所在地・料金を確認し、使用モデルの条件に合うリージョンを選択。
- モデル取得、起動、待機、ディスク、回収時間も課金対象。
- 途中失敗時は作成済みIDを照会してから再試行。別のリソースを消さない。
- ローカルタイマーはMacの停止・スリープに耐えず、確実な予算上限を保証しない。
- 素材回収とハッシュ照合後にPodを削除。停止だけではストレージ課金が残る場合がある。

[手動検証結果](docs/VALIDATION.md) / [参考ワークフロー](examples/workflows/README.md)

## H3 black-frame prevention

Manual H3 runs must follow [the pinned-runtime and recovered-video gates](docs/H3-VERIFIED-RUN.md). Do not use the template runtime unchanged or equate API success with valid media.
