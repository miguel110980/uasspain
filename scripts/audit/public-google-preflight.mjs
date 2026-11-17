/** Reproduce only the known origin rejection, before flow creation or credentials. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { rootCertificates, checkServerIdentity } from 'node:tls';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),origin='https://uasspain-prueba.duckdns.org';
const c=JSON.parse(execFileSync('docker',['inspect','uasspain-backend'],{encoding:'utf8',windowsHide:true}))[0];
const all=Object.fromEntries(c.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
const actual=all.GOOGLE_OAUTH_PUBLIC_ORIGIN||all.FRONTEND_URL;
assert.equal(actual,'https://localhost','Do not run a negative request if the origin is already changed');
const query="SELECT json_build_object('flows',(SELECT count(*) FROM google_oauth_flow),'events',(SELECT count(*) FROM google_oauth_event),'audit',(SELECT count(*) FROM core_auditlog))";
const counts=()=>JSON.parse(execFileSync('docker',['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',windowsHide:true}));
const before=counts(),payload=Buffer.from('{}');
const response=await new Promise((resolve,reject)=>{
 const r=https.request({hostname:'127.0.0.1',port:443,servername:'uasspain-prueba.duckdns.org',path:'/api/auth/google/oauth/start/',method:'POST',ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity('uasspain-prueba.duckdns.org',cert),headers:{Host:'uasspain-prueba.duckdns.org',Origin:origin,'Content-Type':'application/json','Content-Length':payload.length}},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>{let body;try{body=JSON.parse(text)}catch{body=null}resolve({http:s.statusCode,detail:body?.detail||body?.message||null})})});r.setTimeout(10000,()=>r.destroy());r.on('error',()=>reject(Error('Public-SNI probe transport failed')));r.end(payload);
});
const after=counts();
const report={observed_at:new Date().toISOString(),status:'BLOCKED',scope:'Public-origin Google start on ORIGINAL using local public-SNI socket; known guard executes before context/authentication/SQL. No credentials, real provider or cross-network claim.',public_origin:origin,configured_google_origin:actual,verified_public_transport_origin:all.GOOGLE_OAUTH_VERIFIED_PUBLIC_ORIGIN||'',response,oauth_flow_and_audit_counts_unchanged:JSON.stringify(before)===JSON.stringify(after),functional_public_google:'FAIL_CONFIGURATION: canonical origin remains localhost; local OAuth PASS retained in historical scope',root_cause:'google_oauth.rs rejects Origin different from trusted_origin before creating an authorization flow',configuration_changes:0};
assert.equal(response.http,400);assert.equal(report.oauth_flow_and_audit_counts_unchanged,true);
writeFileSync(resolve(root,'docs/audits/evidence/2026-11-16-public-google-preflight.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
