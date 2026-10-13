// Isolated policy/queue acceptance. Provider HTTP responses are covered by Rust
// transport tests; this script never claims real Postmark delivery or sends there.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { adminClient, apiClient, backend, sql, uuid, check, sleep, mailFiles } from './auth-fixtures.mjs';
const key=Buffer.from(process.env.E2E_FIELD_ENCRYPTION_KEY,'base64');
const encrypt=value=>{const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);return 'v1:'+Buffer.concat([nonce,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64').replaceAll('+','-').replaceAll('/','_');};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const admin=await adminClient(),anonymous=apiClient();
const fixtureAdminId=uuid((await admin.call('/api/auth/me/')).body.id);
let passed=0;const gate=(condition,name)=>{check(condition,name);passed++;console.log('PASS '+name);};
const owned=randomUUID(),recipient=`mail-fixture-${owned}@example.invalid`,ids=[];
const beforeFiles=new Set(mailFiles());
const settingKeys=['mail_api','mail_api_draft','mail_mode'];
const initialSettings=JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM core_systemsetting t WHERE key IN (${settingKeys.map(quote).join(',')})`));
const initialSecrets=JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM core_systemsecret t WHERE key IN ('postmark_candidate','postmark_server_token')"));
const circuits=JSON.parse(sql("SELECT jsonb_agg(to_jsonb(t)) FROM mail_circuit t"));
const migrations=JSON.parse(sql("SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM mail_migration t"));
const migrationHistoryIds=new Set(sql('SELECT id FROM mail_migration_transition').split('\n').filter(Boolean));
const audits=new Set(sql('SELECT id FROM core_auditlog').split('\n').filter(Boolean));
const outboxIds=new Set(sql('SELECT id FROM mail_outbox').split('\n').filter(Boolean));
const smtpBaseline=sql("SELECT COALESCE((SELECT value::text FROM core_systemsetting WHERE key='smtp'),'null')");
const profileQuery=`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(CASE WHEN id='${fixtureAdminId}' THEN to_jsonb(p)-'updated_date'-'nombre'-'apellidos' ELSE to_jsonb(p) END ORDER BY id)::text,''),'UTF8')),'hex') FROM accounts_userprofile p`;
const profileBaseline=sql(profileQuery);
const decrypt=value=>{const bytes=Buffer.from(value.slice(3),'base64url'),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();};
const administratorNames=()=>JSON.parse(sql(`SELECT jsonb_build_array(nombre,apellidos) FROM accounts_userprofile WHERE id='${fixtureAdminId}'`)).map(decrypt);
const beforeAdminNames=administratorNames();
const writeSetting=(name,value)=>sql(`INSERT INTO core_systemsetting(id,created_date,updated_date,key,value) VALUES('${randomUUID()}',NOW(),NOW(),${quote(name)},${quote(JSON.stringify(value))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
const seed=(state,provider='isolated',extra='')=>{
 const id=randomUUID();ids.push(id);
 const envelope={from:'no-reply@uasspain.com',from_name:'UASSpain',to:recipient,reply_to:null,subject:'TEMP '+owned,body:'TEMP '+owned,smtp:null};
 sql(`INSERT INTO mail_outbox(id,message_type,provider,payload_ciphertext,idempotency_key,state,expires_at${extra.includes('lease')?',lease_until':''}) VALUES('${id}','fixture',${quote(provider)},${quote(encrypt(JSON.stringify(envelope)))},'fixture-${id}',${quote(state)},NOW()+INTERVAL '1 hour'${extra.includes('lease')?',NOW()-INTERVAL \'1 second\'':''})`);return id;
};
const waitState=async(id,state)=>{for(let n=0;n<100;n++){if(sql(`SELECT state FROM mail_outbox WHERE id='${uuid(id)}'`)===state)return true;await sleep(100);}return false;};
try {
 gate((await anonymous.call('/api/system/mail/')).status===401,'mail_config_requires_login');
 gate((await anonymous.call('/api/system/mail/monitor/')).status===401,'mail_monitor_requires_login');
 const initial=(await admin.call('/api/system/mail/')).body;
 gate(!Object.hasOwn(initial,'api_key')&&!JSON.stringify(initial).includes('ciphertext'),'secret_values_never_returned');
 const draft={provider:'postmark',from_email:'no-reply@uasspain.com',from_name:'UASSpain',contact_recipient:'info@uasspain.com',sender_panel_confirmed:false,verified_at:new Date().toISOString(),verification_message_id:randomUUID()};
 let saved=await admin.call('/api/system/mail/','PUT',{api_exclusive:false,config:draft,api_key:'isolated-mail-credential'});
 gate(saved.status===200&&saved.body.key_configured,'candidate_key_stored');
 gate(saved.body.sender_status==='UNCONFIRMED'&&saved.body.config.verified_at===null,'submitted_verification_cannot_forge_provider_evidence');
 const ciphertext=sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_candidate'");
 gate(ciphertext.startsWith('v1:')&&!ciphertext.includes('isolated-mail-credential'),'candidate_ciphertext_at_rest');
 gate((await admin.call('/api/system/mail/','PUT',{api_exclusive:false,config:draft,api_key:''})).status===200&&sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_candidate'")===ciphertext,'empty_secret_preserves_candidate');
 gate((await admin.call('/api/system/mail/','PUT',{api_exclusive:true,config:draft,api_key:''})).status===400,'unverified_api_activation_denied');
 gate((await admin.call('/api/system/mail/test/','POST',{recipient,confirm_authorized_recipient:true})).status===400,'unconfirmed_sender_blocks_before_external_request');
 gate((await admin.call('/api/system/mail/test/','POST',{recipient,confirm_authorized_recipient:false})).status===400,'unauthorized_test_recipient_denied');
 gate(sql("SELECT COALESCE((SELECT value::text FROM core_systemsetting WHERE key='smtp'),'null')")===smtpBaseline,'smtp_configuration_preserved_by_api_preparation');
 const good=seed('PENDING');gate(await waitState(good,'ACCEPTED'),'persistent_worker_accepts_only_isolated_sink');
 gate(sql(`SELECT external_id IS NULL AND delivery_evidence IS NULL AND attempts=1 FROM mail_outbox WHERE id='${good}'`)==='t','internal_sink_never_claims_external_delivery');
 const stale=seed('PROCESSING','isolated','lease');gate(await waitState(stale,'UNKNOWN'),'abandoned_lease_becomes_unknown_not_resend');
 const expired=seed('PENDING');sql(`UPDATE mail_outbox SET expires_at=NOW()-INTERVAL '1 second' WHERE id='${expired}'`);gate(await waitState(expired,'EXPIRED'),'expired_pending_message_not_sent');
 const invalid=seed('PENDING');sql(`UPDATE mail_outbox SET validity='{"kind":"login_otp","profile_id":"${randomUUID()}","hash":"synthetic-invalid"}'::jsonb WHERE id='${invalid}'`);gate(await waitState(invalid,'EXPIRED'),'replaced_or_invalid_otp_discarded_before_send');
 gate(sql(`SELECT count(*) FROM mail_outbox WHERE id IN (${ids.map(quote).join(',')}) AND state='DELIVERED'`)==='0','delivered_requires_provider_evidence');
 // Policy fixtures simulate a prior verified configuration; they are not
 // evidence of a real sender/API/mailbox. The circuit is held open throughout.
 const proof=seed('ACCEPTED','postmark');
 sql(`UPDATE mail_outbox SET external_id='${randomUUID()}' WHERE id='${proof}'`);
 writeSetting('mail_api',{...draft,verified_at:new Date().toISOString(),verification_message_id:proof,sender_panel_confirmed:true});
 sql("UPDATE mail_circuit SET state='OPEN',opened_at=NOW()+INTERVAL '1 day' WHERE provider='postmark'");
 sql("DELETE FROM core_systemsecret WHERE key='postmark_candidate'");
 sql(`INSERT INTO core_systemsecret(id,key,ciphertext) VALUES('${randomUUID()}','postmark_server_token',${quote(encrypt('isolated-mail-credential'))}) ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext`);
 const migrationId=migrations[0]?.id||randomUUID();
 if(migrations.length)sql(`UPDATE mail_migration SET state='API_VERIFIED',last_passed='API_VERIFIED' WHERE id='${uuid(migrationId)}'`);
 else sql(`INSERT INTO mail_migration(id,attempt_id,state,last_passed) VALUES('${migrationId}','${randomUUID()}','API_VERIFIED','API_VERIFIED')`);
 saved=await admin.call('/api/system/mail/','PUT',{api_exclusive:true,config:draft,api_key:''});
 gate(saved.status===200&&saved.body.api_exclusive,'isolated_verified_policy_allows_atomic_selection');
 gate((await admin.call('/api/system/smtp/','PUT',{})).status===403,'smtp_writer_cannot_override_api_mode');
 gate((await admin.call('/api/system/smtp/test/','POST',{recipient})).status===403,'smtp_transport_not_used_by_api_mode');
 const activeKey=sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_server_token'");
 const activeConfig=sql("SELECT value::text FROM core_systemsetting WHERE key='mail_api'");
 const staged=await admin.call('/api/system/mail/','PUT',{api_exclusive:true,config:draft,api_key:'isolated-new-key-candidate'});
 gate(staged.status===200&&staged.body.api_exclusive,'candidate_rotation_preserves_active_channel');
 gate(sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_server_token'")===activeKey&&sql("SELECT value::text FROM core_systemsetting WHERE key='mail_api'")===activeConfig,'rotation_does_not_replace_active_key_or_sender_before_verification');
 gate((await admin.call('/api/system/mail/test/','POST',{recipient,confirm_authorized_recipient:true})).status===400,'failed_candidate_prerequisite_does_not_send_or_promote');
 gate(sql("SELECT ciphertext FROM core_systemsecret WHERE key='postmark_server_token'")===activeKey,'failed_rotation_keeps_previous_secret');
 const contact=await admin.call('/api/contact/','POST',{nombre:'TEMP mail integration',empresa:'TEMP',email:recipient,telefono:'',servicio:'Otro',asunto:'TEMP '+owned,mensaje:'TEMP isolated enquiry '+owned,website:'',request_id:owned});
 gate(contact.status===200&&contact.body.internally_accepted&&!contact.body.delivery_accepted&&contact.body.state==='PENDING','contact_reports_queue_without_false_delivery');
 ids.push(uuid(contact.body.message_id));
 gate(sql(`SELECT provider='postmark' AND attempts=0 FROM mail_outbox WHERE id='${contact.body.message_id}'`)==='t','open_api_circuit_does_not_fallback_to_smtp_or_dev_sink');
 const repeated=await admin.call('/api/contact/','POST',{nombre:'TEMP mail integration',empresa:'TEMP',email:recipient,telefono:'',servicio:'Otro',asunto:'TEMP '+owned,mensaje:'TEMP isolated enquiry '+owned,website:'',request_id:owned});
 gate(repeated.body.message_id===contact.body.message_id,'repeated_submission_has_one_persistent_work_item');
 gate((await admin.call('/api/system/mail/','PUT',{api_exclusive:false,config:draft,api_key:''})).status===400,'rollback_requires_explicit_authorization');
 const monitor=(await admin.call('/api/system/mail/monitor/')).body;
 gate(monitor.circuits.some(c=>c.provider==='postmark'&&c.state==='OPEN')&&monitor.alerts.length>0,'real_persistent_queue_circuit_and_unknown_alerts_visible');
 gate(monitor.messages.every(m=>!Object.hasOwn(m,'payload_ciphertext')&&!Object.hasOwn(m,'to')),'monitor_has_no_credentials_or_personal_payload');
 docker(['restart',backend]);
 for(let n=0;n<100;n++){try{if((await admin.call('/api/system/mail/monitor/')).status===200)break;}catch{}await sleep(100);}
 gate(sql(`SELECT state FROM mail_outbox WHERE id='${stale}'`)==='UNKNOWN'&&sql(`SELECT state FROM mail_outbox WHERE id='${contact.body.message_id}'`)==='PENDING','queue_uncertainty_and_channel_survive_restart');
 if(process.env.E2E_MAIL_SMTP_ROLLBACK_FIXTURE==='true') {
  gate(sql("SELECT value->>'host'='contact-smtp-e2e' AND value->>'last_test_ok'='true' FROM core_systemsetting WHERE key='smtp'")==='t','rollback_uses_only_the_live_tls_fixture');
  const rollback=await admin.call('/api/system/mail/','PUT',{api_exclusive:false,config:draft,api_key:'',confirm_rollback:true});
  gate(rollback.status===200&&!rollback.body.api_exclusive,'explicit_verified_smtp_rollback_is_atomic');
  gate(await waitState(contact.body.message_id,'ACCEPTED'),'pending_message_reaches_real_isolated_smtp_after_authorized_rollback');
  const moved=JSON.parse(decrypt(sql(`SELECT payload_ciphertext FROM mail_outbox WHERE id='${contact.body.message_id}'`)));
  gate(moved.reply_to===recipient&&moved.body.includes(owned)&&sql(`SELECT provider='smtp' AND attempts=1 FROM mail_outbox WHERE id='${contact.body.message_id}'`)==='t','rollback_preserves_message_id_content_reply_to_and_one_attempt');
  gate(sql("SELECT state FROM mail_migration")==='ROLLED_BACK'&&sql(`SELECT state FROM mail_outbox WHERE id='${stale}'`)==='UNKNOWN','rollback_evidence_persists_without_resending_unknown_jobs');
 }
} finally {
 // Exact owned IDs only; restore the isolated settings that this test changed.
 const createdOutbox=sql('SELECT id FROM mail_outbox').split('\n').filter(id=>id&&!outboxIds.has(id)).map(uuid);
 check(createdOutbox.every(id=>ids.includes(id)),'Every deleted outbox row belongs to this test');
 if(createdOutbox.length)sql(`DELETE FROM mail_outbox WHERE id IN (${createdOutbox.map(quote).join(',')})`);
 for(const name of settingKeys){const current=sql(`SELECT id FROM core_systemsetting WHERE key=${quote(name)}`);if(current)sql(`DELETE FROM core_systemsetting WHERE id='${uuid(current)}' AND key=${quote(name)}`);}
 if(initialSettings.length)sql(`INSERT INTO core_systemsetting SELECT * FROM jsonb_populate_recordset(NULL::core_systemsetting,${quote(JSON.stringify(initialSettings))}::jsonb)`);
 for(const name of ['postmark_candidate','postmark_server_token']){const id=sql(`SELECT id FROM core_systemsecret WHERE key=${quote(name)}`);if(id)sql(`DELETE FROM core_systemsecret WHERE id='${uuid(id)}' AND key=${quote(name)}`);}
 if(initialSecrets.length)sql(`INSERT INTO core_systemsecret SELECT * FROM jsonb_populate_recordset(NULL::core_systemsecret,${quote(JSON.stringify(initialSecrets))}::jsonb)`);
 for(const circuit of circuits)sql(`UPDATE mail_circuit SET state=${quote(circuit.state)},failures=${circuit.failures},opened_at=${circuit.opened_at?quote(circuit.opened_at)+'::timestamptz':'NULL'},checked_at=${circuit.checked_at?quote(circuit.checked_at)+'::timestamptz':'NULL'},last_error=${quote(circuit.last_error)} WHERE provider=${quote(circuit.provider)}`);
 const createdTransitions=sql('SELECT id FROM mail_migration_transition').split('\n').filter(id=>id&&!migrationHistoryIds.has(id)).map(uuid);
 if(createdTransitions.length)sql(`DELETE FROM mail_migration_transition WHERE id IN (${createdTransitions.map(quote).join(',')})`);
 const currentMigrations=sql('SELECT id FROM mail_migration').split('\n').filter(Boolean).map(uuid);
 for(const id of currentMigrations)if(!migrations.some(row=>row.id===id))sql(`DELETE FROM mail_migration WHERE id='${id}'`);
 for(const row of migrations)sql(`UPDATE mail_migration SET attempt_id='${uuid(row.attempt_id)}',state=${quote(row.state)},last_passed=${quote(row.last_passed)},version=${row.version},updated_at=${quote(row.updated_at)}::timestamptz WHERE id='${uuid(row.id)}'`);
 // Protected audit is retained. Test cleanup never erases an audit record.
 const ownedFiles=mailFiles().filter(file=>!beforeFiles.has(file));
 for(const file of ownedFiles){check(/^\/app\/backups\/e2e-mailbox\/[0-9a-f-]+\.enc$/.test(file),'Exact fixture mailbox path');const bytes=Buffer.from(docker(['exec',backend,'cat',file]).slice(3),'base64url');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));const message=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString());if(message.to===recipient&&message.body==='TEMP '+owned)docker(['exec',backend,'rm','--',file]);}
 gate(sql(profileQuery)===profileBaseline&&JSON.stringify(administratorNames())===JSON.stringify(beforeAdminNames),'fixture_profile_values_preserved_across_bootstrap_restart');
 key.fill(0);
 gate(createdOutbox.every(id=>sql(`SELECT count(*) FROM mail_outbox WHERE id='${id}'`)==='0'),'exact_test_queue_residue_zero');
 gate([...audits].every(id=>sql(`SELECT EXISTS(SELECT 1 FROM core_auditlog WHERE id='${uuid(id)}')`)==='t'),'protected_audit_retained');
}
console.log(`MAIL_INTERNAL_API_E2E=${passed} PASS MAIN_WRITES=0 REAL_POSTMARK_DELIVERY=NOT_RUN`);
