/** Ordered server-side checks only; never substitutes them for external-client evidence. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {Resolver} from 'node:dns/promises';
import https from 'node:https';
import {rootCertificates,checkServerIdentity} from 'node:tls';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),host='uasspain-prueba.duckdns.org';
const report={observed_at:new Date().toISOString(),scope:'ORIGINAL: configured service healthchecks executed inside all five containers; HTTPS and essential assets through own LAN address. No external-network or second-device claim.',checks:[],containers:[],external_access:'FAIL_LATEST_OWNER_LAPTOP_TEST',configuration_changes:0};
const check=(id,ok,observed)=>report.checks.push({id,status:ok?'PASS':'FAIL',observed});
for(const service of ['postgres','redis','backend','frontend','nginx']){
 const c=JSON.parse(execFileSync('docker',['inspect','uasspain-'+service],{encoding:'utf8',windowsHide:true}))[0];assert.equal(c.Config.Labels['com.docker.compose.project'],'uasspain');
 const command=c.Config.Healthcheck.Test;assert.ok(['CMD','CMD-SHELL'].includes(command[0]));
 const args=command[0]==='CMD'?command.slice(1):['sh','-c',command[1]];
 const r=spawnSync('docker',['exec',c.Id,...args],{encoding:'utf8',windowsHide:true,timeout:20000});
 check('IN_CONTAINER_HEALTH:'+service,r.status===0,{exit:r.status,stdout_withheld:true});
 const ports=Object.entries(c.NetworkSettings.Ports||{}).filter(([,bindings])=>bindings?.length).map(([port,bindings])=>({port,bindings}));
 report.containers.push({service,id:c.Id,state:c.State.Status,health:c.State.Health?.Status,host_bindings:ports});
 check('PRIVATE_PORTS:'+service,service==='nginx'?ports.every(p=>p.bindings.every(b=>b.HostIp==='127.0.0.1'&&['80','443'].includes(b.HostPort))):ports.length===0,{scope:'Docker host publishing only; router and external checks are separate'});
}
async function get(path){return await new Promise(resolve=>{
 const r=https.get({hostname:'192.168.1.34',port:443,servername:host,path,headers:{Host:host},ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(host,cert)},s=>{const authorized=s.socket.authorized;const chunks=[];s.on('data',b=>chunks.push(b));s.on('end',()=>resolve({http:s.statusCode,authorized,type:s.headers['content-type'],bytes:Buffer.concat(chunks),tls_bypass:false}))});r.setTimeout(12000,()=>r.destroy());r.on('error',error=>resolve({http:null,error:error.code,tls_bypass:false}));
})}
const page=await get('/');check('SERVER_LAN_HTTPS_HTML',page.http===200&&page.authorized&&page.bytes.length>100,{http:page.http,authorized:page.authorized,bytes:page.bytes?.length,tls_bypass:false,second_device:false});
if(page.http===200){
 // The deployed Home prerender embeds its compiled CSS in style[data-stylesheet].
 const paths=[...page.bytes.toString('utf8').matchAll(/(?:src|href|data-stylesheet)=["'](\/assets\/[^"'<>]+\.(?:js|css))["']/g)].map(m=>m[1]);
 const assets=[...new Set(paths)].slice(0,4);check('ESSENTIAL_ASSET_REFERENCES',assets.some(p=>p.endsWith('.js'))&&assets.some(p=>p.endsWith('.css')),{paths:assets});
 for(const path of assets){const asset=await get(path);check('ESSENTIAL_ASSET:'+path,asset.http===200&&asset.authorized&&asset.bytes.length>20,{http:asset.http,bytes:asset.bytes?.length,type:asset.type,tls_bypass:false})}
}
const denied=await get('/api/profiles/');check('ANONYMOUS_PRIVATE_API_DENIED',denied.http===401&&denied.authorized,{http:denied.http});
const dns=new Resolver({timeout:5000,tries:1});dns.setServers(['1.1.1.1']);
try{const addresses=await dns.resolve6(host);report.ipv6_dns={status:'PASS',aaaa_count:addresses.length,limit:'Addresses are inventory, not a successful IPv6 connection'}}catch(error){report.ipv6_dns={status:['ENODATA','ENOTFOUND'].includes(error.code)?'PASS':'BLOCKED',aaaa_count:['ENODATA','ENOTFOUND'].includes(error.code)?0:null,reason:error.code}}
report.status=report.checks.every(c=>c.status==='PASS')?'PASS_SCOPED_SERVER_ONLY':'FAIL';
writeFileSync(resolve(root,'docs/audits/evidence/2026-11-16-network-server-live.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.checks.filter(x=>x.status==='FAIL').map(x=>x.id),ipv6:report.ipv6_dns}));if(report.status==='FAIL')process.exitCode=1;
