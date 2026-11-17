import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {docker,inspect,work,originalFingerprint} from './four-issues-lab-common.mjs';
import {originalVideoClient,loginOriginalInstructor} from './original-video-client.mjs';

const output='docs/audits/evidence/2026-11-17-original-ice-apply.json';
assert.ok(!existsSync(output),'Do not replay an original deployment without reviewing its prior result');
const before={accounts:originalFingerprint(),containers:['nginx','frontend','backend','postgres','redis'].map(service=>{const c=inspect('uasspain-'+service);return {service,id:c.Id,image:c.Image,started_at:c.State.StartedAt,mounts:c.Mounts,ports:c.HostConfig.PortBindings};})};
const secretFiles=['.env','.secrets/postgres-storage-key.dpapi','.secrets/field_encryption_key','.secrets/bootstrap_admin_password','.secrets/test-accounts.dpapi','.secrets/tls/ca.crt','.secrets/tls/ca.key'];
const secretDigest=()=>createHash('sha256').update(secretFiles.map(file=>createHash('sha256').update(readFileSync(file)).digest('hex')).join(':')).digest('hex');
before.protected_digest=secretDigest();
const query=text=>docker(['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',text]);
const academic=()=>{
  const tables=query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'examenes_%' OR tablename LIKE 'materiales_%' OR tablename LIKE 'practicas_%' OR tablename IN ('courses','student_membership','student_course_registration')) ORDER BY tablename").split('\n').filter(Boolean);
  return Object.fromEntries(tables.map(table=>{assert.match(table,/^[a-z_]+$/);return [table,query(`SELECT count(*)::text || ':' || md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) FROM "${table}" t`)];}));
};
before.academic=academic();
writeFileSync(resolve(work,'original-deployment-before.json'),JSON.stringify(before,null,2));
for(const service of ['backend','frontend'])docker(['image','tag',before.containers.find(c=>c.service===service).image,`uasspain-${service}:rollback-admin-video-20261117`]);
const report={started_at:new Date().toISOString(),scope:'Authorized original deployment of the pending four-issue repairs and the ICE configuration required for external administrator/local instructor; five-service architecture preserved',authorization:'Owner: tienes autorizacion para todo lo que se necesita',status:'RUNNING',phase:'OFFICIAL_BUILD',checks:[],rollback_aliases:['uasspain-backend:rollback-admin-video-20261117','uasspain-frontend:rollback-admin-video-20261117'],git_operations:'NOT_RUN',source_image_audit:'uasspain-audit-backend:four-issues-audit-20261117'};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');save();
try {
  const model=JSON.parse(docker(['compose','-f','docker-compose.yml','-f','docker-compose.encrypted.yml','config','--format','json']));
  assert.deepEqual(Object.keys(model.services).sort(),['backend','frontend','nginx','postgres','redis']);
  assert.equal(model.services.backend.environment.WEBRTC_ICE_SERVERS_FILE,'/run/secrets/webrtc_ice_servers');
  const result=spawnSync('powershell.exe',['-NoProfile','-Command',"& './scripts/start-encrypted-stack.ps1' -Build -Services @('backend','frontend')"],{cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:1800000,maxBuffer:32*1024*1024});
  writeFileSync(resolve(work,'original-official-build.log'),(result.stdout??'')+'\n'+(result.stderr??''));
  report.official_exit_code=result.status;if(result.status!==0||result.error)throw Error('OFFICIAL_BUILD_OR_DEPLOY_FAILED_PRIVATE_LOG_RETAINED');
  report.phase='POST_DEPLOYMENT_CHECKS';save();
  report.deployed=[];
  for(const prior of before.containers){const c=inspect('uasspain-'+prior.service);assert.equal(c.State.Health?.Status,'healthy');if(!['backend','frontend'].includes(prior.service)){assert.equal(c.Id,prior.id);assert.equal(c.State.StartedAt,prior.started_at);assert.deepEqual(c.Mounts,prior.mounts);assert.deepEqual(c.HostConfig.PortBindings,prior.ports);}report.deployed.push({service:prior.service,id:c.Id,image:c.Image,health:c.State.Health?.Status,started_at:c.State.StartedAt});}
  report.accounts_credentials_roles_unchanged=before.accounts===originalFingerprint();assert.ok(report.accounts_credentials_roles_unchanged);
  report.protected_keys_ca_env_unchanged=before.protected_digest===secretDigest();assert.ok(report.protected_keys_ca_env_unchanged);
  report.academic_tables_unchanged=JSON.stringify(before.academic)===JSON.stringify(academic());assert.ok(report.academic_tables_unchanged);
  const actor=originalVideoClient();await loginOriginalInstructor(actor);const ice=await actor.call('/api/videollamadas/ice/');assert.equal(ice.status,200);assert.deepEqual(ice.body.iceServers,JSON.parse(readFileSync('config/webrtc-ice-servers.json','utf8')));report.authenticated_ice_config_matches=true;await actor.call('/api/auth/logout/','POST',{});
  const ownResponse=JSON.parse(docker(['exec','uasspain-backend','cat','/run/secrets/webrtc_ice_servers']));assert.deepEqual(ownResponse,ice.body.iceServers);
  report.status='PASS_DEPLOYED_PENDING_REAL_EXTERNAL_MEDIA_VALIDATION';report.phase='DEPLOYED';
} catch(error){report.status='BLOCKED';report.error=error.message;report.phase=report.phase??'UNKNOWN';process.exitCode=1;}
report.finished_at=new Date().toISOString();save();console.log(JSON.stringify(report));
