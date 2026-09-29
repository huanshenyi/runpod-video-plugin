"""Offline lifecycle boundary tests; no SSH, cloud resources, or paid APIs."""
import importlib.util, json, pathlib, tempfile, unittest, sys
from unittest.mock import patch, MagicMock
ROOT = pathlib.Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/(name.replace('_','-')+'.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
DRIVER=load('h3_driver'); REMOTE=load('h3_remote')

class ReconcileTests(unittest.TestCase):
    def test_no_marker_no_job_is_absent(self):
        self.assertEqual(REMOTE.reconcile({},'run1',{},{}),{'status':'absent'})
    def test_pending_without_api_evidence_is_unknown(self):
        self.assertEqual(REMOTE.reconcile({'status':'submission_pending'},'run1',{},{}),{'status':'unknown'})
    def test_recover_accepted_prompt_after_lost_response(self):
        prompt=[0,'job1',{}, {'production_board_job_token':'run1'}]
        self.assertEqual(REMOTE.reconcile({'status':'submission_pending'},'run1',{'job1':{'prompt':prompt}},{}),{'status':'found','jobId':'job1'})
    def test_queued_job_is_reused(self):
        queue={'queue_running':[[0,'job1',{}, {'production_board_job_token':'run1'}]]}
        self.assertEqual(REMOTE.reconcile({},'run1',{},queue)['jobId'],'job1')
    def test_conflicting_token_matches_are_unknown(self):
        q={'queue_pending':[[0,x,{}, {'production_board_job_token':'run1'}] for x in ('a','b')]}
        self.assertEqual(REMOTE.reconcile({},'run1',{},q)['status'],'unknown')
    def test_unrelated_prompt_is_not_adopted(self):
        q={'queue_pending':[[0,'a',{}, {'production_board_job_token':'other'}]]}
        self.assertEqual(REMOTE.reconcile({},'run1',{},q)['status'],'absent')
    def test_known_job_survives_history_eviction(self):
        self.assertEqual(REMOTE.reconcile({'jobId':'a'},'run1',{},{}),{'status':'found','jobId':'a'})

class SubmissionTests(unittest.TestCase):
    def test_lost_response_leaves_durable_pending_and_prevents_second_post(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=pathlib.Path(tmp)/'job.json'; posts=[]
            def call(route, data=None):
                if route != 'prompt': return {}
                self.assertEqual(json.loads(marker.read_text())['status'],'submission_pending')
                posts.append(data)
                raise TimeoutError('response lost')
            with self.assertRaises(TimeoutError): REMOTE.submit_job(marker,'run1',{}, {},call)
            with self.assertRaises(ValueError): REMOTE.submit_job(marker,'run1',{},json.loads(marker.read_text()),call)
            self.assertEqual(len(posts),1)
    def test_second_submit_reuses_recorded_job(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=pathlib.Path(tmp)/'job.json'; posts=[]
            def call(route,data=None):
                if route != 'prompt': return {}
                posts.append(data); return {'prompt_id':'accepted'}
            self.assertEqual(REMOTE.submit_job(marker,'run1',{}, {},call),{'jobId':'accepted'})
            self.assertEqual(REMOTE.submit_job(marker,'run1',{},json.loads(marker.read_text()),call),{'jobId':'accepted'})
            self.assertEqual(len(posts),1)

class PreflightTests(unittest.TestCase):
    def test_pins_graph_material_prompt_and_seed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp); (root/'input.png').write_bytes(b'mocked-image'); (root/'key').write_text('fixture')
            graph={'1':{'class_type':'MiniMaxH3ImageToVideo','inputs':{'prompt':'approved','width':1344,'height':768,'length':141}},'2':{'class_type':'SaveVideo','inputs':{}},'3':{'class_type':'CreateVideo','inputs':{'fps':24}},'4':{'class_type':'LoadImage','inputs':{'image':'start.png'}},'5':{'class_type':'RandomNoise','inputs':{'noise_seed':42}}}
            (root/'graph.json').write_text(json.dumps(graph))
            cfg={'graph':'graph.json','graphSha256':DRIVER.digest(root/'graph.json'),'inputs':[{'source':'input.png','target':'start.png','sha256':DRIVER.digest(root/'input.png')}],'expected':{'width':1344,'height':768,'frames':141,'fps':24},'ssh':{'keyFile':str(root/'key')}}
            plan={'executionConfig':cfg,'prompt':'approved','seed':42}
            req={'workspace':tmp,'run':{'runId':'fixture','plan':plan}}
            with patch.dict(sys.modules,{'av':MagicMock(),'PIL':MagicMock()}), patch.object(DRIVER.shutil,'which',return_value='/bin/mock'):
                self.assertTrue(DRIVER.preflight(req)['ready'])
                plan['seed']=43
                with self.assertRaisesRegex(ValueError,'seed'): DRIVER.preflight(req)
                plan['seed']=42; plan['prompt']='changed'
                with self.assertRaisesRegex(ValueError,'prompt'): DRIVER.preflight(req)
                plan['prompt']='approved'; cfg['inputs'][0].pop('sha256')
                with self.assertRaisesRegex(ValueError,'SHA256'): DRIVER.preflight(req)

class LocalTests(unittest.TestCase):
    def test_reject_workspace_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): DRIVER.local(pathlib.Path(tmp),'../escape')
    def test_reject_runid_shell_path_characters(self):
        with self.assertRaises(ValueError): DRIVER.config({'workspace':'/tmp','run':{'runId':'../../bad','plan':{'executionConfig':{}}}})
    def test_atomic_marker_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/'job.json'; REMOTE.save(p,{'status':'submission_pending'})
            self.assertEqual(json.loads(p.read_text())['status'],'submission_pending')
            self.assertFalse(p.with_suffix('.tmp').exists())
    def test_configured_ssh_uses_safe_argv_and_known_hosts(self):
        with tempfile.TemporaryDirectory() as tmp:
            req={'workspace':tmp,'run':{'runId':'run1','plan':{'executionConfig':{'ssh':{'host':'example.test','port':2222,'keyFile':'/tmp/key'}}}}}
            options,port,endpoint=DRIVER.ssh_options(req)
            self.assertEqual((port,endpoint),('2222','root@example.test'))
            self.assertIn('StrictHostKeyChecking=accept-new',options)
    def test_cli_ssh_command_is_parsed_not_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            req={'workspace':tmp,'run':{'runId':'run1','execution':{'podId':'pod1'},'plan':{'executionConfig':{}}}}
            with patch.object(DRIVER.subprocess,'check_output',return_value=b'{"command":"ssh root@example.test -p 2222"}'):
                self.assertEqual(DRIVER.ssh_options(req)[1:],('2222','root@example.test'))
    def test_nested_direct_ssh_and_request_cli_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            req={'workspace':tmp,'runpodctl':'/custom/runpodctl','run':{'runId':'run1','execution':{'podId':'pod1'},'plan':{'executionConfig':{}}}}
            fixture=b'{"ssh":{"direct":{"ip":"example.test","port":2222,"username":"worker"}}}'
            with patch.object(DRIVER.subprocess,'check_output',return_value=fixture) as call:
                self.assertEqual(DRIVER.ssh_options(req)[1:],('2222','worker@example.test'))
                self.assertEqual(call.call_args[0][0][0],'/custom/runpodctl')
    def test_reject_ssh_option_injection(self):
        req={'workspace':'/tmp','run':{'runId':'run1','plan':{'executionConfig':{'ssh':{'host':'-oProxyCommand=bad'}}}}}
        with self.assertRaises(ValueError): DRIVER.ssh_options(req)

if __name__=='__main__': unittest.main()
