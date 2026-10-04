# Runpod Video Plugin

Codexにmarketplaceから導入し、初回利用時にローカル制作ボードとRunpod接続をセットアップする実験版です。**0.1.0-alpha.5**。

[最新の実装・検証状況](plugins/production-board/docs/CURRENT-STATUS.md)。旧版や手動検証との違いを確認してください。

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

## 初回だけ：Runpodアカウントと認証の設定

プラグインのインストールと、Runpodの認証は別です。**同じPC・OSユーザーで保存したキーが有効な間は、通常この設定は一度だけ**です。既に `runpodctl` が接続できる方は「3. 接続確認」へ進んでください。PC変更・キー失効や再発行・設定削除時は再設定が必要です。

### 1. RunpodでAPIキーを作る（利用者の操作）

1. [RunpodコンソールのCredentials](https://console.runpod.io/user/credentials)を開き、自分のRunpodアカウントでログインします。未登録ならアカウントを作成します。
2. **API Keys → Create API Key** を開き、名前を `runpod-video-plugin` などにします。
3. 利用範囲に合う権限を選びます。接続確認には読み取り権限、実際のPod作成・削除やSSH公開鍵登録には対応する書き込み権限が必要です。Read Onlyでは生成環境の操作はできません。Restrictedの細かな組み合わせは本プラグインでは未検証です。全権限を必須とはしていません。
4. **Create** を押し、作成されたキーをコピーして安全な場所へ保存します。

> **画像差し込み枠 ①：Credentials → API Keys の場所**<br>
> 保存予定：`docs/images/setup/01-api-keys.png`

> **画像差し込み枠 ②：Create API Key の名前・権限設定**<br>
> 保存予定：`docs/images/setup/02-create-api-key.png`<br>
> 作成前の画面を撮影し、発行されたキー自体は写さないでください。

画面名は変更される場合があります。[Runpod公式の認証情報ガイド](https://docs.runpod.io/get-started/credentials)も参照してください。

### 2. ローカル端末でキーを一度設定する（利用者の操作）

初期設定でCLI未導入と表示された場合は、Codexに「Runpod CLIを導入して、初回認証を案内して」と依頼します。[公式CLIの導入手順](https://github.com/runpod/runpodctl#install)も利用できます。

自分で入力できるローカル端末で実行します。

```sh
runpodctl doctor
```

APIキーを求められたら、その**端末の入力欄**へ貼り付けます。Codexのチャット、README、スクリーンショットには貼りません。`doctor` は対話形式でキーを保存し、必要に応じてSSHキーペアの作成・公開鍵登録も案内します。SSH鍵はPodへの接続用で、APIキーとは別ですが、別サービスへのログインは不要です。秘密鍵はローカルに保持します。

> **画像差し込み枠 ③：ローカル端末のdoctor実行画面**<br>
> 保存予定：`docs/images/setup/03-doctor.png`<br>
> キー入力前か、入力部分を完全に隠した画面を使用してください。

キーは通常 `~/.runpod/config.toml` に保存されます。`RUNPOD_API_KEY` 環境変数が設定されている場合はそちらが優先されます。既存の環境変数が古いキーを指していないかも確認してください。[公式CLIの認証説明](https://github.com/runpod/runpodctl)に基づく手順です。

### 3. 接続確認してCodexへ戻る

`doctor` の結果で `healthy: true`、`api_key`・`api_connectivity`・`ssh_key` の各チェックが `pass` であることを確認します。エラーが残っている場合は、キーを伏せてエラー内容だけをCodexへ伝えてください。

> **画像差し込み枠 ④：healthy: true の完了結果**<br>
> 保存予定：`docs/images/setup/04-healthy.png`<br>
> メールアドレス、個人名を含むローカルパス、キーは隠してください。

Codexに「Runpodの初回認証が完了したので、接続を確認して」と伝えます。Codexがプラグインの `diagnose` で接続を再確認します。以降は保存した認証情報を使うので、毎回ブラウザでログインしたりキーを取得したりする必要はありません。

このプラグインはCLIだけでも利用でき、**MCPへの別ログインは必須ではありません**。任意の同梱MCPラッパーもCLIと同じAPIキーを読みます。公式RunpodのOAuth型MCPを別に追加すると、その接続には別の認可が必要です。両方の設定は不要です。詳細は[Runpod設定](plugins/production-board/RUNPOD.md)を参照してください。

認証設定だけではGPUを作成しません。実際の生成時には利用可能な残高・支払い設定と予算が必要です。alpha.4では `run/resume/cleanup` を実装しました。既定は課金なしの模擬実行で、liveは独立期限監視の設定が必要です。統合後の実機検証は未実施です。

## 現在の機能

- シーン・画像・動画候補を確認するローカル制作ボード。
- 初回セットアップ、同一キーを使うRunpod CLI/任意MCP、ローカル実行計画と台帳。
- 手動での画像・動画生成→回収→削除は実測済み。

**`run/resume/cleanup` の状態管理・H3単一動画アダプターを実装し、模擬テストで検証済み**です。既定はsimulate。liveには別ホストの期限controllerと明示的な実行指定が必要で、統合版の実機検証は未実施です。Qwen画像の自動実行は未統合です。

[実行・再開・片付けの手順](plugins/production-board/docs/EXECUTION.md) / [期限監視のセットアップ](plugins/production-board/docs/DEADLINE-SETUP.md)

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

## MiniMax H3プロンプトの作成

alpha.5から [h3-prompt-writing](plugins/production-board/skills/h3-prompt-writing/SKILL.md) を同梱しています。別のスキル導入やRunpod認証なしで、シーン・選択画像・日本語セリフからH3用プロンプトを作れます。

> このシーンと開始画像から、MiniMax H3用のプロンプトを作って。セリフは日本語のまま、動画生成はまだしないで。

開始画像（I2VA）・開始/終了画像（FL2VA）の手順、時間配分、音声指定、例を内包しています。T2VA・L2VA・Ref2VAは草案作成のみで、現在の統合runnerでは実行できません。生成を依頼した場合は既存のRunpod実行手順へ引き継ぎます。プロンプト作成だけでGPUは起動しません。
