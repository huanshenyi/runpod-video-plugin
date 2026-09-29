#!/usr/bin/env python3
"""Trusted helper transmitted over SSH by h3-driver.py. No Runpod credentials."""
import concurrent.futures, fcntl, hashlib, json, os, pathlib, shutil, signal, subprocess, sys, time, urllib.request
MODELS = {
    'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors': 20970379616,
    'text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors': 15687142551,
    'vae/minimax_h3_video_vae_int8_convrot.safetensors': 2811065184,
    'vae/minimax_h3_audio_vae_fp32.safetensors': 605254808,
    'loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors': 1956193000,
}

def save(path, data):
    temp = path.with_suffix('.tmp')
    with temp.open('w') as f:
        json.dump(data, f); f.flush(); os.fsync(f.fileno())
    temp.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda: f.read(1024*1024), b''): h.update(data)
    return h.hexdigest()

def api(route, data=None):
    req = urllib.request.Request('http://127.0.0.1:8188/'+route, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=45) as response: return json.load(response)

def find_token(token, history, queue):
    ids = set()
    for prompt_id, entry in history.items():
        prompt = entry.get('prompt', [])
        if len(prompt) > 3 and isinstance(prompt[3], dict) and prompt[3].get('production_board_job_token') == token: ids.add(prompt_id)
    for key in ('queue_running', 'queue_pending'):
        for prompt in queue.get(key, []):
            if len(prompt) > 3 and isinstance(prompt[3], dict) and prompt[3].get('production_board_job_token') == token: ids.add(prompt[1])
    return ids

def reconcile(state, token, history, queue):
    if state.get('jobId'): return {'status':'found', 'jobId':state['jobId']}
    ids = find_token(token, history, queue)
    if len(ids) == 1: return {'status':'found', 'jobId':next(iter(ids))}
    if ids or state.get('status') == 'submission_pending': return {'status':'unknown'}
    return {'status':'absent'}

def submit_job(state_path, token, graph, state, call=api):
    result = reconcile(state, token, call('history'), call('queue'))
    if result['status'] == 'found':
        state.update(status='submitted',jobId=result['jobId']); save(state_path,state)
        return {'jobId':result['jobId']}
    if result['status'] != 'absent': raise ValueError('Submission outcome unknown; automatic resubmission prohibited')
    save(state_path,{'status':'submission_pending','token':token,'submittedAt':time.time()})
    response = call('prompt',{'prompt':graph,'extra_data':{'production_board_job_token':token}})
    if not response.get('prompt_id'): raise ValueError('No prompt_id returned; reconcile required')
    save(state_path,{'status':'submitted','jobId':response['prompt_id']})
    return {'jobId':response['prompt_id']}

