import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const volumes=['uasspain_postgres_data','uasspain_postgres_varlib','uasspain-rebuild-20261003_postgres_data','uasspain-rebuild-20261003_postgres_varlib'];
const destination=resolve(root,'.run/uasspain/retired-postgres');mkdirSync(destination,{recursive:true});
function run(program,args,input,maxBuffer=256*1024*1024) {
  const r=spawnSync(program,args,{cwd:root,input,maxBuffer});
  if(r.status!==0||r.error) throw Error(`Archive operation failed (${program}, ${args.includes('tar')?'tar':args.includes('pg_ctl')?'pg_ctl':args[0]}, exit ${r.status}); sensitive output withheld`);
  return r.stdout;
}
const docker=(args,input)=>run('docker',args,input);
const shell=command=>docker(['exec','uasspain-postgres','sh','-c',command]).toString().trim();
const sha=b=>createHash('sha256').update(b).digest('hex');
// DPAPI output is a private child-process pipe, captured in RAM only.
// No plaintext key file, environment variable, CLI value or console output.
const dpapi=`Add-Type -AssemblyName System.Security; $key=$null; try { $key=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('.secrets/postgres-storage-key.dpapi'),[Text.Encoding]::UTF8.GetBytes('UASSpain|PostgreSQL-storage|v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::OpenStandardOutput().Write($key,0,$key.Length) } finally { if($null -ne $key){[Array]::Clear($key,0,$key.Length)} }`;
const master=run('powershell',['-NoProfile','-NonInteractive','-Command',dpapi],undefined,4096);
assert.equal(master.length,32);
const key=createHash('sha256').update(master).update('|postgres-volume-archive|v1').digest();
const decrypt=buffer=>{
  const d=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));d.setAuthTag(buffer.subarray(-16));
  return Buffer.concat([d.update(buffer.subarray(12,-16)),d.final()]);
};
const checkRoot='/var/lib/postgresql/data/rollback-physical-check';
const socket='/tmp/postgres-archive-check';
let checkCreated=false,checkStarted=false;
try {
  const image=JSON.parse(docker(['inspect','uasspain-postgres']).toString())[0].Image;
  assert.equal(shell('findmnt -n -o FSTYPE --mountpoint /var/lib/postgresql/data'),'fuse.gocryptfs');
  assert.equal(shell('cat /proc/swaps').split('\n').filter(Boolean).length,1,'Swap must be disabled');
  const records=[];
  for(const volume of volumes) {
    assert.equal(docker(['ps','-a','--filter',`volume=${volume}`,'--format','{{.Names}}']).toString().trim(),'','Retired volume still attached');
    const encryptedPath=resolve(destination,`${volume}.tar.enc`);
    const manifestPath=resolve(destination,`${volume}.json`);
    if(!existsSync(encryptedPath)) {
      assert.ok(!existsSync(manifestPath),'Incomplete archive already exists');
      const data=docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--user','postgres','-v',`${volume}:/source:ro`,'--entrypoint','tar',image,'-C','/source','-cf','-','.']);
      const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);
      const encrypted=Buffer.concat([nonce,c.update(data),c.final(),c.getAuthTag()]);
      assert.equal(sha(decrypt(encrypted)),sha(data));
      writeFileSync(encryptedPath,encrypted);
      writeFileSync(manifestPath,JSON.stringify({volume,format:'tar+AES-256-GCM',key_protection:'DPAPI-CurrentUser',plaintext_sha256:sha(data),encrypted_sha256:sha(encrypted),bytes:encrypted.length,created_utc:new Date().toISOString()},null,2));
      data.fill(0);
    }
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
    assert.equal(manifest.volume,volume);
    const encrypted=readFileSync(encryptedPath);
    assert.equal(sha(encrypted),manifest.encrypted_sha256);
    const data=decrypt(encrypted);assert.equal(sha(data),manifest.plaintext_sha256);data.fill(0);
    records.push({volume,encrypted_sha256:manifest.encrypted_sha256,authenticated_roundtrip:true});
  }
  // Physical restore and actual PostgreSQL startup, inside the encrypted mount.
  assert.equal(shell(`test ! -e ${checkRoot} && echo absent`),'absent');
  shell(`mkdir ${checkRoot} ${socket} && chown postgres:postgres ${checkRoot} ${socket}`);checkCreated=true;
  const archive=decrypt(readFileSync(resolve(destination,'uasspain_postgres_data.tar.enc')));
  docker(['exec','-i','-u','postgres','uasspain-postgres','tar','--no-same-owner','-C',checkRoot,'-xpf','-'],archive);archive.fill(0);
  // A physical snapshot may retain the old container's PID. The same numeric
  // PID can belong to the active postmaster in this namespace. Remove it only
  // from this freshly restored, isolated copy, never from the live PGDATA.
  docker(['exec','-u','postgres','uasspain-postgres','rm','-f',`${checkRoot}/pgdata/postmaster.pid`]);
  docker(['exec','-u','postgres','uasspain-postgres','pg_ctl','-D',`${checkRoot}/pgdata`,'-l',`${checkRoot}/recovery.log`,'-o',`-p 55432 -c listen_addresses='' -c unix_socket_directories=${socket} -c shared_buffers=16MB -c ssl=off -c logging_collector=on -c log_directory=log`,'-w','-t','30','start']);checkStarted=true;
  const query="SELECT json_build_object('users',(SELECT count(*) FROM auth_user),'profiles',(SELECT count(*) FROM accounts_userprofile),'migrations',(SELECT count(*) FROM _sqlx_migrations WHERE success))";
  const state=JSON.parse(docker(['exec','uasspain-postgres','psql','-X','-h',socket,'-p','55432','-U','uasspain','-d','uasspain','-At','-c',query]).toString());
  assert.deepEqual(state,{users:1,profiles:1,migrations:7});
  const identity='SELECT json_agg(json_build_array(p.id,u.password,p.nombre,p.apellidos,p.email,p.username,p.dni_nie,p.fecha_nacimiento) ORDER BY p.id) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id';
  const recovered=docker(['exec','uasspain-postgres','psql','-X','-h',socket,'-p','55432','-U','uasspain','-d','uasspain','-At','-c',identity]);
  const active=docker(['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-At','-c',identity]);
  assert.equal(sha(recovered),sha(active),'Physical rollback administrator differs');
  writeFileSync(resolve(destination,'verification.json'),JSON.stringify({verified_utc:new Date().toISOString(),records,physical_restore_postgres_started:true,administrator_preserved:true,state},null,2));
  console.log(JSON.stringify({encrypted_archives:records.length,physical_restore_postgres_started:true,administrator_preserved:true}));
} catch(error) {
  console.error(`Archive verification failed: ${error.message.split('\n')[0]}`);process.exitCode=1;
  if(checkCreated&&!checkStarted) {
    const startup=spawnSync('docker',['exec','uasspain-postgres','tail','-n','12',`${checkRoot}/recovery.log`],{cwd:root});
    const safeLines=startup.stdout.toString().split('\n').filter(line=>/FATAL:|PANIC:|Permission denied|could not/.test(line));
    for(const line of safeLines) console.error(line);
  }
} finally {
  if(checkStarted) docker(['exec','-u','postgres','uasspain-postgres','pg_ctl','-D',`${checkRoot}/pgdata`,'-m','fast','-w','stop']);
  if(checkCreated) shell(`test '${checkRoot}' != /var/lib/postgresql/data/pgdata && rm -rf '${checkRoot}' '${socket}'`);
  master.fill(0);key.fill(0);
}
