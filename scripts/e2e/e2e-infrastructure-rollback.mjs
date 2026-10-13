import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {adminClient,sql} from './auth-fixtures.mjs';
const admin=await adminClient();const gates=[];let changed=false;
const configBefore=sql('SELECT COALESCE(jsonb_agg(to_jsonb(c)),\'[]\') FROM infrastructure_config c');
const serversBefore=sql('SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),\'[]\') FROM backups_backupserver s');
const image=()=>JSON.parse(execFileSync('docker',['inspect','uasspain-e2e-backend-e2e-1'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0];
const original=image();assert.equal(original.Config.Labels['com.docker.compose.project'],'uasspain-e2e');
function configure(enabled){execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/e2e/infrastructure-runtime.ps1','-Enabled',String(enabled)],{stdio:['ignore','pipe','pipe']});}
function gate(ok,name){assert.ok(ok,name);gates.push(name);console.log('PASS '+name)}
try{
 const before=(await admin.call('/api/infrastructure/')).body;gate(before.enabled===true,'preparation_initially_enabled');
 configure(false);changed=true;gate(image().Image===original.Image,'reversal_preserves_exact_image_and_schema');
 const disabled=await admin.call('/api/infrastructure/');gate(disabled.status===200&&!disabled.body.enabled,'read_only_configuration_preserved_when_disabled');
 for(const [path,method,body] of [['/api/infrastructure/','PUT',{expected_revision:before.revision,config:before.config}],['/api/infrastructure/validate/','POST',{}],['/api/infrastructure/export/','GET']])gate((await admin.call(path,method,body)).status===503,'reversed_function_denies_'+method+'_'+path);
 gate((await admin.call('/api/backups/status/')).status===200,'existing_backup_api_remains_available');
 gate((await admin.call('/api/auth/me/')).status===200,'existing_authentication_survives_reversal');
 gate(sql('SELECT MAX(version) FROM _sqlx_migrations WHERE success')==='29','expanded_schema_not_deleted');
 gate(sql('SELECT COALESCE(jsonb_agg(to_jsonb(c)),\'[]\') FROM infrastructure_config c')===configBefore,'reversal_keeps_configuration_byte_identical');
 gate(sql('SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY id),\'[]\') FROM backups_backupserver s')===serversBefore,'reversal_preserves_all_fixture_destinations');
 configure(true);changed=false;gate((await admin.call('/api/infrastructure/')).body.enabled===true,'explicit_reenable_verified');
}finally{
 if(changed)configure(true);
 mkdirSync('.run/infrastructure-20261012',{recursive:true});
 writeFileSync('.run/infrastructure-20261012/rollback.json',JSON.stringify({time:new Date().toISOString(),scope:'isolated reversible withdrawal of new writes on the same schema-aware image; no downgrade or destructive restore',gates,mainWrites:0,result:gates.length===12?'PASS':'NOT_COMPLETE'},null,2));
}
