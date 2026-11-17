import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {docker,inspect,work,originalFingerprint} from './four-issues-lab-common.mjs';

const output='docs/audits/evidence/2026-11-17-original-video-reconnection-apply.json';
assert.ok(!existsSync(output),'Review the previous deployment before replaying it');
const validation=JSON.parse(readFileSync('docs/audits/evidence/2026-11-17-admin-instructor-reconnection-validation.json','utf8'));
assert.equal(validation.status,'PASS_REAL_LOCAL_MEDIA_RECONNECTION');
assert.equal(validation.hook_sha256,createHash('sha256').update(readFileSync('frontend/src/hooks/useWebrtc.ts')).digest('hex'));
const before={accounts:originalFingerprint(),containers:['nginx','frontend','backend','postgres','redis'].map(service=>{const c=inspect('uasspain-'+service);return {service,id:c.Id,image:c.Image,started_at:c.State.StartedAt,mounts:c.Mounts,ports:c.HostConfig.PortBindings};})};
const protectedFiles=['.env','.secrets/postgres-storage-key.dpapi','.secrets/field_encryption_key','.secrets/bootstrap_admin_password','.secrets/test-accounts.dpapi','.secrets/tls/ca.crt','.secrets/tls/ca.key'];
const digest=()=>createHash('sha256').update(protectedFiles.map(file=>createHash('sha256').update(readFileSync(file)).digest('hex')).join(':')).digest('hex');
before.protected_digest=digest();
const academic=()=>docker(['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'examenes_%' OR tablename LIKE 'materiales_%' OR tablename LIKE 'practicas_%' OR tablename IN ('courses','student_membership','student_course_registration')) ORDER BY tablename"]).split('\n').filter(Boolean).map(table=>{assert.match(table,/^[a-z_]+$/);return [table,docker(['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',`SELECT count(*)::text || ':' || md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) FROM "${table}" t`])];});
before.academic=academic();
writeFileSync(resolve(work,'original-reconnection-deployment-before.json'),JSON.stringify(before,null,2));
const rollback='uasspain-frontend:rollback-reconnection-20261117';
docker(['image','tag',before.containers.find(c=>c.service==='frontend').image,rollback]);
const report={started_at:new Date().toISOString(),scope:'Authorized original frontend-only reconnection repair; backend, database, Redis and Nginx unchanged',status:'RUNNING',rollback_image:rollback,hook_sha256:validation.hook_sha256,git_operations:'NOT_RUN'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
try{
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',"& './scripts/start-encrypted-stack.ps1' -Build -Services @('frontend')"],{encoding:'utf8',windowsHide:true,timeout:1800000,maxBuffer:32*1024*1024});
  writeFileSync(resolve(work,'original-reconnection-official-build.log'),(result.stdout??'')+'\n'+(result.stderr??''));
  report.official_exit_code=result.status;assert.equal(result.status,0,'Official frontend build/deployment failed');assert.ok(!result.error);
  report.deployed=[];
  for(const prior of before.containers){const c=inspect('uasspain-'+prior.service);assert.equal(c.State.Health?.Status,'healthy');if(prior.service!=='frontend'){assert.equal(c.Id,prior.id);assert.equal(c.State.StartedAt,prior.started_at);assert.deepEqual(c.Mounts,prior.mounts);assert.deepEqual(c.HostConfig.PortBindings,prior.ports);}report.deployed.push({service:prior.service,id:c.Id,image:c.Image,health:c.State.Health?.Status,started_at:c.State.StartedAt});}
  assert.equal(before.accounts,originalFingerprint());report.accounts_credentials_roles_preserved=true;
  assert.equal(before.protected_digest,digest());report.protected_keys_env_ca_preserved=true;
  assert.deepEqual(before.academic,academic());report.academic_tables_preserved=true;
  report.status='PASS_DEPLOYED_PENDING_REAL_ORIGINAL_MEDIA';
}catch(error){report.status='BLOCKED';report.error=error.message;process.exitCode=1;}
report.finished_at=new Date().toISOString();save();console.log(JSON.stringify(report));
