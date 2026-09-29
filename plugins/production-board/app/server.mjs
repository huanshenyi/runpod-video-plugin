import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, safeFile, problem, listDirectory } from './lib/board.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const mime={'.md':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw problem(415,'Expected application/json');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512*1024)throw problem(413,'Request body too large');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw problem(400,'Invalid JSON');}}
async function sendFile(req,res,file){const stat=await fs.stat(file);let start=0,end=stat.size-1,status=200;const headers={'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}else{start=Math.max(0,stat.size-Number(match[2]));}if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}status=206;headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;}headers['Content-Length']=Math.max(0,end-start+1);res.writeHead(status,headers);if(req.method==='HEAD'||stat.size===0)return res.end();const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
export async function createServer({workspace=process.cwd(),dist=path.join(here,'dist')}={}){
 const store=await createStore(workspace);
 const server=http.createServer(async(req,res)=>{try{
  const expectedHost=`127.0.0.1:${server.address().port}`;
  if(req.headers.host!==expectedHost && req.headers.host!==`localhost:${server.address().port}`)throw problem(403,'Untrusted Host');
  const url=new URL(req.url,`http://${expectedHost}`);
  if(['PUT','POST','DELETE','PATCH'].includes(req.method)){
   const origin=req.headers.origin;
   if(origin&&origin!==`http://${req.headers.host}`)throw problem(403,'Untrusted Origin');
   if(req.headers['sec-fetch-site']==='cross-site')throw problem(403,'Cross-site request rejected');
  }
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,service:'production-board',workspace:store.workspace,version:'0.1.0'});
  if(req.method==='GET'&&url.pathname==='/api/board')return json(res,200,await store.read());
  if(req.method==='PUT'&&url.pathname==='/api/board')return json(res,200,await store.update(await body(req)));
  if(req.method==='GET'&&url.pathname==='/api/history')return json(res,200,await store.history());
  if(req.method==='GET'&&url.pathname==='/api/directory')return json(res,200,await listDirectory(store.workspace,url.searchParams.get('path')));
  if(req.method==='POST'&&url.pathname==='/api/restore')return json(res,200,await store.restore(await body(req)));
  if(['GET','HEAD'].includes(req.method)&&url.pathname==='/api/file')return await sendFile(req,res,await safeFile(store.workspace,url.searchParams.get('path')));
  if(req.method==='GET'&&url.pathname==='/api/document'){
   const relative=url.searchParams.get('path');if(!/\.md$/i.test(relative||''))throw problem(400,'Expected Markdown document');
   const markdown=await fs.readFile(await safeFile(store.workspace,relative),'utf8');return json(res,200,{path:relative,title:markdown.match(/^#\s+(.+)$/m)?.[1]||path.basename(relative),markdown});
  }
  if(url.pathname.startsWith('/api/'))throw problem(404,'Unknown API route');
  if(!['GET','HEAD'].includes(req.method))throw problem(405,'Method not allowed');
  let requested;try{requested=decodeURIComponent(url.pathname);}catch{throw problem(400,'Invalid URL');}
  if(requested.includes('\0')||requested.includes('\\')||requested.split('/').some(p=>p.startsWith('.')))throw problem(403,'Invalid asset path');
  const root=await fs.realpath(dist).catch(()=>{throw problem(503,'Frontend is not built. Run npm run build in app.');});
  let file=path.join(root,requested==='/'?'index.html':requested);
  try{file=await fs.realpath(file);}catch{throw problem(404,'Asset not found');}
  if(!file.startsWith(root+path.sep)||(await fs.stat(file)).isDirectory())throw problem(403,'Invalid asset path');
  await sendFile(req,res,file);
 }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Internal server error'});else res.destroy();}});
 return {server,store};
}
export async function startServer({workspace=process.cwd(),port=4317,host='127.0.0.1',...rest}={}){if(host!=='127.0.0.1')throw new Error('Only 127.0.0.1 is supported');const result=await createServer({workspace,...rest});await new Promise((resolve,reject)=>{result.server.once('error',reject);result.server.listen(port,host,resolve);});return {...result,url:`http://${host}:${result.server.address().port}`};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const options={};for(let i=0;i<args.length;i+=2){if(!['--workspace','--port','--host'].includes(args[i])||!args[i+1])throw new Error('Usage: node server.mjs [--workspace PATH] [--port 4317] [--host 127.0.0.1]');options[args[i].slice(2)]=args[i]==='--port'?Number(args[i+1]):args[i+1];}
 const {url,server}=await startServer(options);console.log(`Production board: ${url}`);for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
