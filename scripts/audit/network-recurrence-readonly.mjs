/** Read-only recurrence diagnostic; preserves all 16 November evidence. */
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Resolver,lookup} from 'node:dns/promises';
import https from 'node:https';
import {rootCertificates,checkServerIdentity} from 'node:tls';
const host='uasspain-prueba.duckdns.org',lan='192.168.1.34';
const after=process.argv.includes('--after');
const direct=process.argv.includes('--direct'),afterRestart=process.argv.includes('--after-restart');
const rollbackCheck=process.argv.includes('--rollback-check');
const report={observed_at:new Date().toISOString(),scope:'ORIGINAL read-only diagnosis after owner reports connection failure everywhere on 17 November; local sockets do not certify WAN',changes_performed:0,external_access:'FAIL_OWNER_REPORTED_BEFORE_REPAIR',checks:[]};
if(rollbackCheck)report.external_access='NOT_RUN_AFTER_UAC_ROLLBACK';
const check=(id,ok,observed)=>report.checks.push({id,status:ok?'PASS':'FAIL',observed});
const current=[];
for(const service of ['nginx','frontend','backend','postgres','redis']){const c=JSON.parse(execFileSync('docker',['inspect','uasspain-'+service],{encoding:'utf8',windowsHide:true}))[0];current.push({service,id:c.Id,image:c.Image});check('CONTAINER:'+service,c.Config.Labels['com.docker.compose.project']==='uasspain'&&c.State.Running&&c.State.Health?.Status==='healthy',{id:c.Id,image:c.Image,health:c.State.Health?.Status,started_at:c.State.StartedAt,host_bindings:c.HostConfig.PortBindings});if(direct){const bindings=Object.entries(c.HostConfig.PortBindings||{}).flatMap(([target,items])=>(items||[]).map(p=>`${p.HostIp}:${p.HostPort}->${target}`)).sort();const expected=service==='nginx'?['127.0.0.1:80->8080/tcp','127.0.0.1:443->8443/tcp','192.168.1.34:443->8443/tcp'].sort():[];check('EXACT_HOST_BINDINGS:'+service,JSON.stringify(bindings)===JSON.stringify(expected),{bindings,expected});}}
const proxy=execFileSync('netsh',['interface','portproxy','show','v4tov4'],{encoding:'utf8',windowsHide:true});check(direct?'NO_REDUNDANT_PORTPROXY':'STORED_PORTPROXY',direct?!/192\.168\.1\.34\s+443/.test(proxy):/192\.168\.1\.34\s+443\s+127\.0\.0\.1\s+443/.test(proxy),{expected:direct?'No Windows proxy for LAN443; Docker owns direct binding':'192.168.1.34:443 -> 127.0.0.1:443'});
if(direct){const baseline=JSON.parse(readFileSync('.run/audit-20261117/direct-https/apply/before.json','utf8'));check('OTHER_FOUR_CONTAINERS_UNCHANGED',current.filter(c=>c.service!=='nginx').every(c=>baseline.containers.some(b=>b.service===c.service&&b.id===c.id&&b.image===c.image)),{containers:current});report.external_access='NOT_RUN_AFTER_DIRECT_DOCKER_DEPLOYMENT';}
const listeners=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"ConvertTo-Json -InputObject @(Get-NetTCPConnection -State Listen -LocalPort 443 | Where-Object {$_.LocalAddress -in @('127.0.0.1','192.168.1.34')} | Select-Object LocalAddress,LocalPort,OwningProcess)"],{encoding:'utf8',windowsHide:true}));
check('LAN443_LISTENER',listeners.some(x=>x.LocalAddress===lan),{listeners});
async function get(address,path){return new Promise(resolve=>{
 const req=https.get({hostname:address,servername:host,path,headers:{Host:host},ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(host,cert)},res=>{const authorized=res.socket.authorized,protocol=res.socket.getProtocol(),fingerprint=res.socket.getPeerCertificate().fingerprint256;let bytes=0;res.on('data',x=>bytes+=x.length);res.on('end',()=>resolve({http:res.statusCode,authorized,protocol,bytes,fingerprint,tls_bypass:false}));});req.setTimeout(5000,()=>req.destroy(Object.assign(Error('timeout'),{code:'TIMEOUT'})));req.on('error',error=>resolve({error:error.code||error.name,tls_bypass:false}));
});}
for(const address of ['127.0.0.1',lan]){const results=await Promise.all(['/','/healthz','/readyz','/api/health/live/','/api/health/ready/','/api/profiles/'].map(async path=>({path,...await get(address,path)})));check('HTTPS:'+address,results.every(r=>r.authorized&&r.http===(r.path==='/api/profiles/'?401:200)&&r.bytes>0),{results});}
const dns=new Resolver({timeout:5000,tries:1});dns.setServers(['1.1.1.1']);const addresses=await dns.resolve4(host);report.public_dns_address_digests=addresses.map(x=>createHash('sha256').update(x).digest('hex'));report.system_lookup=await lookup(host,{all:true});
report.status=report.checks.every(x=>x.status==='PASS')?'PASS_SCOPED_LOCAL_ONLY':'FAIL';report.completed_at=new Date().toISOString();
writeFileSync('docs/audits/evidence/2026-11-17-'+(direct?'direct-https-live'+(afterRestart?'-after-restart':'-before-restart'):rollbackCheck?'direct-https-first-rollback-check':'network-recurrence'+(after?'-after':''))+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.checks.filter(x=>x.status==='FAIL').map(x=>x.id)}));if(report.status==='FAIL')process.exitCode=1;
