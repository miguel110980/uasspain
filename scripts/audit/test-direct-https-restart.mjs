/** One explicitly authorized Nginx restart; never touches other containers or Windows services. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const dir='.run/audit-20261117/direct-https/apply',out='docs/audits/evidence/2026-11-17-direct-https-restart.json';
const inspect=()=>['nginx','frontend','backend','postgres','redis'].map(service=>{const c=JSON.parse(execFileSync('docker',['inspect','uasspain-'+service],{encoding:'utf8',windowsHide:true}))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],'uasspain');return {service,id:c.Id,image:c.Image,started_at:c.State.StartedAt,health:c.State.Health?.Status,bindings:c.HostConfig.PortBindings};});
if(!process.argv.includes('--restart'))throw Error('Explicit authorized --restart required');
assert.ok(!existsSync(dir+'/restart.before.json'),'One restart only; inspect existing evidence before any repeat');
const prior=JSON.parse(readFileSync('docs/audits/evidence/2026-11-17-direct-https-live-before-restart.json','utf8'));
assert.equal(prior.status,'PASS_SCOPED_LOCAL_ONLY','Deployment must pass all direct-binding checks first');
const before=inspect();assert.ok(before.every(x=>x.health==='healthy'));writeFileSync(dir+'/restart.before.json',JSON.stringify(before,null,2));
const report={observed_at:new Date().toISOString(),status:'RESTARTING',scope:'Only the authorized uasspain-nginx container; not a Windows reboot',before,other_container_restarts:0,windows_service_restarts:0,windows_reboot:'NOT_RUN',checks:[]};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2)+'\n');save();
try{
 execFileSync('docker',['restart','--time','10','uasspain-nginx'],{encoding:'utf8',windowsHide:true,timeout:30000});
 const deadline=Date.now()+90000;let after;
 do{after=inspect();if(after.every(x=>x.health==='healthy'))break;await new Promise(resolve=>setTimeout(resolve,1000));}while(Date.now()<deadline);
 const check=(id,ok)=>report.checks.push({id,status:ok?'PASS':'FAIL'});
 check('FIVE_HEALTHY',after.every(x=>x.health==='healthy'));
 check('OTHER_FOUR_UNCHANGED',JSON.stringify(after.filter(x=>x.service!=='nginx'))===JSON.stringify(before.filter(x=>x.service!=='nginx')));
 const a=after.find(x=>x.service==='nginx'),b=before.find(x=>x.service==='nginx');
 check('SAME_NGINX_CONTAINER_IMAGE_AND_BINDINGS',a.id===b.id&&a.image===b.image&&JSON.stringify(a.bindings)===JSON.stringify(b.bindings));
 check('NGINX_ACTUALLY_RESTARTED',a.started_at!==b.started_at);report.after=after;
 report.status=report.checks.every(x=>x.status==='PASS')?'PASS_CONTAINER_RESTART; HTTP_AND_BROWSER_RETEST_REQUIRED':'FAIL';
}catch(error){report.status='BLOCKED';report.error=error.message;}finally{report.completed_at=new Date().toISOString();save();}
console.log(JSON.stringify({status:report.status,checks:report.checks,error:report.error}));if(!report.status.startsWith('PASS'))process.exitCode=1;
