#!/usr/bin/env python3
"""Read-only H3 environment and recovered-media gates. No cloud mutations."""
import argparse, hashlib, json, pathlib, subprocess, urllib.request
PROFILE = {"comfy_commit": "4ef23c34d950eecc37040a21ee1741a49d2e44b1", "comfy_version": "0.37.0", "packages": {"comfy-kitchen": "0.2.35", "comfy-aimdo": "0.5.5"}, "model_revision": "bf92c4091e333e69b8ca1998e0a669f15cb0832b"}

def check_environment(commit, dirty, system):
    if commit != PROFILE["comfy_commit"] or dirty:
        raise ValueError("H3 environment rejected: require clean pinned ComfyUI commit")
    if system.get("comfyui_version") != PROFILE["comfy_version"]:
        raise ValueError("Running ComfyUI is not the verified version; restart and recheck")
    packages = {p["name"]: p.get("installed") for p in system.get("comfy_package_versions", [])}
    if any(packages.get(k) != v for k, v in PROFILE["packages"].items()):
        raise ValueError("H3 environment rejected: inference dependency version mismatch")
    return {"status": "environment_verified", "profile": PROFILE, "system": system}

def check_video(filename, sha256, width, height, frames, fps):
    import av
    from PIL import ImageStat
    p = pathlib.Path(filename)
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1024*1024), b""): h.update(b)
    if h.hexdigest() != sha256.lower(): raise ValueError("Recovered SHA256 mismatch")
    count = black = 0
    with av.open(str(p)) as container:
        if len(container.streams.video) != 1: raise ValueError("Expected one video stream")
        stream = container.streams.video[0]
        if (stream.width, stream.height) != (width, height): raise ValueError("Unexpected resolution")
        if not stream.average_rate or abs(float(stream.average_rate)-fps) > .01: raise ValueError("Unexpected frame rate")
        for frame in container.decode(video=0):
            count += 1
            mean = ImageStat.Stat(frame.to_image().resize((64,36))).mean
            black += sum(mean)/len(mean) < 1
    if count != frames or count == 0: raise ValueError("Unexpected decoded frame count")
    # Fail closed. Legitimate dark shots require human review, never an automatic retry.
    if black/count > .10: raise ValueError("Black-frame gate failed; quarantine and stop batch")
    return {"status": "media_verified", "sha256": h.hexdigest(), "width": width, "height": height, "frames": count, "fps": fps, "black_frames": black, "visual_review_required": True}

def main():
    a = argparse.ArgumentParser(description=__doc__); sub = a.add_subparsers(dest="command", required=True)
    env = sub.add_parser("environment"); env.add_argument("--comfy-root", required=True); env.add_argument("--url", default="http://127.0.0.1:8188")
    v = sub.add_parser("video"); v.add_argument("--file", required=True); v.add_argument("--sha256", required=True)
    for key in ("width", "height", "frames"): v.add_argument("--"+key, type=int, required=True)
    v.add_argument("--fps", type=float, default=24)
    args = a.parse_args()
    try:
        if args.command == "environment":
            def git(*cmd): return subprocess.check_output(["git", "-C", args.comfy_root, *cmd], text=True).strip()
            with urllib.request.urlopen(args.url.rstrip("/")+"/system_stats", timeout=15) as response: system = json.load(response)["system"]
            result = check_environment(git("rev-parse", "HEAD"), git("status", "--porcelain", "--untracked-files=no"), system)
        else:
            if min(args.width,args.height,args.frames,args.fps) <= 0: raise ValueError("Expected dimensions/count/rate must be positive")
            result = check_video(args.file,args.sha256,args.width,args.height,args.frames,args.fps)
        print(json.dumps(result, indent=2))
    except Exception as error:
        print(json.dumps({"status": "rejected", "reason": str(error)})); raise SystemExit(1)
if __name__ == "__main__": main()
