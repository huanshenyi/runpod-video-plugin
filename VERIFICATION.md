# Alpha2 verification

- marketplace定義のplugin名とsource.pathの整合性を確認。
- プラグインmanifest検査、2つのスキル検査成功。
- 空の別データフォルダで初回セットアップを実行し、npm ci、TypeScript/Viteビルド、2カード生成が成功。
- CLI未導入状態を模擬し、binary_missingとconfigure-runpodを返すことを確認。有料クラウド操作なし。
- 2回目の初期化はreused=true、既存ボードを保持。
- runtimeから26テスト成功。localhostテストはサンドボックスの待受け制約により権限付きで再実行。
- macOS / Node23.4.0で確認。Windows/Linux実機、GitHub Actions、公開GitHubからのmarketplaceインストールは未確認。
- 既存のユーザーCodex設定・marketplace登録は変更していない。

初期化と有料生成は別です。run/resume/cleanupは未実装で、完全自動の生成・回収・削除を保証するリリースではありません。

## alpha.3 H3 regression prevention

- Added mandatory clean pinned-runtime and inference-package version gate for manual H3 runs.
- Added SHA256, resolution, frame-rate, decoded-frame-count and black-frame recovery gate. No paid resources created for this patch.
- Python regression tests reject old/dirty environments, missing packages, black/corrupt video, hash mismatch and wrong dimensions/count/rate; a visible encoded fixture passes.
- Real failed black output rejected (exit 1), real successful 768p output accepted (141 frames, zero black frames).
- Skill-driven execution must run both gates. Automatic cloud run/resume/cleanup remains disabled. Not a complete visual/audio quality evaluator or a hermetically locked GPU image.

## alpha.4 lifecycle integration（2026-09-30）

- H3単一動画のrun/resume/cleanup、永続intent、途中回収再開、独立期限controllerを実装。
- 課金なしのCLI実行でrunを途中停止し、resumeで完了、cleanup再実行を確認。
- 作成・投入の応答消失、重複コマンド、回収失敗、黒画面検査失敗、期限超過、削除失敗、素材変更を回帰テスト。
- 既定simulate。liveはHTTPS期限controllerと明示的な承認指定が必要。controllerは未配置で、この統合コードの実機試験は未実施。
- Qwen画像用アダプターは未統合。過去の画像生成実機検証と区別する。
- 新しい課金リソースは作成していない。詳細・制限はplugins/production-board/docs/EXECUTION.md。

最終ローカル検証：JavaScript 60テスト、Python 19テスト成功。TypeScript/Viteビルド、manifest・skill・パッケージ検査成功。
