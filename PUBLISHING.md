# 公開手順

このmarketplaceフォルダ全体をGitHubリポジトリ `runpod-video-plugin` のルートとして公開してください。`plugins/production-board` だけをpushするとmarketplace登録ができません。

1. ライセンス・公開名義を決め、LICENSEとplugin metadataを設定。
2. 公開先は `huanshenyi/runpod-video-plugin`。READMEの導入例を確認。
3. `plugins/production-board/app` で `npm ci`、`npm test`、`npm run build` を実行。
4. ルートで `node plugins/production-board/scripts/check-package.mjs` を実行。
5. Git初期化・commit・pushを実行。

ローカルで試す場合：

```sh
codex plugin marketplace add /absolute/path/to/production-board-marketplace
codex plugin add production-board@production-board-cloud
```

新しいタスクでProduction Boardの初期設定を依頼します。初回認証は各利用者のRunpodアカウントで行います。GitHubでの公開と公式プラグインディレクトリへの審査・掲載は別です。
