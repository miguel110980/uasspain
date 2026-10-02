import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const project=process.argv[2]||'uasspain';
const permitSwapForStaging=process.argv.includes('--staging-allow-swap');
if(!/^(uasspain|uasspain-rebuild-[a-z0-9_-]+)$/.test(project)) throw Error('Unexpected target');
const container=`${project}-postgres`;
function docker(args,input) {
  const r=spawnSync('docker',args,{cwd:root,input,maxBuffer:16*1024*1024});
  if(r.status!==0||r.error) throw Error('Storage verification Docker operation failed; output withheld');
  return r.stdout.toString().trim();
}
const shell=command=>docker(['exec',container,'sh','-c',command]);
const sql=query=>docker(['exec',container,'psql','-X','-U','uasspain','-d','uasspain','-At','-v','ON_ERROR_STOP=1','-c',query]);
try {
  const info=JSON.parse(docker(['inspect',container]))[0];
  assert.equal(info.HostConfig.Privileged,false);
  const volumes=info.Mounts.filter(m=>m.Type==='volume');
  assert.equal(volumes.length,1,'Only ciphertext may persist');
  assert.equal(volumes[0].Destination,'/encrypted-postgres');
  assert.ok(!info.Mounts.some(m=>m.Type==='bind'&&m.Destination.startsWith('/var/lib/postgresql')));
  assert.equal(shell('findmnt -n -o FSTYPE --mountpoint /var/lib/postgresql/data'),'fuse.gocryptfs');
  assert.equal(shell('findmnt -n -o FSTYPE --mountpoint /run/postgres-storage'),'tmpfs');
  assert.equal(shell('findmnt -n -o FSTYPE --mountpoint /tmp'),'tmpfs');
  assert.equal(shell('test ! -e /run/postgres-storage/unlock.key && echo clean'),'clean');
  const config=JSON.parse(shell('cat /encrypted-postgres/gocryptfs.conf'));
  for(const flag of ['GCMIV128','HKDF','EMENames','DirIV']) assert.ok(config.FeatureFlags.includes(flag));
  assert.ok(!config.FeatureFlags.some(f=>['PlaintextNames','AESSIV','XChaCha20Poly1305'].includes(f)));
  assert.ok(config.EncryptedKey.length>0);
  assert.equal(sql("SELECT current_setting('data_directory')='/var/lib/postgresql/data/pgdata' AND current_setting('logging_collector')='on' AND current_setting('log_directory')='log' AND current_setting('temp_tablespaces')='' AND (SELECT bool_and(pg_tablespace_location(oid)='') FROM pg_tablespace)"),'t');
  assert.equal(shell('readlink -f /var/lib/postgresql/data/pgdata/pg_wal'),'/var/lib/postgresql/data/pgdata/pg_wal');
  // CapEff read for the actual postmaster; SYS_ADMIN must never reach it.
  const status=shell('cat /proc/$(head -n 1 /var/lib/postgresql/data/pgdata/postmaster.pid)/status');
  const cap=BigInt(`0x${status.match(/^CapEff:\s*([0-9a-f]+)/m)[1]}`);
  assert.equal(cap,0n);
  const swaps=shell('cat /proc/swaps').split('\n').slice(1).filter(line=>line.trim());
  if(!permitSwapForStaging) assert.equal(swaps.length,0,'Unencrypted WSL swap must be disabled before activation');
  // Inspect raw persistent bytes in a separate container without FUSE/key.
  const raw=docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--user','postgres','-v',`${volumes[0].Name}:/cipher:ro`,'--entrypoint','sh','uasspain-postgres:encrypted','-c','test ! -e /cipher/pgdata && test ! -e /cipher/PG_VERSION && test ! -e /cipher/pg_wal && find /cipher -type f | wc -l']);
  assert.ok(Number(raw)>100,'Expected encrypted cluster files');
  const wrongKey="mkdir /tmp/plain; printf '%064d\\n' 0 > /tmp/wrong; gocryptfs -q -passfile /tmp/wrong /cipher /tmp/plain >/tmp/result 2>&1; result=$?; test \"$result\" -eq 12";
  docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--cap-add','SYS_ADMIN','--device','/dev/fuse','--tmpfs','/tmp','-v',`${volumes[0].Name}:/cipher:ro`,'--entrypoint','sh','uasspain-postgres:encrypted','-c',wrongKey]);
  const report={verified_utc:new Date().toISOString(),project,ciphertext_volume:volumes[0].Name,storage_encryption:'gocryptfs-AES-256-GCM',encrypted_names:true,pgdata_wal_temp_logs_covered:true,no_plaintext_persistent_mount:true,key_tmpfs_removed:true,postgres_capabilities_zero:true,raw_volume_unreadable_without_key:true,wrong_key_rejected:true,swap_disabled:swaps.length===0,activation_allowed:swaps.length===0};
  const artifact=resolve(root,'.run',project);mkdirSync(artifact,{recursive:true});
  writeFileSync(resolve(artifact,'storage-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} catch(error) {
  console.error(`Storage verification failed: ${error.message.split('\n')[0]}`);process.exitCode=1;
}
