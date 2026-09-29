# run / resume / cleanup（alpha.4）

単一H3動画の状態管理をCLIへ統合しました。既定は **simulate（課金なし・生成なし）**。模擬テストと過去の実機手動検証は別で、統合コードの実機検証はまだです。Qwen画像用アダプターは未統合です。

## 1. 計画を保存する

従来どおり `plan --workspace WORKSPACE --request request.json` のJSONを保存し、`record --workspace WORKSPACE --plan plan.json` で登録します。表示されたrunIdを以降の全コマンドで使います。`plan` のたびに新しいrunIdとなるので、途中再開時に計画を作り直さないでください。

計画には素材・グラフのハッシュ、予算、最大時給、期限を固定します。変更する場合は新しい計画が必要です。操作ごとの認証キーは台帳に保存しません。

## 2. 課金なしで流れを確認する

```sh
node scripts/runpod.mjs run --workspace WORKSPACE --id RUN_UUID --mode simulate --steps 2
node scripts/runpod.mjs status --workspace WORKSPACE --id RUN_UUID
node scripts/runpod.mjs resume --workspace WORKSPACE --id RUN_UUID --mode simulate
node scripts/runpod.mjs cleanup --workspace WORKSPACE --id RUN_UUID --mode simulate
node scripts/runpod.mjs report --workspace WORKSPACE --id RUN_UUID
```

`--steps` は状態を何段階進めるかの上限です。省略時は完了まで進めます。simulateは専用の模擬リソース状態とテキスト成果物を保存し、実際のGPUや動画は作りません。同じrunIdをliveへ切り替えることはできません。

## 3. liveの事前準備

- 既存のCLI認証・SSH鍵を使います。Pythonは `scripts/media-check-requirements.txt` の依存を導入し、必要なら `PRODUCTION_BOARD_PYTHON` に実行ファイルを設定します。
- [H3ドライバー設定](H3-DRIVER.md)に従いrequestへ `executionConfig` を追加します。`graph` はworkspace相対のAPIグラフ、`inputs` は計画の `inputs` と同じ素材パスを `source` に持ちます。グラフ内のプロンプト・seedは計画と一致させます。ハッシュはplan作成時に記録されます。
- `executionConfig.provision` に `gpuId,image,containerDiskInGb,volumeInGb` を指定。`image` は実在するコンテナdigestを含む `modelProfile.imageDigest` と完全一致させます。公開SSH鍵は `publicKey`、配置国は `countryCode`、配置先は `dataCenterIds` に指定できます。秘密鍵・APIキーを入れてはいけません。`bootstrap:true` はprovisionの外に置きます。
- `executionConfig.storageHourlyUsd` はストレージの見積時給です。controllerは独自の保守的ストレージ枠と10%予備費でも検査します。GPU取得・モデル取得・待機・回収も費用に含めます。
- [独立期限controller](DEADLINE-CONTROLLER.md)を利用PCとは別の常時稼働環境に配置し、HTTPS経由で接続します。`RUNPOD_DEADLINE_URL` と `RUNPOD_DEADLINE_TOKEN` をローカル環境変数に設定します。キーはチャットやリポジトリへ保存しません。未設定・疎通不良ならPod作成前に拒否します。

```sh
node scripts/runpod.mjs run --workspace WORKSPACE --id RUN_UUID --mode live --authorize true
node scripts/runpod.mjs resume --workspace WORKSPACE --id RUN_UUID --mode live --authorize true
node scripts/runpod.mjs cleanup --workspace WORKSPACE --id RUN_UUID --mode live --authorize true
```

liveは新しい予算の承認を受けた実行でのみ使います。controllerはPodを作成したIDだけを記録・削除します。現状はPodと付属ディスクのみで、ネットワークボリュームを作成しません。ストレージ残存を避けるため停止ではなく削除します。

## 状態と再実行

`planned → ready → create_pending → allocated → preparing → prepared → submit_pending → generating → generated → recovering → recovered → validating → validated → cleanup_pending → complete`

- 生成結果 `outcome` と削除確認 `cleanupStatus` は別です。失敗しても削除済みという状態を表現します。
- Pod作成の応答不明は `reconciliation_required`。controller側の作成記録を照合し、名前だけで別Podを取り込まず、作成を繰り返しません。
- 生成投入の応答不明は `submit_pending`。リモートの永続マーカー・キュー・履歴を照合します。投入済みか判別できない場合は再送しません。
- 回収の通信失敗は `recovering`。resumeで同じジョブから回収します。検査前にローカルファイルが消えた場合も再回収へ戻し、生成し直しません。
- 検査不合格は `validation_failed` として片付けます。API成功だけでは完了にしません。目視・音声の最終品質判定は別途必要です。
- 一時的な接続失敗では現在の状態とエラーを保存して戻ります。resumeかcleanupを使ってください。期限controllerは独立して削除を継続します。
- 完了・失敗・中止後にrunを繰り返しても新規リソースは作りません。再生成には新しい計画を使います。

未回収・未検査の素材を放棄して削除する場合だけ `cleanup ... --discard true` を指定します。通常のcleanupは未検査素材の放棄を拒否します。削除の応答が失われた場合も、再照会で不存在が確認されるまで `cleanup_pending` です。

プロセス強制終了でローカルロックが残った場合、`unlock --workspace WORKSPACE --id RUN_UUID` が同じホストの所有PIDの終了を確認して解除します。稼働中・別ホスト・不明な所有者は解除しません。その後resumeします。

## 制限

Runpodに作成の完全な冪等APIや削除予約がないため、controller自体が「クラウドで作成成功した直後、ID保存前」に停止した場合は自動復旧できない可能性があります。この場合は運用者による照合が必要です。controller停止・ネットワーク障害・削除API障害まで含む厳密な課金上限を保証しません。未知のPodを名前だけで削除する実装にはしていません。

実機検証で残るのは新規テンプレートbootstrap、CLIのSSH情報、途中切断からの回収、controllerを使った期限削除です。今回は実装・模擬検証だけで課金リソースは作成していません。
