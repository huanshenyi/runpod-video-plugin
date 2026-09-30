# Production Board — Codex + Runpod

ローカルで動画のシーン・素材・修正メモを確認し、Runpodでの制作を準備するCodex向け実験版プラグインです。**0.1.0-alpha.5**。

## できること

- シーンMarkdownからカードを作り、画像・動画候補、選択素材、尺、コメントを確認・保存。
- 保存履歴とrevisionによる競合検知。
- Runpod CLIと任意のローカルMCP接続で、同じAPIキーを使用。
- 実行計画の検証、ローカル台帳、状態・レポート出力。

CodexによるCLI・MCP・SSHの操作で、画像生成→動画生成→ローカル回収→Pod削除は実測済みです。alpha.4で **`run / resume / cleanup` を統合**しました。既定は課金なしのsimulateで、H3 liveは独立期限controllerが必要です。統合後の実機検証は未実施です。[実行手順](docs/EXECUTION.md)。ボードを開いただけでGPUは起動しません。[実測と制限](docs/VALIDATION.md) / [残作業](TODO.md)。

## Codex導入後の通常の使い方

marketplaceから導入後、新しいタスクで「Production Boardを初期設定して」と依頼します。Codexが `scripts/onboard.mjs --workspace <絶対パス>` を実行し、プラグイン外のruntimeへ依存導入・ビルド・初期化を行います。以下の手動手順は開発者向けです。

## 手動で試す

Node.js 22以上とnpmが必要です。このリポジトリのルートから実行します。

```sh
node scripts/board.mjs prepare
node scripts/board.mjs init --workspace /absolute/path/to/my-video
node scripts/board.mjs start --workspace /absolute/path/to/my-video --port 4317
```

表示された `http://127.0.0.1:4317` を開きます。停止は起動ターミナルのCtrl+C。次回は `start` だけで起動できます。別サービスがポートを使っていれば `--port` を変更してください。

`init` はオリジナルの2カードと空の素材フォルダを作ります。既存READMEは上書きしません。動画プロジェクトはプラグインの外に置いてください。

## 自分のシーンを読み込む

初期パスは `videos/scene-01/README.md` です。次の列順で、IDは数字、素材リンクはフォルダにします。`Images` / `Videos` は `画像` / `動画` でも読み込めます。

```markdown
# Scene 01

| ID | Title | Duration | Images | Videos |
| --- | --- | --- | --- | --- |
| 01 | Arrival | Undecided | [Images](./images/01/) | [Videos](./videos/01/) |
```

任意の既存シーンは初回起動前に `<workspace>/board/config.json` で指定できます。

```json
{
  "sourcePath": "videos/my-film/production/scene-01/README.md",
  "project": {"id": "my-film", "title": "My Film"}
}
```

Runpod計画で使う素材は `videos/<project.id>/` 配下に置きます。保存済みの `board/project.json` があれば、その `project.sourcePath` が優先されます。1つのworkspaceにつき1ボードです。初回取り込み後のREADME変更はカード追加・削除として自動同期されません。

ボード状態は `board/project.json`、履歴は `board/history/` に保存します。原稿と素材は上書きしません。コメントは自動でCodexに送信されないため、「ボードの修正コメントを確認して」と依頼してください。

## Codexで使う

`plugin.json` と互換用 `.codex-plugin/plugin.json`、2つのスキルを同梱しています。まずCodexへ、このチェックアウトの `skills/production-board/SKILL.md` または `skills/runpod-workflow/SKILL.md` を読んで作業するよう依頼できます。

インストール方式は [Codex公式プラグイン文書](https://developers.openai.com/plugins/build/plugins) に従ってください。この版は個人marketplaceやCodex設定を自動変更しません。GitHubでのソース公開と、公式プラグインディレクトリへの申請は別です。

Runpodの設定は [RUNPOD.md](RUNPOD.md) を参照。Claude向けの正式な登録・互換性は未検証です。

## 開発・公開

```sh
cd app
npm ci
npm test
npm run build
cd ..
node scripts/check-package.mjs
```

テストとCIはローカルの模擬データを使い、有料リソースを作りません。[公開手順](docs/PUBLISHING.md) を参照してください。

ライセンスは未指定です。公開者が配布条件を選び、LICENSEとmanifestに反映してください。依存ソフトウェア・モデルのライセンスは、それぞれの配布元の条件に従います。モデル重み・作品素材・APIキーは同梱しません。Runpod/OpenAIの公式製品ではありません。

## MiniMax H3プロンプトの作成

alpha.5から [h3-prompt-writing](skills/h3-prompt-writing/SKILL.md) を同梱しています。別のスキル導入やRunpod認証なしで、シーン・選択画像・日本語セリフからH3用プロンプトを作れます。

> このシーンと開始画像から、MiniMax H3用のプロンプトを作って。セリフは日本語のまま、動画生成はまだしないで。

開始画像（I2VA）・開始/終了画像（FL2VA）の手順、時間配分、音声指定、例を内包しています。T2VA・L2VA・Ref2VAは草案作成のみで、現在の統合runnerでは実行できません。生成を依頼した場合は既存のRunpod実行手順へ引き継ぎます。プロンプト作成だけでGPUは起動しません。
