/** Approved direct HTTPS transition with narrow host change and configuration rollback. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dir=resolve('.run/audit-20261117/direct-https/apply');
const reportPath='docs/audits/evidence/2026-11-17-direct-https-apply.json';
const resumeAfterUac=process.argv.includes('--resume-after-uac-cancel');
const resumeParser=process.argv.includes('--resume-after-rule-parser-fix'),resuming=resumeAfterUac||resumeParser;
assert.ok(!(resumeParser&&resumeAfterUac),'Choose only one reviewed resumption reason');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=file=>JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const command=(file,args)=>execFileSync(file,args,{encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024,stdio:['ignore','pipe','pipe']});
function runLog(label,file,args){const r=spawnSync(file,args,{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:24*1024*1024});writeFileSync(resolve(dir,(resumeParser?'parser-fixed-':resumeAfterUac?'retry-1-':'')+label+'.log'),(r.stdout||'')+'\n'+(r.stderr||''));if(r.status!==0)throw Error(label+': exit '+r.status+'; private log retained');}
function snapshot(){return ['nginx','frontend','backend','postgres','redis'].map(service=>{const c=JSON.parse(command('docker',['inspect','uasspain-'+service]))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],'uasspain');assert.equal(c.State.Health?.Status,'healthy');return {service,id:c.Id,image:c.Image,mounts:c.Mounts.filter(m=>m.Type==='volume').map(m=>({name:m.Name,destination:m.Destination})),host_bindings:c.HostConfig.PortBindings};});}
function identities(){return JSON.parse(command('docker',['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',"SELECT json_build_object('profiles',(SELECT count(*) FROM accounts_userprofile),'identity',md5((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('auth_digest',md5(to_jsonb(u)::text)) ORDER BY p.id)::text FROM accounts_userprofile p JOIN auth_user u ON p.user_id=u.id)),'secrets',md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM core_systemsecret s)))"]));}
function elevate(action){const script=resolve('scripts/audit/direct-https-portproxy.ps1').replaceAll("'","''");const ps=`$ErrorActionPreference='Stop';$uasArguments='-NoProfile -File "${script}" -Action ${action} -Apply${resumeParser&&action==='Remove'?' -ResumeAfterValidationFix':''}';$uasProcess=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $uasArguments -PassThru -Wait;exit $uasProcess.ExitCode`;runLog('portproxy-'+action.toLowerCase(),'powershell.exe',['-NoProfile','-Command',ps]);}
if(!process.argv.includes('--apply'))throw Error('Explicit --apply required after specific owner authorization');
if(resumeParser){
 const prior=json(reportPath),original=json(resolve(dir,'before.json'));
 assert.equal(prior.status,'BLOCKED');assert.equal(prior.phase,'ROLLBACK');assert.match(prior.rollback,/^BLOCKED: portproxy-restore/);
 assert.match(json('docs/audits/evidence/2026-11-17-direct-https-proxy-remove.json').error,/La tabla no coincide/);
 assert.match(json('docs/audits/evidence/2026-11-17-direct-https-proxy-restore.json').error,/La reposici/);
 assert.ok(!existsSync('docs/audits/evidence/2026-11-17-direct-https-apply-parser-failure.json'),'Do not repeat a corrected attempt automatically');
 assert.equal(sha(readFileSync('docker-compose.yml')),original.compose_sha256);assert.equal(sha(readFileSync('.env')),original.env_sha256);
 command('powershell.exe',['-NoProfile','-File','scripts/audit/direct-https-portproxy.ps1','-SelfTest']);
 for(const suffix of ['apply','proxy-remove','proxy-restore'])copyFileSync('docs/audits/evidence/2026-11-17-direct-https-'+suffix+'.json','docs/audits/evidence/2026-11-17-direct-https-'+suffix+'-parser-failure.json');
}else if(resumeAfterUac){
 const prior=json(reportPath),original=json(resolve(dir,'before.json'));
 assert.equal(prior.status,'BLOCKED');assert.equal(prior.phase,'ROLLBACK');assert.match(prior.rollback,/^APPLIED_ORIGINAL_CONFIG_AND_PROXY/);assert.match(prior.error,/^portproxy-remove: exit 1/);
 assert.match(readFileSync(resolve(dir,'portproxy-remove.log'),'utf8'),/cancelado|cancelled|canceled/);
 assert.ok(!existsSync(resolve(dir,'proxy.before.txt')),'The elevated removal must never have started');
 assert.ok(!existsSync('docs/audits/evidence/2026-11-17-direct-https-apply-first-attempt.json'),'One reviewed retry only; no automatic loop');
 assert.equal(sha(readFileSync('docker-compose.yml')),original.compose_sha256);assert.equal(sha(readFileSync('.env')),original.env_sha256);
 copyFileSync(reportPath,'docs/audits/evidence/2026-11-17-direct-https-apply-first-attempt.json');
}else assert.ok(!existsSync(resolve(dir,'before.json')),'Existing attempt prevents replay');
const proposal=json('docs/audits/evidence/2026-11-17-direct-https-proposal.json');const compose=readFileSync('docker-compose.yml'),candidate=readFileSync('.run/audit-20261117/direct-https/docker-compose.candidate.yml');
assert.equal(sha(compose),proposal.original_compose_sha256);assert.equal(sha(candidate),proposal.candidate_compose_sha256);
const env=readFileSync('.env'),envText=env.toString('utf8');assert.ok(!/^HTTPS_LAN_BIND=/m.test(envText),'Unexpected existing LAN bind setting');
const containers=snapshot(),identity=identities();assert.equal(identity.profiles,8);mkdirSync(dir,{recursive:true});
const rollbackImage='uasspain-nginx:rollback-direct-https-20261117',oldNginx=containers.find(c=>c.service==='nginx');
const priorTag=spawnSync('docker',['image','inspect',rollbackImage,'--format','{{.Id}}'],{encoding:'utf8',windowsHide:true});
if(priorTag.status===0)assert.equal(priorTag.stdout.trim(),oldNginx.image,'Never replace an unrelated rollback tag');else command('docker',['image','tag',oldNginx.image,rollbackImage]);
if(!resuming){copyFileSync('docker-compose.yml',resolve(dir,'docker-compose.before.yml'));copyFileSync('.env',resolve(dir,'env.before'));
 command('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;$uasSection=[System.Security.AccessControl.AccessControlSections]::Access;$uasSource=Get-Acl -LiteralPath '.env';$uasBackup=Get-Acl -LiteralPath '.run/audit-20261117/direct-https/apply/env.before';$uasBackup.SetSecurityDescriptorSddlForm($uasSource.GetSecurityDescriptorSddlForm($uasSection),$uasSection);Set-Acl -LiteralPath '.run/audit-20261117/direct-https/apply/env.before' -AclObject $uasBackup;if((Get-Acl -LiteralPath '.run/audit-20261117/direct-https/apply/env.before').GetSecurityDescriptorSddlForm($uasSection) -ne $uasSource.GetSecurityDescriptorSddlForm($uasSection)){throw 'Backup access rules mismatch'}"]);
}
const before=resuming?json(resolve(dir,'before.json')):{observed_at:new Date().toISOString(),containers,identity,rollback_image:rollbackImage,compose_sha256:sha(compose),env_sha256:sha(env),dpapi_sha256:sha(readFileSync('.secrets/postgres-storage-key.dpapi')),ca_sha256:sha(readFileSync('.secrets/tls/ca.crt'))};
if(resuming)assert.deepEqual(identity,before.identity,'Account state changed; review instead of reusing baseline');else writeFileSync(resolve(dir,'before.json'),JSON.stringify(before,null,2));
const report={observed_at:new Date().toISOString(),status:'APPLYING',phase:'PREBUILD',reviewed_retry_after_uac_cancel:resumeAfterUac,reviewed_retry_after_rule_parser_fix:resumeParser,before_containers:containers,other_service_restarts:0,ip_helper_tailscale_restarts:0,firewall_dns_router_changes:0,database_writes:0,windows_reboot:'NOT_RUN',external_retest:'NOT_RUN',rollback:'NOT_NEEDED'};
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();let removed=false;
try{
 writeFileSync('docker-compose.yml',candidate);const nl=envText.includes('\r\n')?'\r\n':'\n';writeFileSync('.env',envText+(envText.endsWith('\n')?'':nl)+'HTTPS_LAN_BIND=192.168.1.34'+nl);
 runLog('compose-quiet','docker',['compose','-p','uasspain','-f','docker-compose.yml','-f','docker-compose.encrypted.yml','config','--quiet']);
 runLog('nginx-prebuild','docker',['compose','-p','uasspain','-f','docker-compose.yml','-f','docker-compose.encrypted.yml','build','nginx']);
 report.phase='REMOVE_REDUNDANT_WINDOWS_PROXY';save();elevate('Remove');removed=true;
 report.phase='OFFICIAL_NGINX_BUILD_DEPLOY';save();runLog('official-build','powershell.exe',['-NoProfile','-File','scripts/start-encrypted-stack.ps1','-Build','-Services','nginx']);
 const after=snapshot();assert.deepEqual(after.filter(c=>c.service!=='nginx'),containers.filter(c=>c.service!=='nginx'),'Other services must remain untouched');
 assert.deepEqual(after.find(c=>c.service==='nginx').mounts,containers.find(c=>c.service==='nginx').mounts);
 assert.deepEqual(identities(),identity,'Eight identities, credentials, roles, links and provider secrets must remain unchanged');
 assert.equal(sha(readFileSync('.secrets/postgres-storage-key.dpapi')),before.dpapi_sha256);assert.equal(sha(readFileSync('.secrets/tls/ca.crt')),before.ca_sha256);
 report.after_containers=after;report.identities_credentials_links_secrets_unchanged=true;report.dpapi_ca_unchanged=true;report.phase='DEPLOYED_PENDING_FUNCTION_AND_RESTART_TEST';report.status='PASS_DEPLOYMENT_ONLY';save();
}catch(error){
 report.status='BLOCKED';report.error=error.message;report.phase='ROLLBACK';save();
 try{writeFileSync('docker-compose.yml',compose);writeFileSync('.env',env);runLog('rollback-official','powershell.exe',['-NoProfile','-File','scripts/start-encrypted-stack.ps1','-Build','-Services','nginx']);if(removed||existsSync(resolve(dir,'proxy.before.txt')))elevate('Restore');report.rollback='APPLIED_ORIGINAL_CONFIG_AND_PROXY; FUNCTIONAL_VALIDATION_REQUIRED';}catch(rollbackError){report.rollback='BLOCKED: '+rollbackError.message;}
 save();process.exitCode=1;
}
console.log(JSON.stringify({status:report.status,phase:report.phase,rollback:report.rollback,error:report.error,identities_preserved:report.identities_credentials_links_secrets_unchanged}));
