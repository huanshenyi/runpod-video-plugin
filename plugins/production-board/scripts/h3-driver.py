#!/usr/bin/env python3
"""Local H3 driver. SSH helper owns remote Comfy work; stdout is one JSON result."""
import argparse, hashlib, importlib.util, json, os, pathlib, re, shlex, shutil, subprocess, sys
BASE = pathlib.Path(__file__).resolve().parent

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()

def local(workspace, value):
    path = pathlib.Path(value).expanduser()
    if not path.is_absolute(): path = workspace / path
    path = path.resolve()
    if not path.is_relative_to(workspace): raise ValueError("Material/output path must stay inside workspace")
    return path

def config(request):
    workspace = pathlib.Path(request["workspace"]).resolve()
    run = request["run"]; cfg = run["plan"]["executionConfig"]
    token = run["runId"]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", token): raise ValueError("Unsafe runId")
    return workspace, run, cfg, token

def preflight(request):
    workspace, run, cfg, token = config(request)
    for name in ("ssh", "scp"):
        if not shutil.which(name): raise ValueError(name + " is required")
    # Dependencies are checked BEFORE any Pod is created.
    import av
    from PIL import Image
    graph_path = local(workspace, cfg["graph"])
    if not re.fullmatch(r"[a-f0-9]{64}", str(cfg.get("graphSha256", ""))) or digest(graph_path) != cfg["graphSha256"]: raise ValueError("Graph SHA256 mismatch")
    graph = json.loads(graph_path.read_text())
    if not isinstance(graph, dict) or not graph: raise ValueError("Expected Comfy API graph object")
    expected = cfg["expected"]
    for field in ("width", "height", "frames", "fps"):
        if not isinstance(expected.get(field), (int, float)) or expected[field] <= 0: raise ValueError("Invalid expected media shape")
    nodes = [n for n in graph.values() if n.get("class_type") == "MiniMaxH3ImageToVideo"]
    if len(nodes) != 1: raise ValueError("Require exactly one H3 image-to-video node")
    if nodes[0]["inputs"].get("prompt") != run["plan"].get("prompt"): raise ValueError("Graph and approved prompt disagree")
    noise = [n for n in graph.values() if n.get("class_type") == "RandomNoise"]
    if len(noise) != 1 or noise[0]["inputs"].get("noise_seed") != run["plan"].get("seed"): raise ValueError("Graph and approved seed disagree")
    for src, dst in (("width", "width"), ("height", "height"), ("length", "frames")):
        if nodes[0]["inputs"].get(src) != expected[dst]: raise ValueError("Graph and expected media shape disagree")
    video_nodes = [n for n in graph.values() if n.get("class_type") == "CreateVideo"]
    if len(video_nodes) != 1 or video_nodes[0]["inputs"].get("fps") != expected["fps"]: raise ValueError("Graph and expected FPS disagree")
    if len([n for n in graph.values() if n.get("class_type") == "SaveVideo"]) != 1: raise ValueError("Require one SaveVideo output")
    sources = cfg.get("inputs", [])
    targets = set()
    for item in sources:
        target = item["target"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", target) or target in (".", "..") or target in targets: raise ValueError("Invalid/duplicate input target")
        targets.add(target)
        source = local(workspace, item["source"])
        if not source.is_file(): raise ValueError("Missing input material")
        with Image.open(source) as image: image.verify()
        if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", ""))) or digest(source) != item["sha256"]: raise ValueError("Input SHA256 mismatch")
    required = {n["inputs"]["image"] for n in graph.values() if n.get("class_type") == "LoadImage"}
    if required != targets: raise ValueError("Stage every LoadImage input explicitly")
    ssh = cfg.get("ssh", {})
    if not pathlib.Path(ssh.get("keyFile", "~/.runpod/ssh/runpodctl-ssh-key")).expanduser().is_file(): raise ValueError("SSH private key missing; run runpodctl doctor first")
    return {"ready": True, "status": "ready", "graphSha256": digest(graph_path)}

def ssh_options(request):
    workspace, run, cfg, token = config(request)
    conn = dict(cfg.get("ssh", {})); conn.update(run.get("execution", {}).get("ssh", {}))
    if not conn.get("host"):
        cli = request.get("runpodctl") or os.environ.get("RUNPODCTL_BIN") or cfg.get("runpodctl", "runpodctl")
        pod = run["execution"]["podId"]
        info = json.loads(subprocess.check_output([cli, "ssh", "info", pod, "-o", "json"], stderr=subprocess.DEVNULL, timeout=30))
        if isinstance(info.get("ssh"), dict): info = info["ssh"]
        if isinstance(info.get("direct"), dict): info = info["direct"]
        if info.get("username"): info["user"] = info["username"]
        if info.get("ip"): info["host"] = info["ip"]
        for key in ("host", "port", "user", "keyFile"):
            if info.get(key): conn[key] = info[key]
        command = info.get("command") or info.get("sshCommand") or info.get("ssh_command")
        if not conn.get("host") and command:
            args = shlex.split(command)
            if not args or args[0] != "ssh": raise ValueError("Unexpected CLI SSH info")
            for i, arg in enumerate(args):
                if arg == "-p": conn["port"] = args[i+1]
                if re.fullmatch(r"[A-Za-z0-9_-]+@[A-Za-z0-9.:-]+", arg): conn["user"], conn["host"] = arg.split("@")
    host = str(conn.get("host", "")); user = str(conn.get("user", "root"))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", host) or not re.fullmatch(r"[A-Za-z0-9_-]+", user): raise ValueError("Cannot resolve safe SSH endpoint")
    port = int(conn.get("port", 22))
    if not 1 <= port <= 65535: raise ValueError("Invalid SSH port")
    known = pathlib.Path(conn.get("knownHostsFile", str(workspace / ".production-board" / "known_hosts"))).expanduser()
    known.parent.mkdir(parents=True, exist_ok=True)
    key = str(pathlib.Path(conn.get("keyFile", "~/.runpod/ssh/runpodctl-ssh-key")).expanduser())
    options = ["-i", key, "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile="+str(known)]
    return options, str(port), user+"@"+host

def invoke_remote(request, action):
    workspace, run, cfg, token = config(request)
    options, port, endpoint = ssh_options(request)
    # Only configuration needed by the remote helper is transmitted, never provider credentials.
    payload = {"action": action, "token": token, "comfyRoot": cfg.get("comfyRoot", "/workspace/runpod-slim/ComfyUI"), "remotePython": cfg.get("remotePython"), "bootstrap": cfg.get("bootstrap", cfg.get("provision", {}).get("bootstrap", False)), "ownedPod": bool(run.get("execution", {}).get("podId"))}
    if action == "prepare":
        payload["graph"] = json.loads(local(workspace, cfg["graph"]).read_text())
        payload["inputs"] = [{"target": i["target"], "sha256": digest(local(workspace, i["source"]))} for i in cfg.get("inputs", [])]
    payload["guardSource"] = (BASE / "h3-guard.py").read_text()
    code = (BASE / "h3-remote.py").read_text()
    import base64
    bootstrap = "import base64,json;REQUEST=json.loads(base64.b64decode("+repr(base64.b64encode(json.dumps(payload).encode()).decode())+"));exec(base64.b64decode("+repr(base64.b64encode(code.encode()).decode())+"))"
    cmd = ["ssh", *options, "-p", port, endpoint, "python3 -"]
    proc = subprocess.run(cmd, input=bootstrap, text=True, capture_output=True, timeout=cfg.get("remoteTimeoutSeconds", 2400))
    if proc.returncode: raise RuntimeError("Remote operation failed; reconnect/resume or cleanup (remote details retained on Pod)")
    return json.loads(proc.stdout)

def stage_inputs(request):
    workspace, run, cfg, token = config(request)
    options, port, endpoint = ssh_options(request)
    for item in cfg.get("inputs", []):
        target = "/workspace/production-board/runs/"+token+"/inputs/"+item["target"]
        subprocess.run(["scp", *options, "-P", port, str(local(workspace, item["source"])), endpoint+":"+target], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)

def recover(request):
    workspace, run, cfg, token = config(request)
    result = invoke_remote(request, "poll")
    if result.get("status") != "succeeded": raise ValueError("Job has not succeeded")
    artifact = result["artifact"]
    path = workspace / ".production-board" / "artifacts" / token / "video.mp4"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and digest(path) == artifact["sha256"]: pass
    else:
        if path.exists(): raise ValueError("Existing recovered artifact has a different hash")
        tmp = path.with_suffix(".part")
        options, port, endpoint = ssh_options(request)
        remote = artifact["remotePath"]
        if not remote.startswith("/workspace/production-board/runs/"+token+"/") or not re.fullmatch(r"[A-Za-z0-9/_.-]+", remote): raise ValueError("Unsafe remote output path")
        subprocess.run(["scp", *options, "-P", port, endpoint+":"+remote, str(tmp)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
        if digest(tmp) != artifact["sha256"]: raise ValueError("Recovery SHA256 mismatch")
        tmp.replace(path)
    record = {"path": str(path.relative_to(workspace)), "sha256": artifact["sha256"]}
    return {"artifacts": [record], **record, "status": "recovered"}

def validate(request):
    workspace, run, cfg, token = config(request)
    artifacts = run.get("execution", {}).get("artifacts") or run.get("artifacts") or run.get("outputs")
    if not artifacts: raise ValueError("Missing recovered artifact record")
    item = artifacts[0]
    guard = module("h3_guard", BASE / "h3-guard.py")
    result = guard.check_video(str(local(workspace, item["path"])), item["sha256"], **cfg["expected"])
    return {**result, "status": "validated", "verified": True}

def dispatch(action, request):
    if action == "preflight": return preflight(request)
    if action == "validate": return validate(request)
    if action == "recover": return recover(request)
    if action == "prepare":
        preflight(request)
        invoke_remote(request, "initialize")
        stage_inputs(request)
    return invoke_remote(request, action)

def main():
    p = argparse.ArgumentParser(); p.add_argument("action", choices=["preflight","prepare","reconcile-job","submit","poll","recover","validate"]); p.add_argument("--request", required=True); args = p.parse_args()
    try: print(json.dumps(dispatch(args.action, json.loads(pathlib.Path(args.request).read_text()))))
    except Exception as error:
        # Do not echo SSH/API output, paths from subprocess errors, or credentials.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__+": driver operation failed"
        print(json.dumps({"status": "failed", "error": message})); sys.exit(1)
if __name__ == "__main__": main()
