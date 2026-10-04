# 期限監視の初回セットアップ

対象は **別ホストのLinux＋systemd＋Caddy** です。制作PCが停止しても稼働するホストと、そのホストに向くDNS名を用意してください。Node.js 22以上、Runpod CLI、Caddyの導入は前提です。ホスト代・ドメイン代はGPU予算と別です。この手順はサーバーを契約せず、GPUも作成しません。

## 1. 手元で配置用ファイルを生成

プラグインのディレクトリで実行します。出力先の親ディレクトリは事前に用意し、出力先そのものは存在しない場所を指定します。

```sh
node scripts/deadline-setup.mjs bundle /absolute/deadline-bundle deadline.example.com
```

ドメインは自分のものに置き換えます。生成物は既存controllerとproviderの最小コード、systemd unit、Caddy設定、初回インストーラーです。APIキー・トークン・ローカル設定はコピーしません。既存の出力ディレクトリへの上書きは拒否します。

このディレクトリをSSH/SCPなどで別ホストへ転送します。生成先は所有者のみアクセスできるため、転送も生成したユーザーで行ってください。

## 2. 別ホストへインストール

配置先に `/usr/bin/node`（22以上）と `/usr/local/bin/runpodctl` があることを確認します。別パスの場合は、実在するバイナリへのリンクを管理者が用意するか、インストーラーとunitの両方を修正します。配布元の公式手順に従ってCLIを導入してください。

転送したディレクトリ内で実行します。

```sh
sudo sh install.sh
```

専用ユーザー `runpod-deadline`、コード `/opt/runpod-deadline`、unitを作成します。既存インストールは上書きしません。サービスはまだ起動しません。npm依存の導入は不要です。

## 3. ホスト側で秘密情報を設定

```sh
sudoedit /etc/runpod-deadline.env
```

以下の2項目をホスト側で入力します。値をチャット・コマンド引数・リポジトリに置かないでください。

```text
RUNPOD_API_KEY=自分のRunpodキー
RUNPOD_DEADLINE_TOKEN=32文字以上のランダムな共有トークン
```

共有トークンはパスワードマネージャーなどで生成・保管します。APIキーは手元のCLIと同じものを利用できますが、この別ホストにも安全に設定する必要があります。Runpod側のPod参照・作成・削除に必要な権限を持たせます。

環境ファイルはroot所有・0600で、systemdが読み込みます。空のAPIキーや短いトークンではサービス起動を拒否します。APIキーの有効性・権限まで起動時に確認するものではありません。

## 4. HTTPSとサービスを起動

DNSのA/AAAAレコードをホストへ向け、Caddyの証明書取得に必要な80/443番ポートを開けます。4319番は公開しません。生成された `Caddyfile` のサイト設定を既存のCaddy設定へ追加してください。既存サイトを上書きしないでください。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl enable --now runpod-deadline
sudo systemctl status runpod-deadline
```

Caddyが未起動の場合は、設定検証後にそのサービスを起動してください。HTTPSが使えるまでGPU生成に進みません。Authorizationヘッダーをアクセスログへ追加しないでください。

状態は `/var/lib/runpod-deadline` に保存します。サービス異常終了時はsystemdが再起動し、ホスト再起動後も起動します。状態と削除済み記録を消すと二重実行防止が失われるため、更新・バックアップ時も保持してください。

## 5. 手元から診断

制作PCの安全な環境変数設定に、同じ共有トークンとHTTPS URLを設定します。Runpod APIキーをこのトークンの代わりに使わないでください。

- `RUNPOD_DEADLINE_URL`: `https://deadline.example.com`
- `RUNPOD_DEADLINE_TOKEN`: ホストに設定した共有トークン

```sh
node scripts/deadline-setup.mjs diagnose
```

HTTPS、認証、サービス識別、時刻差（60秒以内）を確認します。10秒でタイムアウトし、リダイレクトに認証情報を転送しません。結果にトークンやサーバーのエラー本文を出しません。失敗時は終了コード1です。

| 結果コード | 確認すること |
| --- | --- |
| invalid_configuration | HTTPS URLと32文字以上のトークン。URLにパスや認証情報を含めない |
| unauthorized | ホストと制作PCのトークン一致 |
| connection_failed | DNS、証明書、ポート、Caddy、systemdの状態 |
| http_error | プロキシ設定とサービスの稼働状態 |
| invalid_health_or_clock | 接続先サービス、両ホストの時刻同期 |

**成功は接続確認のみです。** Runpod認証の有効性、作成・削除権限、PC停止時の期限削除を保証しません。新しい課金予算を決めて統合版を実機検証する段階で、それらを確認します。

## 運用・復旧

- 外部監視からも `/health` を認証付きで確認し、停止に気付けるようにします。診断コマンドは常駐監視ではありません。
- controller停止・Runpod API障害・Pod作成の応答不明では手動確認が必要になる場合があります。厳密な金額上限は保証できません。
- `journalctl -u runpod-deadline` でサービスの問題を調べます。ログを共有する前に秘密情報を確認します。
- 更新は活動中のrunがないことを確認し、状態をバックアップしてから行います。初回インストーラーによる上書き更新は非対応です。
- アンインストールは担当するPodが全て削除済みと確認してから行います。監視を先に止めないでください。

詳細な状態・復旧の制限は [controller仕様](DEADLINE-CONTROLLER.md)、実行手順は [run/resume/cleanup](EXECUTION.md) を参照してください。

このセットアップはファイル生成とローカルテストで検証済みです。Linuxホストへの実配置、HTTPS開通、再起動、実Podの期限削除は別途実機検証が必要です。
