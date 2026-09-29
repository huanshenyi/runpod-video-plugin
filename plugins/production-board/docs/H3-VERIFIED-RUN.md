# H3 generation gates

The template `runpod/comfyui:1.3.2-comfyuiv0.30.0-cuda13.0` is a bootstrap environment, not a verified inference runtime. Its original ComfyUI returned a successful job containing only black frames. Updating to the profile below produced a visible 1344×768, 141-frame FL2VA clip with the same inputs, seed and graph. The individual upstream cause has not been isolated. Do not promise that these checks prevent all visual defects.

## Before submitting any H3 job

1. Record budget, deadline and owned resource IDs. Do not start a batch during setup.
2. Install official ComfyUI commit `4ef23c34d950eecc37040a21ee1741a49d2e44b1` and its requirements using the same Python environment that launches the server. Restart ComfyUI. Do not use `main`, `latest`, or merely check that H3 nodes exist. The successful profile used PyTorch 2.10.0+cu130 and Python 3.12.3 on RTX PRO6000 Blackwell; other hardware/runtime combinations require a new pilot.
3. On the Pod, execute `python3 <scripts>/h3-guard.py environment --comfy-root <comfy-root>`. Save JSON output in the run directory. A nonzero exit forbids prompt submission. This checks the checkout, tracked modifications, running server version and inference dependency versions. Use the local server of that checkout; it is not an attestation of arbitrary remote servers.
4. Obtain all five H3 weights at Hugging Face revision `bf92c4091e333e69b8ca1998e0a669f15cb0832b` of `Comfy-Org/MiniMax-H3`, as named in the example graph. Download to temporary names and only rename after successful transfer. Record sizes and SHA256; the environment gate does not hash weights.
5. Generate one pilot only. Persist submission state and prompt ID before any further action; reconcile ambiguous responses instead of resubmitting. Recheck environment after every restart or change.

## After generation and local recovery

Use a dedicated local Python environment with `pip install -r <scripts>/media-check-requirements.txt`. Run the gate with expected resolution, actual planned native frame count and the SHA256 recorded on the Pod:

```sh
python <scripts>/h3-guard.py video --file <recovered.mp4> --sha256 <remote-sha256> --width 1344 --height 768 --frames 141 --fps 24
```

Save the JSON result; proceed only on exit 0. The gate hashes the entire file, decodes every video frame, verifies size/rate/count and rejects when more than 10% of frames have mean RGB brightness below 1/255. Corruption or missing decoder dependencies also fail closed. Supply native frame count, not rounded storyboard seconds.

This is a technical media check, not artistic acceptance: review first/middle/last frames, motion and audio/lines separately. A dark shot can be flagged intentionally; retain it for human review without silently bypassing the check or automatically spending money retrying. Black, corrupt or mismatched output is quarantined as `validation_failed`, never `complete`. Stop the batch. A known failed attempt may be retried within the authorized budget only after a documented correction; preserve its files and history under a separate attempt.

Only after a passing pilot and visual review may an authorized multi-shot run continue. If the user requested one shot, recover it and immediately delete owned resources. Recover/hash each output before deletion, verify fresh Pod/volume listings, and record elapsed time plus estimated versus settled costs. On failure or exhausted budget, also clean up owned resources; do not keep a GPU alive awaiting a future turn.

These commands are mandatory gates for the skill-driven manual path. Paid `run/resume/cleanup` orchestration remains disabled; future runners must call both gates before marking a shot complete.
