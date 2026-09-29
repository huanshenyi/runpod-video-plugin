# ComfyUI参考グラフ

`qwen-image-2.1.json` は画像生成、`h3-image-to-video.json` は生成画像からの動画生成用APIグラフです。実測時の設定を参考として収録しています。モデル重みや入力画像は含みません。

H3はComfyUIのinputフォルダ内の `validation-input.png` を参照します。グラフだけを送信しても、モデルや入力ファイルがなければ動作しません。ComfyUIの `/prompt` には `{"prompt": <グラフ>}` として送信します。これらはUI用ワークフローJSONではありません。

モデル名は各グラフのloaderに記載しています。必要ファイルだけを取得し、現在のモデル条件と配置地域を確認してください。ランタイム・revisionは [検証結果](../../docs/VALIDATION.md) を参照。

- [Qwenモデル配布元](https://huggingface.co/Comfy-Org/Qwen-Image-2.1)
- [H3モデル配布元](https://huggingface.co/Comfy-Org/MiniMax-H3)
- [ComfyUIのH3公式手順](https://docs.comfy.org/tutorials/video/minimax/minimax-h3-native)

このグラフの収録は、有料リソースの自動起動やモデル利用権の付与を意味しません。
