import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {parse} from 'smol-toml';

export async function loadRunpodKey({env=process.env,configPath=path.join(homedir(),'.runpod','config.toml')}={}) {
 if(typeof env.RUNPOD_API_KEY==='string'&&env.RUNPOD_API_KEY.trim())return env.RUNPOD_API_KEY.trim();
 let source;
 try{source=await readFile(configPath,'utf8');}
 catch{throw new Error('No Runpod API key. Run runpodctl doctor.');}
 let config;
 try{config=parse(source);}catch{throw new Error('Runpod CLI configuration is invalid. Run runpodctl doctor.');}
 if(typeof config.apikey!=='string'||!config.apikey.trim())throw new Error('No Runpod API key. Run runpodctl doctor.');
 return config.apikey.trim();
}
