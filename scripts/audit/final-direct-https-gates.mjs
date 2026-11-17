/** Final scoped gates; no staging, commit, push, host/network or runtime mutations. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const checks=[];
function run(file,args,input){return spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024,input});}
function gate(id,result,extra={}){checks.push({id,status:result.status===0&&!result.error?'PASS':'BLOCKED',exit:result.status,...extra});}
for(const file of ['apply-direct-public-https.mjs','prepare-direct-public-https.mjs','network-recurrence-readonly.mjs','network-assets-live.mjs','test-direct-https-restart.mjs','verify-direct-https-closure.mjs','final-direct-https-gates.mjs'])gate('SYNTAX:'+file,run(process.execPath,['--check','scripts/audit/'+file]));
const ps=run('powershell.exe',['-NoProfile','-File','scripts/audit/direct-https-portproxy.ps1','-SelfTest']);gate('READ_ONLY_RULE_PARSER_REGRESSION',ps,{network_changes:0});
const leaks=resolve('.run/audit-tools/gitleaks-v8.30.1/gitleaks.exe');
for(const path of ['scripts/audit','docs/audits'])gate('SECRETS:'+path,run(leaks,['dir',path,'--config','.gitleaks.toml','--redact','--no-banner','--no-color']),{scope:'Current files only; raw scanner output withheld'});
const diff=run('git',['diff','--no-ext-diff']);gate('TRACKED_WORKTREE_DIFF_READ',diff);
if(diff.status===0)gate('SECRETS:TRACKED_WORKTREE_DIFF',run(leaks,['stdin','--config','.gitleaks.toml','--redact','--no-banner','--no-color'],diff.stdout),{scope:'All current tracked worktree changes; .env stays ignored; not Git history'});
gate('WORKTREE_DIFF_CHECK',run('git',['diff','--check']));gate('CACHED_DIFF_CHECK',run('git',['diff','--cached','--check']));
const staged=run('git',['diff','--cached','--name-only']);gate('NO_STAGING_OR_PUBLICATION',{...staged,status:staged.status===0&&!staged.stdout.trim()?0:1},{staged_files:staged.stdout.trim()?staged.stdout.trim().split('\n'):[],new_commit:false,new_push:false});
const closure=JSON.parse(readFileSync('docs/audits/evidence/2026-11-17-direct-https-closure.json','utf8'));
checks.push({id:'DEPLOYMENT_FUNCTION_AND_NGINX_RESTART',status:closure.status==='PASS_DEPLOYED_AND_NGINX_RESTART_VALIDATED'?'PASS':'BLOCKED',source:'2026-11-17-direct-https-closure.json'});
const head=run('git',['rev-parse','HEAD']),remote=run('git',['ls-remote','origin','refs/heads/main','refs/heads/codex/auditoria-20261110']);gate('GIT_REFERENCE_READ',remote);
const report={observed_at:new Date().toISOString(),status:checks.every(x=>x.status==='PASS')?'PASS_SCOPED_PREPUBLICATION_GATES':'BLOCKED',scope:'Only direct HTTPS transition; no platform-wide release certification',checks,local_head:head.stdout.trim(),remote_refs:remote.stdout.trim().split('\n').filter(Boolean).map(x=>{const [sha,ref]=x.trim().split(/\s+/);return {sha,ref}}),release_gate:'BLOCKED_PENDING_MASTER_ACCEPTANCE',external_retest:'PENDING_OWNER_RESULT',windows_boot_test:'NOT_RUN',commit:'NOT_RUN',push:'NOT_RUN'};
writeFileSync('docs/audits/evidence/2026-11-17-direct-https-gates.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.length,blocked:checks.filter(x=>x.status!=='PASS').map(x=>x.id)}));if(report.status==='BLOCKED')process.exitCode=1;
