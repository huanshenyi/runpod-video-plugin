#!/usr/bin/env node
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function generateBundle(output, domain) {
 if (typeof domain !== 'string' || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw Error('Use a DNS hostname without scheme, port or path');
 const root=path.resolve(output);
 // Exclusive directory creation: never replace deployment settings or existing code.
 await mkdir(root, {mode:0o700});
 for (const dir of ['scripts','app/lib/runpod']) await mkdir(path.join(root,dir),{recursive:true});
 for (const file of ['scripts/deadline-controller.mjs','app/lib/runpod/deadline-controller.mjs','app/lib/runpod/provider.mjs']) {
  await copyFile(new URL('../'+file,import.meta.url),path.join(root,file));
 }
 const files={
 'runpod-deadline.service': `[Unit]
Description=Production Board Runpod deadline controller
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=runpod-deadline
Group=runpod-deadline
WorkingDirectory=/opt/runpod-deadline
EnvironmentFile=/etc/runpod-deadline.env
Environment=RUNPOD_DEADLINE_STATE_DIR=/var/lib/runpod-deadline
Environment=RUNPODCTL_PATH=/usr/local/bin/runpodctl
Environment=PORT=4319
StateDirectory=runpod-deadline
StateDirectoryMode=0700
ExecStartPre=/usr/bin/node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
ExecStartPre=/usr/bin/test -x /usr/local/bin/runpodctl
ExecStartPre=/usr/bin/node -e "if (!process.env.RUNPOD_API_KEY || (process.env.RUNPOD_DEADLINE_TOKEN || '').length < 32) process.exit(1)"
ExecStart=/usr/bin/node /opt/runpod-deadline/scripts/deadline-controller.mjs
Restart=always
RestartSec=5
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`,
 'Caddyfile': `${domain} {
    reverse_proxy 127.0.0.1:4319
}
`,
 'install.sh': `#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on the separate Linux host'; exit 1; }
[ -x /usr/bin/node ] && [ -x /usr/local/bin/runpodctl ] || { echo 'Install Node 22+ at /usr/bin/node and runpodctl at /usr/local/bin/runpodctl first'; exit 1; }
/usr/bin/node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
command -v systemctl >/dev/null
# Initial installation only. Upgrades must preserve state and use a reviewed procedure.
[ ! -e /opt/runpod-deadline ] || { echo 'Existing installation; refusing overwrite'; exit 1; }
[ ! -e /etc/systemd/system/runpod-deadline.service ] || exit 1
id runpod-deadline >/dev/null 2>&1 || useradd --system --home-dir /var/lib/runpod-deadline --shell /usr/sbin/nologin runpod-deadline
install -d -m 0755 /opt/runpod-deadline
cp -R scripts app /opt/runpod-deadline/
chown -R root:root /opt/runpod-deadline
chmod -R go-w /opt/runpod-deadline
install -m 0644 runpod-deadline.service /etc/systemd/system/runpod-deadline.service
if [ ! -e /etc/runpod-deadline.env ]; then
 umask 077
 printf 'RUNPOD_API_KEY=\nRUNPOD_DEADLINE_TOKEN=\n' > /etc/runpod-deadline.env
fi
chmod 0600 /etc/runpod-deadline.env
chown root:root /etc/runpod-deadline.env
systemctl daemon-reload
echo 'Installed, NOT started. Fill /etc/runpod-deadline.env, configure Caddy HTTPS, then enable the service. Preserve /var/lib/runpod-deadline.'
`
 };
 for (const [name,content] of Object.entries(files)) await writeFile(path.join(root,name),content,{mode:name.endsWith('.sh')?0o700:0o600,flag:'wx'});
 return {ok:true,output:root,started:false};
}

export async function diagnose(endpoint, token, fetchImpl=fetch) {
 let url;
 try {
  url=new URL(endpoint);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw Error();
  if(typeof token!=='string'||token.length<32||/[\r\n]/.test(token)) throw Error();
 } catch {return {ok:false,code:'invalid_configuration'};}
 try {
  const response=await fetchImpl(new URL('/health',url).href,{method:'GET',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok) return {ok:false,code:response.status===401?'unauthorized':'http_error'};
  const data=await response.json();
  if(data.ready!==true || data.service!=='runpod-deadline-controller' || !Number.isFinite(Date.parse(data.now)) || Math.abs(Date.now()-Date.parse(data.now))>60000) return {ok:false,code:'invalid_health_or_clock'};
  return {ok:true,service:data.service,checks:['https','authentication','service','clock'],scope:'Controller connection only; Runpod permissions and deadline deletion require separate verification.'};
 } catch {return {ok:false,code:'connection_failed'};}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const [command,...args]=process.argv.slice(2);
  let result;
  if(command==='bundle' && args.length===2) result=await generateBundle(args[0],args[1]);
  else if(command==='diagnose' && !args.length) result=await diagnose(process.env.RUNPOD_DEADLINE_URL,process.env.RUNPOD_DEADLINE_TOKEN);
  else throw Error('Usage: deadline-setup.mjs bundle OUTPUT DOMAIN | diagnose (uses environment, never token arguments)');
  console.log(JSON.stringify(result,null,2));
  if(!result.ok) process.exitCode=1;
 } catch(error) {console.error(error.message);process.exitCode=1;}
}
