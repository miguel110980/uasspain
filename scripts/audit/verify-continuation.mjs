/** End-of-continuation health and data proof; normal authorized mail/login writes are visible. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),sha=v=>createHash('sha256').update(v).digest('hex');
const output=resolve(root,'docs/audits/evidence/2026-11-16-continuation.json');
function run(file,args,input){return execFileSync(file,args,{encoding:'utf8',windowsHide:true,input,timeout:30000,maxBuffer:16*1024*1024,stdio:['pipe','pipe','pipe']}).trim()}
function sql(query){assert.ok(/^SELECT\b/.test(query));return run('docker',['exec','-i','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-f','-'],`BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; ${query}; COMMIT;`)}
const baseline=JSON.parse(readFileSync(resolve(root,'.run/audit-20261116/preupdate-fb2385bf851f/source-fingerprints.json'),'utf8'));
const deployed=JSON.parse(readFileSync(resolve(root,'docs/audits/evidence/2026-11-16-readonly-post-update.json'),'utf8'));
const checks=[],gate=(id,ok,observed)=>checks.push({id,status:ok?'PASS':'FAIL',observed});
const containers=[];
for(const service of ['nginx','frontend','backend','postgres','redis']){const c=JSON.parse(run('docker',['inspect',`uasspain-${service}`]))[0],image=JSON.parse(run('docker',['image','inspect',c.Config.Image]))[0].Id;containers.push({service,id:c.Id,image,health:c.State.Health?.Status,state:c.State.Status,source_image_unchanged:image===deployed.checks.find(x=>x.id==='FIVE_EXISTING_SERVICES').observed.find(x=>x.service===service).image})}
gate('SAME_FIVE_DEPLOYED_IMAGES_HEALTHY',containers.length===5&&containers.every(x=>x.state==='running'&&x.health==='healthy'&&x.source_image_unchanged),containers);
const agent=new https.Agent({ca:readFileSync(resolve(root,'.secrets/tls/ca.crt'))});
const health=await Promise.all(['/healthz','/readyz','/api/health/live/','/api/health/ready/'].map(path=>new Promise(resolve=>{const r=https.get('https://localhost'+path,{agent},s=>{const authorized=s.socket.authorized;let bytes=0;s.on('data',b=>bytes+=b.length);s.on('end',()=>resolve({path,http:s.statusCode,authorized,bytes,tls_bypass:false}))});r.setTimeout(10000,()=>r.destroy());r.on('error',()=>resolve({path,http:null,authorized:false}))})));
gate('FOUR_HTTPS_HEALTH_RESPONSES',health.every(x=>x.http===200&&x.authorized&&x.bytes>0),health);agent.destroy();
const different=[];for(const t of baseline.tables){assert.match(t.name,/^[a-z0-9_]+$/);const data=sql(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public."${t.name}" t`);if(sha(data)!==t.sha256)different.push({table:t.name,before_rows:t.rows,after_rows:JSON.parse(data).length})}
// Actual schema/events were inspected after the initial overly narrow runner allowlist failed.
// Preserve that attempt below; do not label authorized login/test ledgers as lost business data.
const allowedOperational=['auth_tab_session','conexiones_registroconexion','core_auditlog','google_oauth_event','google_oauth_flow','mail_outbox','mail_circuit','core_systemsetting'];
const operations=JSON.parse(sql("SELECT json_build_object('audit_actions',(SELECT json_agg(action) FROM core_auditlog WHERE created_date>'2026-11-16T12:14:08Z'),'google_operations',(SELECT json_agg(operation) FROM google_oauth_event WHERE created_at>'2026-11-16T12:14:08Z'),'google_purposes',(SELECT json_agg(purpose) FROM google_oauth_flow WHERE created_at>'2026-11-16T12:14:08Z'))"));
gate('OPERATIONAL_EVENTS_MATCH_OWNER_LOGIN_AND_ONE_MAIL_TEST',operations.audit_actions?.length===2&&operations.audit_actions.includes('google_flow_started')&&operations.audit_actions.includes('smtp_service_test')&&operations.google_operations?.length===1&&operations.google_operations[0]==='google_flow_started'&&operations.google_purposes?.length===1&&operations.google_purposes[0]==='login',operations);
gate('BUSINESS_TABLE_CONTENT_PRESERVED',different.every(x=>allowedOperational.includes(x.table)),{compared_tables:baseline.tables.length,different_tables:different,allowed_operational_tables:allowedOperational,scope:'Changes listed explicitly: owner logins/logout and the single authorized mail test; not a claim of byte-identical whole database after authorized business operations'});
gate('DPAPI_UNCHANGED',sha(readFileSync(resolve(root,'.secrets/postgres-storage-key.dpapi')))===baseline.dpapi_sha256,{});
const profiles=JSON.parse(sql("SELECT json_build_object('total',count(*),'roles',(SELECT json_object_agg(role,n) FROM (SELECT role,count(*) n FROM accounts_userprofile GROUP BY role) q)) FROM accounts_userprofile"));
gate('EIGHT_ORIGINAL_PROFILE_PRIMARY_ROLES',profiles.total===8&&profiles.roles.admin===1&&profiles.roles.instructor===2&&profiles.roles.alumno===5,profiles);
const report={observed_at:new Date().toISOString(),status:checks.every(x=>x.status==='PASS')?'PASS':'FAIL',scope:'ORIGINAL read-only verification after authorized external mail and isolated panel/media tests; no build/configuration or data mutations by this collector',checks};
if(existsSync(output)){const prior=JSON.parse(readFileSync(output,'utf8'));report.previous_attempt={observed_at:prior.observed_at,status:prior.status,failed_checks:prior.checks.filter(x=>x.status==='FAIL').map(x=>x.id),reason:'Initial audit-runner list omitted actual Google login/audit/circuit tables; their metadata was inspected before correcting the list. No application data fix was performed.'}}
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.map(({id,status})=>({id,status})),different_tables:different}));if(report.status!=='PASS')process.exitCode=1;
