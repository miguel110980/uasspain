import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export const project='uasspain-mail-audit-closure-630870e0';
export const fixtureOwner='closure-20261109-630870e0';
export const lab=resolve('.run/closure-20261109-630870e0');
export const work=resolve('.run/four-issues-20261117');
export const origin='http://127.0.0.1:18010';
export function run(file,args,options={}) {
  try { return execFileSync(file,args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:16*1024*1024,...options}).trim(); }
  catch { throw new Error('Isolated operation failed; sensitive child output withheld'); }
}
export function loadProtected(file,entropy) {
  return JSON.parse(run('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Security;$b=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${file.replaceAll("'","''")}'),[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Write([Text.Encoding]::UTF8.GetString($b))}finally{[Array]::Clear($b,0,$b.Length)}`]));
}
export function saveProtected(file,entropy,value) {
  run('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.Security;$b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());try{$p=[Security.Cryptography.ProtectedData]::Protect($b,[Text.Encoding]::UTF8.GetBytes('${entropy}'),[Security.Cryptography.DataProtectionScope]::CurrentUser);[IO.File]::WriteAllBytes('${file.replaceAll("'","''")}', $p)}finally{[Array]::Clear($b,0,$b.Length)}`],{input:JSON.stringify(value)});
}
export const env=loadProtected(resolve(lab,'api-lab.dpapi'),'UASSpain|closure20261109|630870e0');
export const docker=(args)=>run('docker',args,{env:{...process.env,...env}});
export const inspect=name=>JSON.parse(docker(['inspect',name]))[0];
export const sql=query=>run('docker',['exec','--env','PGPASSWORD',`${project}-postgres-e2e-1`,'psql','-X','-U','uasspain','-d','test_e2e_uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',query],{env:{...process.env,PGPASSWORD:env.CLOSURE_DB_PASSWORD}});
export function verifyLabIdentity() {
  for(const service of ['postgres-e2e','backend-e2e','web-e2e']) {
    const container=inspect(`${project}-${service}-1`);
    assert.equal(container.Config.Labels['com.docker.compose.project'],project);
    assert.equal(container.Config.Labels['uasspain.fixture'],fixtureOwner);
    assert.ok(!container.Mounts.some(m=>m.Type==='volume'),'Production data volumes prohibited in this lab');
    for(const mount of container.Mounts.filter(m=>m.Type==='bind')) {
      const source=mount.Source.replaceAll('\\','/');
      assert.ok(source.startsWith(lab.replaceAll('\\','/')+'/') || source.endsWith('/scripts/e2e/backup-roles.sql') && !mount.RW,'Unrecognized fixture bind');
    }
  }
}
export function originalFingerprint() {
  return docker(['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',"SELECT md5(string_agg(row_to_json(p)::text || u.password || u.is_active::text,'' ORDER BY p.id)) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id"]);
}
export function client() {
  const cookies=new Map(),windowId=randomUUID();
  return {windowId,get socketOptions(){return {origin,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},handshakeTimeout:10000};},async call(path,method='GET',data) {
    assert.ok(path.startsWith('/api/'));
    const response=await fetch(origin+path,{method,headers:{Origin:origin,'X-UASSpain-Window-Id':windowId,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...(!(data instanceof FormData)?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:data instanceof FormData?data:JSON.stringify(data)});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
    let body=null;try{body=await response.json();}catch{}
    return {status:response.status,body};
  }};
}
export async function login(actor,email,password) {
  assert.equal((await actor.call('/api/auth/context/','POST',{})).status,200);
  assert.equal((await actor.call('/api/auth/login/','POST',{email,password})).status,200);
}
