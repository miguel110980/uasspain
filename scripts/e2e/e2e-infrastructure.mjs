// Synthetic agent observations validate the authenticated contract, NOT actual
// WireGuard installation or Windows/Linux host deployment compatibility.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { adminClient, apiClient, registerFixture, mailFiles, sql, uuid, backend, sleep } from './auth-fixtures.mjs';
const dir=process.env.INFRASTRUCTURE_REPORT||'.run/infrastructure-20261012';mkdirSync(dir,{recursive:true});
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
assert.equal(docker(['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',backend]),'uasspain-e2e');
const admin=await adminClient();const call=(path,method='GET',body)=>admin.call(path,method,body);
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const gates=[], errors=[], owned=randomUUID();const gate=(value,name)=>{assert.ok(value,name);gates.push(name);console.log('PASS '+name)};
const configBefore=sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1');
const serversBefore=sql('SELECT COALESCE(jsonb_agg(to_jsonb(s)),\'[]\') FROM backups_backupserver s');
const eventIdsBefore=new Set(sql('SELECT id FROM infrastructure_evidence').split('\n').filter(Boolean));
const jobsBefore=new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean)),mailBefore=new Set(mailFiles());
let fixture;const fixtureKey=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY,'base64');
const decrypt=value=>{const b=Buffer.from(value.slice(3),'base64url');const c=createDecipheriv('aes-256-gcm',fixtureKey,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString()};
const keyPath='/app/backup_keys/infrastructure_agent.key', snapshotPath='/app/backup_keys/infrastructure_status.json';
const fileBefore=new Map();for(const path of [keyPath,snapshotPath]){try{fileBefore.set(path,docker(['exec',backend,'base64',path]))}catch{fileBefore.set(path,null)}}
const key=randomBytes(32), localKey=Buffer.alloc(32,1).toString('base64'), peerKey=Buffer.alloc(32,2).toString('base64');
const write=(path,content)=>{docker(['exec','-i',backend,'sh','-c','umask 077; cat > "$1"','sh',path],content)};
const observation=(platform='windows')=>({schema:1,observed_at:new Date().toISOString(),host_platform:platform,installation:'unknown',wireguard_installed:true,service_state:'interfaces_available',interfaces:[{name:'corp-fixture',public_key:localKey,listen_port:51999,addresses:['10.90.0.1/24'],peers:[{public_key:peerKey,endpoint:'192.0.2.10:51999',allowed_ips:['10.90.0.2/32'],latest_handshake:Math.floor(Date.now()/1000),rx_bytes:123,tx_bytes:456,keepalive:25}]}],networks:['172.31.0.0/16','192.168.250.0/24'],network_inventory_complete:true,errors:[]});
const sign=value=>{const bytes=Buffer.from(JSON.stringify(value));write(snapshotPath,JSON.stringify({payload:bytes.toString('base64'),signature:createHmac('sha256',key).update(bytes).digest('base64')}))};
let revision=0, localId='', localCreated=false;const ownedRoot='/app/backups/infrastructure-'+owned;
const config={host_platform:'windows',server_name:'TEMP Infrastructure '+owned,server_address:'backend-e2e',installation:'unknown',timezone:'Europe/Madrid',step:2,vpn:{interface:'corp-fixture',address:'10.90.0.1/24',port:51999,public_key:localKey,peers:[{public_key:peerKey,endpoint:'192.0.2.10:51999',allowed_ips:['10.90.0.2/32'],keepalive:25}]},paths:[],reserved_networks:['10.91.0.0/24']};
async function save(value=config){const result=await call('/api/infrastructure/','PUT',{expected_revision:revision,config:value});if(result.status===200)revision=result.body.revision;return result}
try{
  for(const route of ['/api/infrastructure/','/api/infrastructure/export/','/api/vpn/status/'])gate((await apiClient().call(route)).status===401,'anonymous_denied_'+route);
  fixture=await registerFixture('TEMP Infrastructure permissions');
  gate((await apiClient().call('/api/auth/verify-otp/','POST',{email:fixture.email,code:fixture.code})).status===200,'owned_fixture_identity_verified');
  for(const role of ['alumno','instructor']){
    gate((await admin.call(`/api/profiles/${uuid(fixture.id)}/`,'PATCH',{status:'activo',role,roles:[role]})).status===200,'synthetic_role_'+role);
    const client=apiClient();gate((await client.call('/api/auth/login/','POST',{email:fixture.email,password:fixture.password})).status===200,'synthetic_login_'+role);
    for(const [route,method,body] of [['/api/infrastructure/','GET'],['/api/infrastructure/','PUT',{expected_revision:0,config}],['/api/infrastructure/validate/','POST',{}],['/api/infrastructure/export/','GET'],['/api/vpn/status/','GET']])gate((await client.call(route,method,body)).status===403,'real_nonadmin_permission_'+role+'_'+method+'_'+route);
  }
  const existing=(await call('/api/infrastructure/')).body;revision=existing.revision;
  docker(['exec',backend,'sh','-c','test ! -f "$1" || rm -- "$1"','sh',snapshotPath]);
  gate((await call('/api/vpn/status/')).body.state==='unknown','absent_agent_never_reports_connected');
  gate((await save()).status===200,'public_configuration_saved_with_revision');
  gate((await call('/api/infrastructure/','PUT',{expected_revision:revision-1,config})).status===409,'stale_writer_denied');
  gate((await call('/api/infrastructure/','PUT',{expected_revision:revision,config:{...config,private_key:'forbidden'}})).status===400,'private_keys_rejected');
  gate((await save({...config,paths:[{name:'bad',host_path:'D:\\Backups\\..\\secrets',service_path:'/app/backups'}]})).status===400,'path_traversal_rejected');
  gate((await save({...config,vpn:{...config.vpn,peers:[{...config.vpn.peers[0],allowed_ips:['0.0.0.0/0']}]}})).status===400,'full_tunnel_route_rejected');
  gate((await save({...config,reserved_networks:['10.90.0.0/16']})).status===400,'reserved_network_overlap_rejected');
  gate((await call('/api/infrastructure/validate/','POST')).body.state==='BLOCKED','missing_agent_blocks_preparation');
  write(keyPath,key);sign(observation());
  let vpn=(await call('/api/vpn/status/')).body;gate(vpn.state==='connected'&&vpn.active_peers===1&&vpn.peers[0].rx_bytes===123,'signed_synthetic_observation_contract');
  const stale=observation();stale.observed_at=new Date(Date.now()-121000).toISOString();sign(stale);
  gate((await call('/api/vpn/status/')).body.state==='unknown','expired_signed_snapshot_blocks_status');
  sign(observation());const invalid=JSON.parse(docker(['exec',backend,'cat',snapshotPath]));invalid.signature=Buffer.alloc(32,3).toString('base64');write(snapshotPath,JSON.stringify(invalid));
  gate((await call('/api/vpn/status/')).body.state==='unknown','manipulated_signature_denied');
  const oldHandshake=observation();oldHandshake.interfaces[0].peers[0].latest_handshake=Math.floor(Date.now()/1000)-190;sign(oldHandshake);
  gate((await call('/api/vpn/status/')).body.state==='disconnected','old_handshake_is_disconnected');
  const mismatch=observation();mismatch.interfaces[0].public_key=peerKey;sign(mismatch);
  gate((await call('/api/vpn/status/')).body.state==='disconnected','wrong_local_identity_not_active');
  const conflict=observation();conflict.networks.push('10.90.0.0/16');sign(conflict);
  gate((await call('/api/infrastructure/validate/','POST')).body.state==='FAILED','actual_observed_network_overlap_fails');
  const unknownNetworks=observation();unknownNetworks.network_inventory_complete=false;sign(unknownNetworks);
  gate((await call('/api/infrastructure/validate/','POST')).body.checks.network_conflicts==='NOT_RUN','incomplete_inventory_not_verified');
  const servers=(await call('/api/backups/servers/')).body;
  for(const server of servers)gate((await call(`/api/backups/servers/${uuid(server.id)}/`,'PUT',{is_active:false})).status===200,'isolated_destination_disabled_'+server.role);
  const originalLocal=servers.find(s=>s.role==='local');localCreated=!originalLocal;
  const local=await call(originalLocal?`/api/backups/servers/${uuid(originalLocal.id)}/`:'/api/backups/servers/',originalLocal?'PUT':'POST',{name:'TEMP Infrastructure local '+owned,role:'local',transfer_protocol:'copy',smb_share:ownedRoot,is_active:false});
  gate([200,201].includes(local.status),'owned_local_path_configured');localId=uuid(local.body.id);
  const probe=await call('/api/backups/test-connection/','POST',{server_id:localId});
  gate(probe.body.ok&&probe.body.capacity_verified&&probe.body.available_bytes>0,'real_local_write_read_cleanup_and_capacity');
  gate((await call(`/api/backups/servers/${localId}/`,'PUT',{is_active:true})).body.is_active,'local_enabled_after_real_probe');
  sign(observation());let verified=await call('/api/infrastructure/validate/','POST');
  gate(verified.body.state==='VERIFIED','synthetic_agent_and_real_local_storage_preparation_contract');
  const linux={...config,host_platform:'linux',paths:[{name:'Fixture mount',host_path:ownedRoot,service_path:ownedRoot}]};gate((await save(linux)).status===200,'linux_path_adapter_configuration');sign(observation('linux'));
  let linuxObservation=observation('linux');sign(linuxObservation);verified=await call('/api/infrastructure/validate/','POST');gate(verified.body.checks.paths[0].result==='BLOCKED','unconfirmed_mapping_is_not_verified');
  linuxObservation.mounts=[{source:ownedRoot,destination:ownedRoot,read_only:false}];sign(linuxObservation);
  verified=await call('/api/infrastructure/validate/','POST');gate(verified.body.state==='VERIFIED'&&verified.body.checks.paths[0].result==='PASS','linux_adapter_contract_and_real_container_path');
  const exported=await call('/api/infrastructure/export/');gate(exported.status===200&&exported.body.secrets_included===false&&!JSON.stringify(exported.body).includes(key.toString('base64')),'export_has_no_collector_secret');
  const connections=sql("SELECT has_table_privilege('uasspain_app','infrastructure_evidence','UPDATE') OR has_table_privilege('uasspain_app','infrastructure_evidence','DELETE')");gate(connections==='f','runtime_cannot_modify_or_delete_evidence');
  const beforeRestart=(await call('/api/infrastructure/')).body;docker(['restart',backend]);
  gate(beforeRestart.evidence.some(e=>e.state==='ACTIVE'&&e.checks.operation==='service_observation'),'service_state_persists_separately_from_preparation');
  for(let i=0;i<100;i++){try{if((await call('/api/health/ready/')).status===200)break}catch{}await sleep(200)}
  gate(JSON.stringify((await call('/api/infrastructure/')).body.config)===JSON.stringify(beforeRestart.config),'configuration_persists_after_actual_restart');
  gate((await call('/api/infrastructure/')).body.evidence.some(e=>e.state==='VERIFIED'),'evidence_persists_after_actual_restart');
  gate(docker(['exec',backend,'find',ownedRoot,'-maxdepth','1','-type','f']).length===0,'owned_local_probe_file_residue_zero');
}catch(error){errors.push(error.message);throw error}
finally{
  const current=sql('SELECT config->>\'server_name\' FROM infrastructure_config WHERE id=1');
  if(current===config.server_name){
    if(configBefore){sql(`UPDATE infrastructure_config SET (config,revision,updated_at,updated_by)=(SELECT config,revision,updated_at,updated_by FROM jsonb_populate_record(NULL::infrastructure_config,${q(configBefore)}::jsonb)) WHERE id=1 AND config->>'server_name'=${q(config.server_name)}`)}
    else sql(`DELETE FROM infrastructure_config WHERE id=1 AND config->>'server_name'=${q(config.server_name)}`);
  }
  if(localCreated&&localId)sql(`DELETE FROM backups_backupserver WHERE id='${localId}' AND name=${q('TEMP Infrastructure local '+owned)}`);
  for(const saved of JSON.parse(serversBefore)){
    const columns=Object.keys(saved).filter(c=>c!=='id');assert.ok(columns.every(c=>/^[a-z_][a-z0-9_]*$/.test(c)));
    sql(`UPDATE backups_backupserver SET (${columns.join(',')})=(SELECT ${columns.join(',')} FROM jsonb_populate_record(NULL::backups_backupserver,${q(JSON.stringify(saved))}::jsonb)) WHERE id='${uuid(saved.id)}'`);
  }
  for(const [path,prior] of fileBefore){if(prior===null){docker(['exec',backend,'rm','-f','--',path])}else{write(path,Buffer.from(prior,'base64'))}}
  if(fixture){
    for(const id of sql('SELECT id FROM mail_outbox').split('\n').filter(id=>id&&!jobsBefore.has(id)).map(uuid)){
      const value=JSON.parse(sql(`SELECT to_jsonb(o) FROM mail_outbox o WHERE id='${id}'`));
      if(value.validity?.profile_id===fixture.id)sql(`DELETE FROM mail_outbox WHERE id='${id}'`);
    }
    for(const path of mailFiles().filter(path=>!mailBefore.has(path))){assert.match(path,/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/);if(JSON.parse(decrypt(docker(['exec',backend,'cat',path]))).to===fixture.email)docker(['exec',backend,'rm','--',path]);}
    sql(`DELETE FROM accounts_userprofile WHERE id='${uuid(fixture.id)}' AND user_id=${Number(fixture.userId)}`);sql(`DELETE FROM auth_user WHERE id=${Number(fixture.userId)} AND NOT EXISTS(SELECT 1 FROM accounts_userprofile WHERE user_id=${Number(fixture.userId)})`);
    gate(sql(`SELECT count(*) FROM accounts_userprofile WHERE id='${fixture.id}'`)==='0','owned_profile_residue_zero');fixture.password='';fixtureKey.fill(0);
  }
  try{docker(['exec',backend,'rmdir','--',ownedRoot])}catch{}
  const evidenceIds=sql('SELECT id FROM infrastructure_evidence').split('\n').filter(id=>id&&!eventIdsBefore.has(id));key.fill(0);
  const restored=sql('SELECT to_jsonb(c) FROM infrastructure_config c WHERE id=1');assert.equal(restored,configBefore);
  const restoredServers=JSON.parse(sql('SELECT COALESCE(jsonb_agg(to_jsonb(s)),\'[]\') FROM backups_backupserver s'));
  const order=items=>items.sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(order(restoredServers),order(JSON.parse(serversBefore)));
  writeFileSync(dir+'/infrastructure-api.json',JSON.stringify({time:new Date().toISOString(),scope:'isolated synthetic host observations; actual container storage; no actual WireGuard compatibility claim',mainWrites:0,gates,errors,result:errors.length?'FAIL':'PASS',ownedId:owned,evidenceIds,evidenceRetained:true,configurationRestored:true},null,2));
}
