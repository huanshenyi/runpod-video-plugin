import importlib.util,pathlib,unittest,tempfile,hashlib
import av
from PIL import Image
spec=importlib.util.spec_from_file_location('guard',pathlib.Path(__file__).resolve().parents[1]/'scripts/h3-guard.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class Gates(unittest.TestCase):
 def test_environment(self):
  system={'comfyui_version':g.PROFILE['comfy_version'],'comfy_package_versions':[{'name':k,'installed':v} for k,v in g.PROFILE['packages'].items()]}
  self.assertEqual(g.check_environment(g.PROFILE['comfy_commit'],'',system)['status'],'environment_verified')
  for commit,dirty,s in [('old','',system),(g.PROFILE['comfy_commit'],'modified',system),(g.PROFILE['comfy_commit'],'',dict(system,comfyui_version='0.30.0')),(g.PROFILE['comfy_commit'],'',dict(system,comfy_package_versions=[]))]:
   with self.assertRaises(ValueError):g.check_environment(commit,dirty,s)
 def test_media(self):
  with tempfile.TemporaryDirectory() as d:
   for color in ['black','red']:
    p=pathlib.Path(d)/(color+'.mp4')
    with av.open(str(p),'w') as c:
     s=c.add_stream('mpeg4',rate=24);s.width=64;s.height=32;s.pix_fmt='yuv420p'
     for _ in range(3):
      for packet in s.encode(av.VideoFrame.from_image(Image.new('RGB',(64,32),color))):c.mux(packet)
     for packet in s.encode():c.mux(packet)
    sha=hashlib.sha256(p.read_bytes()).hexdigest()
    if color=='black':
     with self.assertRaisesRegex(ValueError,'Black-frame'):g.check_video(p,sha,64,32,3,24)
    else:
     self.assertEqual(g.check_video(p,sha,64,32,3,24)['status'],'media_verified')
     for args in [('0'*64,64,32,3,24),(sha,128,32,3,24),(sha,64,32,4,24),(sha,64,32,3,30)]:
      with self.assertRaises(ValueError):g.check_video(p,*args)
   p=pathlib.Path(d)/'broken.mp4';p.write_bytes(b'not a video')
   with self.assertRaises(Exception):g.check_video(p,hashlib.sha256(p.read_bytes()).hexdigest(),64,32,3,24)
if __name__=='__main__':unittest.main()
