# Runpod Video Plugin

Codexにmarketplaceから導入し、初回利用時にローカル制作ボードとRunpod接続をセットアップする実験版です。**0.1.0-alpha.3**。

## インストール

GitHubリポジトリ名は `runpod-video-plugin` です。公開先は `huanshenyi/runpod-video-plugin` です。

```sh
codex plugin marketplace add huanshenyi/runpod-video-plugin --ref main
codex plugin add production-board@production-board-cloud
```

新しいCodexタスクで、次のように依頼します。

> Production Boardを初期設定して、今の動画プロジェクトの制作ボードを開いて。

Codexがworkspaceを確認し、依存導入・ビルド・サンプル初期化・Runpod接続診断を実行します。Runpod CLIが未導入なら導入し、認証が未設定なら公式 `runpodctl doctor` のローカル入力を案内します。APIキーをチャットへ貼りません。設定済みなら再入力不要です。

**2コマンドはプラグインのインストールです。環境初期化は最初にプラグインを使う時に実行されます。** 初期化によって有料GPUは起動しません。Node.js22以上・npmを前提とします。CLIのインストールやコマンド実行に対する端末の権限確認は残ります。

## 現在の機能

- シーン・画像・動画候補を確認するローカル制作ボード。
- 初回セットアップ、同一キーを使うRunpod CLI/任意MCP、ローカル実行計画と台帳。
- 手動での画像・動画生成→回収→削除は実測済み。

**有料生成の一括 `run/resume/cleanup` はまだ未実装**です。参考プラグインMiniMax-H3-Cloudと同じ生成機能が完成したという意味ではありません。

## ファイル構成

```text
.agents/plugins/marketplace.json
plugins/production-board/
  plugin.json
  .codex-plugin/plugin.json
  skills/
  scripts/onboard.mjs
  scripts/runtime.mjs
  app/
```

marketplace名は `production-board-cloud`、plugin名は `production-board`。GitHubリポジトリ名と別です。

初期化したruntimeはmacOS/Linuxで `~/.local/share/production-board/runtimes/`（XDG_DATA_HOME対応）、WindowsでLOCALAPPDATA配下へ保存します。`PRODUCTION_BOARD_DATA_DIR` で変更できます。素材・ボードは指定workspaceに保存し、プラグインキャッシュにユーザーデータを置きません。更新後は新しいソースhashのruntimeを準備します。古いruntimeは自動削除せず、不要になったら利用者が整理します。

## ドキュメント

- [制作ボードとデータ形式](plugins/production-board/README.md)
- [Runpod設定](plugins/production-board/RUNPOD.md)
- [実測結果](plugins/production-board/docs/VALIDATION.md)
- [残作業](plugins/production-board/TODO.md)
- [公開手順](PUBLISHING.md)

[参考にした導入方式](https://github.com/Sac-Y/MiniMax-H3-Cloud) / [Codex公式パッケージ文書](https://developers.openai.com/plugins/build/plugins)。参考リポジトリのコードはコピーしていません。
