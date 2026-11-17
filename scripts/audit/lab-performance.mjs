/** Real, bounded panel measurements; no artificial performance PASS or real writes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '../../frontend/node_modules/@playwright/test/index.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:18010', project = 'uasspain-mail-audit-closure-630870e0';
const output = resolve(root, 'docs/audits/evidence/2026-11-16-lab-performance.json');
function load(file, entropy) { try { return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file.replaceAll("'", "''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`], { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] })); } catch { throw Error('Protected synthetic fixture unavailable'); } }
const fixture = load(resolve(root, '.run/audit-20261116/lab-fixtures.dpapi'), 'UASSpain|audit-20261116|lab-fixtures|v1');
const env = load(resolve(root, '.run/closure-20261109-630870e0/api-lab.dpapi'), 'UASSpain|closure20261109|630870e0');
assert.equal(fixture.project, project); assert.equal(fixture.owner, 'audit-20261116');
const expectedImages = JSON.parse(readFileSync(resolve(root, 'docs/audits/evidence/2026-11-16-existing-lab.json'), 'utf8'));
for (const [service, label] of [['backend-e2e','backend'], ['web-e2e','frontend'], ['postgres-e2e',null]]) {
  const c = JSON.parse(execFileSync('docker', ['inspect', `${project}-${service}-1`], { encoding: 'utf8', windowsHide: true }))[0];
  assert.equal(c.Config.Labels['com.docker.compose.project'], project); assert.equal(c.Config.Labels['uasspain.fixture'], 'closure-20261109-630870e0');
  if (label) assert.equal(JSON.parse(execFileSync('docker', ['image','inspect',c.Config.Image], {encoding:'utf8',windowsHide:true}))[0].Id, expectedImages.images.find(x => x.service === label).image);
}
function client() { const jar = new Map(), id = randomUUID(); return { async call(path, method='GET', data) {
  assert.ok(path.startsWith('/api/')); const r=await fetch(origin+path,{method,headers:{Origin:origin,'X-UASSpain-Window-Id':id,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:data===undefined?undefined:JSON.stringify(data)});
  for(const line of r.headers.getSetCookie()){const p=line.split(';')[0],at=p.indexOf('=');jar.set(p.slice(0,at),p.slice(at+1));} let body;try{body=await r.json()}catch{body=null}return{status:r.status,body};
} }; }
const actors = [fixture.actors.find(x => x.role === 'instructor'), fixture.actors.find(x => x.role === 'alumno' && x.index === 0)];
const report = { started_at:new Date().toISOString(), project, origin, status:'RUNNING', scope:'Diagnostic local headless Edge measurements on three authenticated panels, updated images in existing lab; no WAN, load SLA or production p75 claim', images:expectedImages.images, measurements:[], checks:[], accounts_reblocked:[], react_profiler:'NOT_RUN: deployed production build has no profiling instrumentation; no source change solely to obtain metrics', performance_acceptance:'NOT_CERTIFIED: no agreed workload/SLA or field population', original_writes:0, deletions:0 };
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const gate=(id,ok,observed={})=>{report.checks.push({id,status:ok?'PASS':'FAIL',observed});save();assert.ok(ok,id)};
let browser,admin;const activated=[];
try{
  admin=client();await admin.call('/api/auth/context/','POST',{});gate('LAB_ADMIN_LOGIN',(await admin.call('/api/auth/login/','POST',{email:'e2e-admin@test.local',password:env.CLOSURE_ADMIN_PASSWORD})).status===200);
  for(const actor of actors){
    assert.ok(actor && actor.apellidos==='Synthetic' && actor.nombre.startsWith('Audit1611 ') && actor.email.endsWith(`-${fixture.suffix}@test.local`));
    const current=await admin.call(`/api/profiles/${actor.id}/`);gate('OWNED_BLOCKED_ACTOR:'+actor.role,current.status===200&&current.body.id===actor.id&&current.body.email===actor.email&&current.body.status==='bloqueado');
    activated.push(actor);gate('TEMPORARILY_ACTIVATE_OWN_ACTOR:'+actor.role,(await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{status:'activo'})).status===200);
  }
  browser=await chromium.launch({channel:'msedge',headless:true});
  const accounts=[{role:'admin',email:'e2e-admin@test.local',password:env.CLOSURE_ADMIN_PASSWORD},...actors];
  for(const account of accounts){
    const context=await browser.newContext({viewport:{width:1366,height:900}});
    await context.addInitScript(()=>{
      const m={cls:0,input_related_shift:0,lcp_ms:null,events:[],long_tasks:[],supported:PerformanceObserver.supportedEntryTypes};Object.defineProperty(window,'__uasPanelMetrics',{value:m});
      if(m.supported.includes('layout-shift'))new PerformanceObserver(list=>{for(const e of list.getEntries()){if(e.hadRecentInput)m.input_related_shift+=e.value;else m.cls+=e.value}}).observe({type:'layout-shift',buffered:true});
      if(m.supported.includes('largest-contentful-paint'))new PerformanceObserver(list=>{for(const e of list.getEntries())m.lcp_ms=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});
      if(m.supported.includes('event'))new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)m.events.push({name:e.name,duration:e.duration,start:e.startTime,interaction:e.interactionId})}).observe({type:'event',buffered:true,durationThreshold:16});
      if(m.supported.includes('longtask'))new PerformanceObserver(list=>{for(const e of list.getEntries())m.long_tasks.push({start:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true});
    });
    const page=await context.newPage(), errors=[],requests=[];
    page.on('pageerror',e=>errors.push(e.name));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push({method:r.method(),path:new URL(r.url()).pathname})});
    await page.goto(origin+'/',{waitUntil:'networkidle'});await page.getByRole('button',{name:/^acceso$/i}).click();await page.locator('#login-email').fill(account.email);await page.locator('#login-password').fill(account.password);await page.getByRole('button',{name:/^iniciar sesión$/i}).click();
    await page.waitForURL(u=>u.pathname==='/'+account.role||u.pathname==='/elegir-panel');
    if(new URL(page.url()).pathname==='/elegir-panel'){await page.getByRole('button',{name:account.role==='admin'?/^Administrador/:/^Instructor/}).click();await page.waitForURL(u=>u.pathname==='/'+account.role)}
    await page.reload({waitUntil:'networkidle'});await page.locator('aside:visible').first().waitFor();
    // Reload gives a genuine authenticated panel navigation instead of labelling the public hero LCP as panel LCP.
    const source=readFileSync(resolve(root,`frontend/src/pages/${{admin:'AdminPanel',instructor:'InstructorPanel',alumno:'AlumnoPanel'}[account.role]}.tsx`),'utf8');
    const menu=source.slice(source.indexOf('const NAV_GROUPS'),source.indexOf('];',source.indexOf('const NAV_GROUPS')));
    const items=[...menu.matchAll(/id: '([^']+)', label: '([^']+)'/g)].map(m=>({id:m[1],label:m[2]}));
    for(const phase of ['first_visit','warm_revisit'])for(const item of items){
      const before=await page.evaluate(()=>({at:performance.now(),metrics:JSON.parse(JSON.stringify(window.__uasPanelMetrics))})),requestStart=requests.length;
      const start=performance.now();await page.locator('aside:visible').first().getByRole('button',{name:item.label,exact:true}).click();await expect(page.locator('header h1')).toHaveText(item.label);await expect(page.locator('main:visible').first().getByText('Cargando sección…',{exact:true})).toHaveCount(0);
      const ready=performance.now()-start;await page.waitForTimeout(140);
      const after=await page.evaluate(()=>({metrics:JSON.parse(JSON.stringify(window.__uasPanelMetrics)),overflow:document.documentElement.scrollWidth>innerWidth+1}));
      const events=after.metrics.events.filter(x=>x.start>=before.at);
      report.measurements.push({role:account.role,section:item.id,phase,ui_ready_ms:Math.round(ready),cls_delta:after.metrics.cls-before.metrics.cls,input_related_shift_delta:after.metrics.input_related_shift-before.metrics.input_related_shift,observed_interaction_max_ms:events.length?Math.max(...events.map(x=>x.duration)):null,event_samples:events.length,long_tasks_ms:after.metrics.long_tasks.filter(x=>x.start>=before.at).reduce((s,x)=>s+x.duration,0),requests:requests.slice(requestStart),horizontal_overflow:after.overflow});save();
    }
    const final=await page.evaluate(()=>window.__uasPanelMetrics);
    report.checks.push({id:'PANEL_MEASUREMENT:'+account.role,status:'PASS',observed:{sections:items.length,passes:2,document_cls:final.cls,document_lcp_ms:final.lcp_ms,event_timing_supported:final.supported.includes('event'),max_interaction_duration_ms:final.events.length?Math.max(...final.events.map(x=>x.duration)):null,limits:'Lab document initial LCP and observed interactions only; not production INP percentile or every in-form action'}});
    gate('NO_JS_ERROR:'+account.role,errors.length===0,{errors});
    await context.close();console.log(JSON.stringify({role:account.role,measurements:items.length*2}));
  }
  report.status='PASS';
}catch(error){report.status='FAIL';report.reason=error instanceof assert.AssertionError?'Failed gate; see checks':`${error.name}: local performance measurement interrupted`;process.exitCode=1}
finally{
  await browser?.close();
  for(const actor of [...activated].reverse())try{
    const blocked=await admin.call(`/api/profiles/${actor.id}/`,'PATCH',{status:'bloqueado'});assert.equal(blocked.status,200);
    const verify=await admin.call(`/api/profiles/${actor.id}/`);assert.equal(verify.body.status,'bloqueado');
    const denied=client();await denied.call('/api/auth/context/','POST',{});assert.equal((await denied.call('/api/auth/login/','POST',{email:actor.email,password:actor.password})).status,401);
    report.accounts_reblocked.push({id:actor.id,status:'PASS',login_http:401,record_retained:true});
  }catch{report.status='FAIL';report.cleanup_error='Owned fixture account could not be confirmed blocked';process.exitCode=1}
  report.completed_at=new Date().toISOString();save();
}
console.log(JSON.stringify({status:report.status,measurements:report.measurements.length,reblocked:report.accounts_reblocked.length,report:'docs/audits/evidence/2026-11-16-lab-performance.json'}));
