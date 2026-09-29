import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export const SOURCE = 'videos/scene-01/README.md';
const imageExt = /\.(png|jpe?g|webp|gif|avif)$/i;
const videoExt = /\.(mp4|webm|mov)$/i;
export function kind(file) { return imageExt.test(file) ? 'image' : videoExt.test(file) ? 'video' : 'document'; }
export function problem(status, message) { return Object.assign(new Error(message), { status }); }
export async function listDirectory(workspace, relative) {
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||relative.includes('\0'))throw problem(400,'Invalid directory path');
  const normalized=path.posix.normalize(relative);
  if(!normalized.startsWith('videos/')||normalized.split('/').some(p=>p.startsWith('.')))throw problem(403,'Only project folders under videos are available');
  let actual;try{actual=await fs.realpath(path.join(workspace,normalized));}catch{throw problem(404,'Folder not found');}
  const root=await fs.realpath(path.join(workspace,'videos'));
  if(!actual.startsWith(root+path.sep)||!(await fs.stat(actual)).isDirectory())throw problem(403,'Invalid project folder');
  const entries=[];
  for(const entry of (await fs.readdir(actual,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
    const relativePath=path.posix.join(normalized,entry.name);
    if(entry.isDirectory())entries.push({name:entry.name,path:relativePath+'/',type:'directory'});
    else if(entry.isFile()&&(imageExt.test(entry.name)||videoExt.test(entry.name)||/\.md$/i.test(entry.name))){
      await safeFile(workspace,relativePath);entries.push({name:entry.name,path:relativePath,type:kind(entry.name)});
    }
  }
  return {path:normalized,entries};
}
export async function safeFile(workspace, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) throw problem(400, 'Invalid file path');
  const normalized = path.posix.normalize(relative);
  if (!normalized.startsWith('videos/') || normalized.split('/').some(p => p.startsWith('.'))) throw problem(403, 'Only project media and Markdown under videos are available');
  if (!imageExt.test(normalized) && !videoExt.test(normalized) && !/\.md$/i.test(normalized)) throw problem(403, 'Unsupported file type');
  let actual;
  try { actual = await fs.realpath(path.join(workspace, normalized)); } catch { throw problem(404, 'File not found'); }
  const root = await fs.realpath(path.join(workspace, 'videos'));
  if (!actual.startsWith(root + path.sep) || !(await fs.stat(actual)).isFile()) throw problem(403, 'File outside project');
  return actual;
}
async function assetsIn(workspace, relative) {
  let entries;
  try { entries = await fs.readdir(path.join(workspace, relative), { withFileTypes: true }); } catch { return []; }
  const result = [];
  for (const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    if (!e.isFile() || kind(e.name) === 'document') continue;
    const file = path.posix.join(relative, e.name);
    try { await safeFile(workspace, file); result.push({ path: file, name: e.name, type: kind(e.name) }); } catch {}
  }
  return result;
}
export async function createStore(workspace) {
  workspace = await fs.realpath(workspace);
  const directory = path.join(workspace, 'board');
  const statePath = path.join(directory, 'project.json');
  const historyPath = path.join(directory, 'history');
  await fs.mkdir(historyPath, { recursive: true });
  let saved, config = {};
  try { saved = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!saved) {
    try { config = JSON.parse(await fs.readFile(path.join(directory, 'config.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const sourcePath = saved?.project?.sourcePath ?? config.sourcePath ?? SOURCE;
  if (typeof sourcePath !== 'string' || !/\.md$/i.test(sourcePath)) throw problem(400, 'sourcePath must be a Markdown path under videos/');
  const sourceMarkdown = await fs.readFile(await safeFile(workspace, sourcePath), 'utf8');
  const relativeLink = link => path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), link));
  const items = [...sourceMarkdown.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+)\|[^|]*\|\s*\[(?:画像|Images?)\]\(([^)]+)\)\s*\|\s*\[(?:動画|Videos?)\]\(([^)]+)\)/gm)].map(m => ({ id:m[1],title:m[2].trim(),durationSeconds:null,status:'draft',notes:'',imageDir:relativeLink(m[3]),videoDir:relativeLink(m[4]),selectedStart:null,selectedEnd:null,selectedVideo:null }));
  if (!saved && !items.length) throw new Error('No content units found in scene README. Use table columns ID, Title, Duration, Images, Videos with folder links.');
  const referencesFrom = markdown => [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].filter(m=>!m[2].endsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(m[2])).map(m=>({label:m[1],path:relativeLink(m[2]),type:kind(m[2])}));
  const sceneId = path.posix.basename(path.posix.dirname(sourcePath));
  const sceneTitle = sourceMarkdown.match(/^#\s+(.+)$/m)?.[1] || sceneId;
  const initial = {revision:1,project:{id:config.project?.id || path.posix.normalize(sourcePath).split('/')[1],title:config.project?.title || path.basename(workspace),workspace,sourcePath,sourceMarkdown,sceneId,sceneTitle},items,updatedAt:new Date().toISOString()};
  try { await fs.writeFile(statePath, JSON.stringify(initial,null,2)+'\n', {flag:'wx'}); } catch(e) { if(e.code!=='EEXIST') throw e; }
  let queue = Promise.resolve();
  const exclusive = work => { const task=queue.then(work); queue=task.catch(()=>{}); return task; };
  const raw = async()=>JSON.parse(await fs.readFile(statePath,'utf8'));
  async function read() {
    const state=await raw();
    state.project={...state.project,workspace,sourceMarkdown:await fs.readFile(await safeFile(workspace,sourcePath),'utf8')};
    state.items=await Promise.all(state.items.map(async item=>({...item,assets:[...await assetsIn(workspace,item.imageDir),...await assetsIn(workspace,item.videoDir)]})));
    state.references=await Promise.all(referencesFrom(state.project.sourceMarkdown).map(async ref=>{let exists=true;try{await safeFile(workspace,ref.path);}catch{exists=false;}return {...ref,exists};}));
    return state;
  }
  function validate(input, current) {
    if (!Number.isInteger(input?.revision)) throw problem(400,'revision is required');
    if (input.revision!==current.revision) throw problem(409,'Board changed elsewhere. Reload before saving.');
    if(!Array.isArray(input.items)||input.items.length!==current.items.length) throw problem(400,'All existing content units must be supplied');
    const seen=new Set();
    return input.items.map(item=>{
      const original=current.items.find(i=>i.id===item.id);
      if(!original || seen.has(item.id)) throw problem(400,'Unknown or duplicate content unit');
      seen.add(item.id);
      if(typeof item.title!=='string'||!item.title.trim()||item.title.length>500||typeof item.notes!=='string'||item.notes.length>20000||!['draft','review','approved'].includes(item.status)||!(item.durationSeconds===null || (Number.isFinite(item.durationSeconds)&&item.durationSeconds>0&&item.durationSeconds<=3600))) throw problem(400,'Invalid content unit fields');
      for(const field of ['selectedStart','selectedEnd','selectedVideo']) {
        if(item[field]!==null&&!original.assets.some(a=>a.path===item[field]&&a.type===(field==='selectedVideo'?'video':'image'))) throw problem(400,'Selected material must belong to this content unit');
      }
      const {assets,...saved}=original;
      return {...saved,...Object.fromEntries(['title','durationSeconds','status','notes','selectedStart','selectedEnd','selectedVideo'].map(k=>[k,item[k]]))};
    });
  }
  async function commit(current, next) {
    const id=`${Date.now()}-${randomUUID()}`;
    await fs.writeFile(path.join(historyPath,id+'.json'),JSON.stringify(current,null,2)+'\n',{flag:'wx'});
    next.revision=current.revision+1;next.updatedAt=new Date().toISOString();
    const temporary=statePath+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temporary,JSON.stringify(next,null,2)+'\n');await fs.rename(temporary,statePath);
    return read();
  }
  return {workspace,read,
    update: input=>exclusive(async()=>{const current=await read();const items=validate(input,current);const persisted=await raw();return commit(persisted,{...persisted,items});}),
    history:async()=>({entries:(await Promise.all((await fs.readdir(historyPath)).filter(n=>/^\d+-[a-f0-9-]+\.json$/.test(n)).map(async name=>({id:name.slice(0,-5),createdAt:(await fs.stat(path.join(historyPath,name))).mtime.toISOString()})))).sort((a,b)=>b.id.localeCompare(a.id))}),
    restore:input=>exclusive(async()=>{const current=await raw();if(input?.revision!==current.revision)throw problem(409,'Board changed elsewhere. Reload before restoring.');if(typeof input.id!=='string'||!/^\d+-[a-f0-9-]+$/.test(input.id))throw problem(400,'Invalid history ID');let previous;try{previous=JSON.parse(await fs.readFile(path.join(historyPath,input.id+'.json'),'utf8'));}catch{throw problem(404,'History entry not found');}return commit(current,previous);})
  };
}
