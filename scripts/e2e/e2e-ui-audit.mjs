import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { root, sleep, check } from './auth-fixtures.mjs';

// Use a production bundle and the real disposable backend. Development-only
// motion diagnostics must not be confused with production console warnings.
const frontend = resolve(root, 'frontend');
const externalOrigin=process.env.UI_AUDIT_ORIGIN;
async function run(args,env=process.env) {
  const child=spawn(process.execPath,args,{cwd:frontend,stdio:'inherit',env});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  check(code===0,'UI audit subprocess failed');
}
if(!externalOrigin) {
  await run([resolve(frontend,'node_modules/vite/bin/vite.js'),'build']);
  await run(['scripts/prerender.mjs']);
  await run(['scripts/verify-build.mjs']);
}
// Nginx serves app.html for private routes. Vite's default SPA fallback instead
// serves the prerendered Home, whose progressive hydration captures early clicks.
// Reproduce the production entry point without changing application behavior.
const previewSource = `
  import { preview } from 'vite';
  import { existsSync, readFileSync } from 'node:fs';
  import { resolve, sep } from 'node:path';
  const headers=Object.fromEntries([...readFileSync('security-headers.conf','utf8')
    .matchAll(/add_header\\s+([\\w-]+)\\s+"([^"]+)"\\s+always;/g)]
    .map(([,name,value])=>[name,value.replaceAll('$http_host','127.0.0.1:8011')]));
  headers['Cache-Control']='no-store';
  await preview({preview:{host:'127.0.0.1',port:8011,strictPort:true,headers},plugins:[{
    name:'e2e-private-entry',
    configurePreviewServer(server) {
      server.middlewares.use((req,_res,next)=>{
        const pathname=new URL(req.url || '/', 'http://localhost').pathname;
        const file=resolve('dist', '.' + pathname);
        const inside=file.startsWith(resolve('dist')+sep);
        if(inside && !/^\\/(api|ws|media|assets)(?:\\/|$)/.test(pathname) &&
          !existsSync(file) && !existsSync(resolve(file,'index.html'))) req.url='/app.html';
        next();
      });
    },
  }]});
`;
const preview=externalOrigin?null:spawn(process.execPath, ['--input-type=module','-e',previewSource], {
  cwd:frontend, stdio:'ignore', env:{...process.env,VITE_DEV_PROXY_API_ORIGIN:'http://127.0.0.1:8010',VITE_DEV_PROXY_WS_ORIGIN:'ws://127.0.0.1:8010',VITE_DEV_PROXY_MEDIA_ORIGIN:'http://127.0.0.1:8012'},
});
try {
  if(preview) {
    let ready=false;
    for(let i=0;i<100;i++) {
      check(preview.exitCode===null,'Live audit production frontend did not start');
      try { ready=(await fetch('http://127.0.0.1:8011')).ok; } catch {}
      if(ready)break;
      await sleep(200);
    }
    check(ready,'Live audit frontend readiness');
  }
  await run(['scripts/audit-ui.mjs'],{
    ...process.env,UI_AUDIT_LIVE:'true',UI_AUDIT_ORIGIN:externalOrigin||'http://127.0.0.1:8011',
    UI_AUDIT_REPORT:process.env.UI_AUDIT_REPORT||resolve(root,'.run/concurrency-audit/ui-live'),
  });
} finally { preview?.kill(); }
