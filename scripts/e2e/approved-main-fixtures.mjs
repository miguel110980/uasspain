// One-use phase 03 exception. No existing account is authenticated or changed.
// SQL is sent through stdin; encryption keys and passwords stay in process memory.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createCipheriv,createDecipheriv,createHash,createHmac,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const ident=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return '"'+value+'"';};
const hash=value=>createHash('sha256').update(value).digest('hex');
const docker=(args,input,buffer=false)=>{
 try{return execFileSync('docker',args,{input,encoding:buffer?undefined:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:128*1024*1024});}
 catch{throw new Error('Guarded Docker operation failed: '+args.slice(0,3).join(' '));}
};
export async function approvedFixtures({origin,dir}){
 const main=origin==='https://localhost';
 assert.ok(!main||process.argv.includes('--approved-main-fixtures'),'Explicit phase 03 exception required');
 const project=main?'uasspain':'uasspain-e2e';
 const pg=main?'uasspain-postgres':'uasspain-e2e-postgres-e2e-1';
 const backend=main?'uasspain-backend':'uasspain-e2e-backend-e2e-1';
 const database=main?'uasspain':'test_e2e_uasspain';
 for(const container of [pg,backend])assert.equal(docker(['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',container]).trim(),project);
 await mkdir(dir,{recursive:true});
 let prior;
 try{prior=JSON.parse(await readFile(dir+'/inventory.json','utf8'));assert.equal(prior.origin,origin);assert.equal(prior.profiles.length,0,'One-use fixture inventory already exists; refusing another four profiles');assert.ok(!prior.creationCompletedAt);}catch(e){if(e.code!=='ENOENT')throw e;}
 const state=prior||{origin,namespace:'TEMP_PHASE03_'+randomUUID().replaceAll('-',''),profiles:[],data:[],snapshots:[],cleanup:false};
 const persist=()=>writeFile(dir+'/inventory.json',JSON.stringify(state,null,2));
 await persist();
 const sql=(query,target=pg,db=database)=>docker(['exec','-i',target,'psql','-U','uasspain','-d',db,'-At','-v','ON_ERROR_STOP=1'],query).trim();
 const schema=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('table',c.relname,'pk',(SELECT jsonb_agg(a.attname ORDER BY k.n) FROM pg_constraint p CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=p.conrelid AND a.attnum=k.attnum WHERE p.conrelid=c.oid AND p.contype='p'))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`));
 assert.ok(schema.length>0&&schema.every(t=>t.pk?.length),'Every protected table needs a primary key');
 const snapshot=(target=pg,db=database)=>sql(schema.map(t=>`SELECT jsonb_build_object('table',${q(t.table)},'rows',COALESCE(jsonb_agg(jsonb_build_object('key',jsonb_build_array(${t.pk.map(k=>'t.'+ident(k)).join(',')}),'hash',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) ORDER BY ${t.pk.map(k=>'t.'+ident(k)).join(',')}),'[]'::jsonb)) FROM public.${ident(t.table)} t;`).join('\n'),target,db).split('\n').map(JSON.parse).sort((a,b)=>a.table.localeCompare(b.table));
 const keyEncoded=docker(['exec',backend,'sh','-c','if [ -n "$FIELD_ENCRYPTION_KEY_FILE" ]; then cat "$FIELD_ENCRYPTION_KEY_FILE"; else printf "%s" "$FIELD_ENCRYPTION_KEY"; fi']).trim();
 const key=Buffer.from(keyEncoded,'base64url');assert.equal(key.length,32);
 const backupKey=createHash('sha256').update(key).update('|uasspain|backup-encryption|v2').digest();
 const baseline=snapshot();await writeFile(dir+'/before-fingerprints.json',JSON.stringify(baseline,null,2));
 // Full custom-format pg_dump, AES-GCM encrypted with the application's backup
 // derivation. Verification decrypts the saved artifact and restores an isolated
 // network-less container, then compares every row of every public table.
 const dump=docker(['exec',pg,'pg_dump','-U','uasspain','-d',database,'-Fc','--no-owner','--no-privileges'],undefined,true);
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',backupKey,nonce);
 const encrypted=Buffer.concat([nonce,cipher.update(dump),cipher.final(),cipher.getAuthTag()]);
 await writeFile(dir+'/pre-test-snapshot.enc',encrypted);
 const saved=await readFile(dir+'/pre-test-snapshot.enc'),decipher=createDecipheriv('aes-256-gcm',backupKey,saved.subarray(0,12));decipher.setAuthTag(saved.subarray(-16));
 const restored=Buffer.concat([decipher.update(saved.subarray(12,-16)),decipher.final()]);assert.equal(hash(restored),hash(dump));
 const verifier='uasspain-phase03-snapshot-'+randomUUID().replaceAll('-','');
 const pgInfo=JSON.parse(docker(['inspect',pg]))[0];
 const platform=pgInfo.ImageManifestDescriptor?.platform;
 const platformArgs=platform?['--platform',[platform.os,platform.architecture,platform.variant].filter(Boolean).join('/')]:[];
 const pgImage=pgInfo.Config.Image;
 const storedImage=JSON.parse(docker(['image','inspect',...platformArgs,pgImage]))[0];
 assert.equal(pgInfo.ImageManifestDescriptor?.digest||pgInfo.Image,storedImage.Descriptor?.digest||storedImage.Id,'Verifier uses the running PostgreSQL image');
 let verifierCreated=false;
 try{
  docker(['run','-d',...platformArgs,'--name',verifier,'--label','io.uasspain.phase03.snapshot='+state.namespace,'--network','none','--read-only','--user','postgres','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,mode=1777','--tmpfs','/var/run/postgresql:rw,mode=1777','--tmpfs','/var/lib/postgresql:rw,mode=1777','--env','PGDATA=/tmp/pgdata','--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_USER=uasspain','--env','POSTGRES_DB=snapshot','--entrypoint','docker-entrypoint.sh',pgImage,'postgres']);verifierCreated=true;
  let ready=false;for(let n=0;n<60;n++){try{assert.ok(docker(['logs',verifier]).includes('PostgreSQL init process complete'));assert.equal(sql('SELECT 1;',verifier,'snapshot'),'1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}assert.ok(ready,'Isolated snapshot verifier initialized and ready');
  docker(['exec','-i',verifier,'pg_restore','-U','uasspain','-d','snapshot','--exit-on-error','--no-owner','--no-privileges'],restored);
  assert.deepEqual(snapshot(verifier,'snapshot'),baseline,'Restored backup exactly matches all pre-existing records');
  state.backup={createdAt:new Date().toISOString(),file:'pre-test-snapshot.enc',encrypted:true,sha256:hash(saved),plainSha256:hash(dump),restoreVerified:true,tables:baseline.length,rows:baseline.reduce((n,t)=>n+t.rows.length,0)};await persist();
 }finally{
  if(verifierCreated){const inspected=JSON.parse(docker(['inspect',verifier]))[0];assert.equal(inspected.Config.Labels['io.uasspain.phase03.snapshot'],state.namespace);assert.equal(inspected.HostConfig.NetworkMode,'none');assert.equal(inspected.Mounts.filter(m=>m.Type==='volume'||m.Type==='bind').length,0);docker(['rm','-f',verifier]);}
  dump.fill(0);restored.fill(0);backupKey.fill(0);
 }
 assert.deepEqual(snapshot(),baseline,'Original records unchanged before fixture creation');
 const blindKey=createHash('sha256').update(key).update('|blind-index|v1').digest();
 const encrypt=value=>{if(!value)return '';const n=randomBytes(12),c=createCipheriv('aes-256-gcm',key,n);return 'v1:'+Buffer.concat([n,c.update(value),c.final(),c.getAuthTag()]).toString('base64').replaceAll('+','-').replaceAll('/','_');};
 const blind=value=>createHmac('sha256',blindKey).update(value).digest('hex');
 const fixtures=Array.from({length:4},(_,i)=>({id:randomUUID(),email:state.namespace.toLowerCase()+'-'+i+'@example.invalid',password:'Aa9!'+randomBytes(20).toString('hex'),name:state.namespace+' '+i,role:i<2?'instructor':'alumno'}));
 state.profiles=fixtures.map(({id,email,name,role})=>({id,email,name,role}));await persist();
 try{
  const statements=fixtures.map((f,i)=>{
   const salt=randomBytes(16).toString('hex'),passwordHash='pbkdf2_sha256$600000$'+salt+'$'+pbkdf2Sync(f.password,salt,600000,32,'sha256').toString('base64');
   return `WITH u AS (INSERT INTO auth_user(password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined) VALUES (${q(passwordHash)},NULL,FALSE,${q('temp-phase03-'+f.id)},'','',${q(f.email)},FALSE,TRUE,NOW()) RETURNING id) INSERT INTO accounts_userprofile(id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_hash,session_role,assigned_instructor_id) SELECT ${q(f.id)}::uuid,NOW(),NOW(),${q(encrypt(state.namespace))},${q(encrypt(String(i)))},${q(encrypt(f.email))},${q(encrypt(f.email))},${q(encrypt('TEMP-'+f.id))},'','activo',${q(f.role)},'',TRUE,u.id,${q(JSON.stringify([f.role]))}::jsonb,${q(blind(f.email))},${q(blind(f.email))},${q(blind(('TEMP-'+f.id).toUpperCase()))},'','','','',${i>=2?q(fixtures[0].id)+'::uuid':'NULL'} FROM u;`;
  });
  sql('BEGIN;\n'+statements.join('\n')+'\nCOMMIT;');
  for(const f of fixtures){f.userId=Number(sql(`SELECT user_id FROM accounts_userprofile WHERE id=${q(f.id)}::uuid`));assert.ok(Number.isInteger(f.userId)&&f.userId>0);state.profiles.find(p=>p.id===f.id).userId=f.userId;}
  state.creationCompletedAt=new Date().toISOString();await persist();
 }finally{key.fill(0);blindKey.fill(0);}
 const beforeMap=new Map(baseline.map(t=>[t.table,new Map(t.rows.map(r=>[JSON.stringify(r.key),r.hash]))]));
 const profileIds=new Set(fixtures.map(f=>f.id)),userIds=new Set(fixtures.map(f=>f.userId));
 const allowed={accounts_userprofile:['user_id','assigned_instructor_id'],auth_user:[],conexiones_mensaje:['alumno_id','instructor_id'],conexiones_mensajestaff:['remitente_id','destinatario_id'],conexiones_registroconexion:['profile_id'],conexiones_videollamada:['alumno_id','instructor_id','instructor_peer_id','administrador_id','iniciador_id','moderador_id'],conexiones_conexion:['alumno_id','instructor_id']};
 async function inventory(){
  const current=snapshot(),owned=[];let modified=0,deleted=0;
  for(const t of current){const previous=beforeMap.get(t.table),now=new Map(t.rows.map(r=>[JSON.stringify(r.key),r.hash]));for(const [id,h] of previous){if(!now.has(id))deleted++;else if(now.get(id)!==h)modified++;}
   for(const row of t.rows.filter(r=>!previous.has(JSON.stringify(r.key)))){
    assert.ok(Object.hasOwn(allowed,t.table),'Unproven new table: '+t.table);assert.equal(row.key.length,1);const id=row.key[0];
    const metadata=JSON.parse(sql(`SELECT jsonb_build_object('id',id${allowed[t.table].map(c=>','+q(c)+','+ident(c)).join('')}) FROM ${ident(t.table)} WHERE id::text=${q(id)}`));
    if(t.table==='accounts_userprofile'){assert.ok(profileIds.has(id)&&userIds.has(metadata.user_id));}
    else if(t.table==='auth_user')assert.ok(userIds.has(id));
    else assert.ok(allowed[t.table].some(c=>metadata[c]!=null)&&allowed[t.table].every(c=>metadata[c]==null||profileIds.has(metadata[c])),'All participants must belong to the four profiles: '+t.table);
    if(metadata.assigned_instructor_id!=null)assert.ok(profileIds.has(metadata.assigned_instructor_id));
    owned.push({table:t.table,id,ownership:metadata});
   }
  }
  state.realUserDataModified=modified;state.realUserDataDeleted=deleted;state.data=owned;state.snapshots.push({at:new Date().toISOString(),records:owned.length,modified,deleted});await persist();return {current,owned};
 }
 await inventory();
 return {fixtures,state,async cleanup(){
  const {owned}=await inventory();
  // Lock every public table while rechecking the snapshot and ownership inside
  // the same transaction. Explicit IDs only; no namespace/date/pattern deletes.
  const lines=['BEGIN;','LOCK TABLE '+schema.map(t=>'public.'+ident(t.table)).join(',')+' IN SHARE ROW EXCLUSIVE MODE;'];
  for(const record of owned){const cols=Object.keys(record.ownership);lines.push(`DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM ${ident(record.table)} WHERE ${cols.map(c=>record.ownership[c]==null?ident(c)+' IS NULL':ident(c)+'::text='+q(record.ownership[c])).join(' AND ')}) THEN RAISE EXCEPTION 'Temporary ownership changed'; END IF; END $guard$;`);}
  const incoming=JSON.parse(sql(`SELECT COALESCE(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'column',a.attname,'target',c.confrelid::regclass::text)),'[]') FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] WHERE c.contype='f' AND c.confrelid IN ('accounts_userprofile'::regclass,'auth_user'::regclass)`));
  for(const ref of incoming){const ids=ref.target==='auth_user'?[...userIds]:[...profileIds],expected=owned.filter(r=>r.table===ref.table).map(r=>r.id);lines.push(`DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM ${ident(ref.table)} WHERE ${ident(ref.column)}::text IN (${ids.map(q).join(',')}) AND id::text NOT IN (${expected.length?expected.map(q).join(','):q('no-owned-record')})) THEN RAISE EXCEPTION 'Foreign record references temporary identity'; END IF; END $guard$;`);}
  for(const table of ['conexiones_mensaje','conexiones_mensajestaff','conexiones_registroconexion','conexiones_videollamada','conexiones_conexion','accounts_userprofile','auth_user'])for(const record of owned.filter(r=>r.table===table))lines.push(`DELETE FROM ${ident(table)} WHERE id::text=${q(record.id)};`);
  // Existing row hashes are checked before committing, so cascading changes to
  // any pre-existing row abort the entire cleanup transaction.
  for(const t of baseline)for(const r of t.rows)lines.push(`DO $guard$ BEGIN IF NOT EXISTS (SELECT 1 FROM ${ident(t.table)} t WHERE ${schema.find(s=>s.table===t.table).pk.map((k,i)=>'t.'+ident(k)+'::text='+q(r.key[i])).join(' AND ')} AND encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')=${q(r.hash)}) THEN RAISE EXCEPTION 'Pre-existing record changed'; END IF; END $guard$;`);
  lines.push('COMMIT;');sql(lines.join('\n'));
  const after=snapshot();await writeFile(dir+'/after-fingerprints.json',JSON.stringify(after,null,2));assert.deepEqual(after,baseline,'Every pre-existing row is unchanged; no extra row remains');
  state.deletedData=owned;state.data=[];state.cleanup=true;state.tempDataResidue=0;state.realUserDataModified=0;state.realUserDataDeleted=0;state.cleanedAt=new Date().toISOString();await persist();fixtures.forEach(f=>{f.password='';});
 }};
}
