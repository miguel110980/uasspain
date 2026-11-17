/** Read-only guard checks after runtime origin update; no valid window or credentials. */
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import https from 'node:https';
import {rootCertificates,checkServerIdentity} from 'node:tls';
const host='uasspain-prueba.duckdns.org',origin='https://'+host;
const verified=process.argv.includes('--verified');
const sql=()=>JSON.parse(execFileSync('docker',['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',"SELECT json_build_object('flows',(SELECT count(*) FROM google_oauth_flow),'events',(SELECT count(*) FROM google_oauth_event),'audit',(SELECT count(*) FROM core_auditlog))"],{encoding:'utf8',windowsHide:true}));
async function request(path,requestOrigin){return new Promise((resolve,reject)=>{
 const body=Buffer.from('{}');const req=https.request({hostname:'127.0.0.1',servername:host,path,method:requestOrigin?'POST':'GET',headers:{Host:host,...(requestOrigin?{Origin:requestOrigin,'Content-Type':'application/json','Content-Length':body.length}:{})},ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(host,cert)},res=>{let text='';const authorized=res.socket.authorized;res.on('data',b=>text+=b);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json=null}resolve({http:res.statusCode,authorized,body:json})});});req.setTimeout(12000,()=>req.destroy(Error('Timeout')));req.on('error',reject);req.end(requestOrigin?body:undefined);
});}
const report={observed_at:new Date().toISOString(),scope:'ORIGINAL deployed backend, loopback socket with public SNI. Guard progression only, no provider login or independent WAN claim',checks:[],configuration_writes:0};
const check=(id,ok,observed)=>report.checks.push({id,status:ok?'PASS':'FAIL',observed});const before=sql();
const correct=await request('/api/auth/google/oauth/start/',origin);check('PUBLIC_ORIGIN_ACCEPTED_WINDOW_STILL_REQUIRED',correct.authorized&&correct.http===401&&correct.body?.code==='session_window_mismatch',{http:correct.http,body:correct.body});
const wrong=await request('/api/auth/google/oauth/start/','https://localhost');check('OTHER_ORIGIN_REMAINS_DENIED',wrong.authorized&&wrong.http===400,{http:wrong.http,body:wrong.body});
const config=await request('/api/public/oauth/google/');check(verified?'LOGIN_ENABLED_AFTER_REAL_VERIFICATION':'LOGIN_NOT_ENABLED_BEFORE_NEW_VERIFICATION',config.authorized&&config.http===200&&config.body?.configured===verified,{http:config.http,configured:config.body?.configured});
const unchanged=JSON.stringify(before)===JSON.stringify(sql());check('NO_FLOW_EVENT_AUDIT_WRITES',unchanged,{counts_unchanged:unchanged});
report.status=report.checks.every(x=>x.status==='PASS')?'PASS_SCOPED_GUARDS_ONLY':'FAIL';writeFileSync('docs/audits/evidence/2026-11-16-google-public-guards'+(verified?'-verified':'')+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status==='FAIL')process.exitCode=1;