def prepare(req, base, work, guard):
    log = (work/'prepare.log').open('ab')
    def command(args): return subprocess.run(args, cwd=base, check=True, stdout=log, stderr=log, timeout=1200)
    def git(*args): return subprocess.check_output(['git','-C',str(base),*args], stderr=log, text=True).strip()
    def verify(): return guard['check_environment'](git('rev-parse','HEAD'),git('status','--porcelain','--untracked-files=no'),api('system_stats')['system'])
    try: environment = verify()
    except Exception:
        if not req.get('bootstrap') or not req.get('ownedPod'): raise ValueError('Pinned environment required; explicitly enable bootstrap on owned Pod')
        if git('status','--porcelain','--untracked-files=no'): raise ValueError('Refuse to overwrite dirty Comfy checkout')
        commit = guard['PROFILE']['comfy_commit']
        # Reproducible commit, never an unconstrained pull of main.
        command(['git','fetch','origin',commit]); command(['git','checkout','--detach',commit])
        venv_python = base/'.venv-cu128/bin/python'
        python = req.get('remotePython') or (str(venv_python) if venv_python.is_file() else sys.executable)
        command([python,'-m','pip','install','-r',str(base/'requirements.txt'),'comfy-kitchen==0.2.35','comfy-aimdo==0.5.5'])
        processes = []
        for proc in pathlib.Path('/proc').iterdir():
            if not proc.name.isdigit(): continue
            try:
                args = (proc/'cmdline').read_bytes().split(b'\0')
                if (proc/'cwd').resolve() == base.resolve() and b'main.py' in args:
                    os.kill(int(proc.name), signal.SIGTERM); processes.append(int(proc.name))
            except (OSError, PermissionError): pass
        for _ in range(30):
            if all(not pathlib.Path('/proc',str(pid)).exists() for pid in processes): break
            time.sleep(1)
        else: raise ValueError('Previous Comfy process did not stop')
        subprocess.Popen([python,'main.py','--listen','127.0.0.1','--port','8188'],cwd=base,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        for _ in range(120):
            try: environment = verify(); break
            except Exception: time.sleep(2)
        else: raise ValueError('Pinned Comfy server failed verification')
    save(work/'environment.json',environment)
    revision = guard['PROFILE']['model_revision']
    def download(item):
        name, size = item; target = base/'models'/name; target.parent.mkdir(parents=True,exist_ok=True)
        if target.is_file() and target.stat().st_size == size: return
        partial = target.with_suffix('.production-board-download')
        subprocess.run(['curl','-fLsS','--retry','2','--max-time','1200','-o',str(partial),'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/'+revision+'/'+name],check=True,stdout=log,stderr=log,timeout=1230)
        if partial.stat().st_size != size: raise ValueError('Downloaded model size mismatch')
        partial.replace(target)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: list(pool.map(download,MODELS.items()))
    graph = req['graph']; input_dir = base/'input'/'production-board'/req['token']; input_dir.mkdir(parents=True,exist_ok=True)
    for item in req['inputs']:
        source = work/'inputs'/item['target']
        if sha(source) != item['sha256']: raise ValueError('Staged material SHA256 mismatch')
        shutil.copy2(source,input_dir/item['target'])
    for node in graph.values():
        if node.get('class_type') == 'LoadImage': node['inputs']['image'] = 'production-board/'+req['token']+'/'+node['inputs']['image']
        if node.get('class_type') == 'SaveVideo': node['inputs']['filename_prefix'] = 'production-board/'+req['token']+'/video'
    save(work/'graph.json',graph)
    return {'ready':True, 'status':'prepared'}

def dispatch(req):
    token = req['token']; base = pathlib.Path(req['comfyRoot']); work = pathlib.Path('/workspace/production-board/runs')/token
    work.mkdir(parents=True,exist_ok=True); (work/'inputs').mkdir(exist_ok=True)
    guard = {'__name__':'h3_guard_remote'}; exec(req['guardSource'],guard)
    action = req['action']; state_path = work/'job.json'
    if action == 'initialize': return {'ready':True}
    with (work/'job.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        if action == 'prepare':
            if state: raise ValueError('Existing submitted job cannot be prepared again')
            return prepare(req,base,work,guard)
        if action == 'reconcile-job':
            result = reconcile(state,token,api('history'),api('queue'))
            if result['status'] == 'found':
                state.update(status='submitted',jobId=result['jobId']); save(state_path,state)
            return result
        if action == 'submit':
            if not (work/'environment.json').exists(): raise ValueError('Environment has not been prepared')
            def git(*args): return subprocess.check_output(['git','-C',str(base),*args], stderr=subprocess.DEVNULL, text=True).strip()
            guard['check_environment'](git('rev-parse','HEAD'),git('status','--porcelain','--untracked-files=no'),api('system_stats')['system'])
            graph = json.loads((work/'graph.json').read_text())
            return submit_job(state_path,token,graph,state)
        if action == 'poll':
            if not state.get('jobId'): raise ValueError('No recorded generation job')
            job = state['jobId']; history = api('history/'+job)
            if job not in history: return {'status':'running'}
            entry = history[job]; save(work/'history.json',entry)
            status = entry.get('status',{})
            if status.get('status_str') == 'error': return {'status':'failed'}
            if status.get('completed') is not True: return {'status':'running'}
            candidates = list((base/'output'/'production-board'/token).glob('video*.mp4'))
            if len(candidates) != 1: raise ValueError('Expected exactly one generated MP4')
            output = work/'video.mp4'
            if not output.exists(): shutil.copy2(candidates[0],output)
            return {'status':'succeeded','artifact':{'remotePath':str(output),'sha256':sha(output)}}
        raise ValueError('Unknown remote action')

if 'REQUEST' in globals():
    try: print(json.dumps(dispatch(REQUEST)))
    except Exception:
        # Full error can be investigated via prepare.log; no source paths/API bodies echoed.
        print(json.dumps({'status':'failed','error':'Remote H3 operation failed'})); raise SystemExit(1)
