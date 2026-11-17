/** Read-only public-SNI, local forwarding and DNS diagnostics; never a WAN PASS. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { lookup, Resolver } from 'node:dns/promises';
import https from 'node:https';
import { checkServerIdentity, rootCertificates } from 'node:tls';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),host='uasspain-prueba.duckdns.org';
const output=resolve(root,'docs/audits/evidence/2026-11-16-public-route.json');
const sha=v=>createHash('sha256').update(v).digest('hex');
const report={observed_at:new Date().toISOString(),target:'https://'+host,scope:'Authorized public hostname; local SNI over loopback and existing host forwarding only. No DNS/firewall/port/security/CA change, Tailscale or external backup operation',checks:[],external_access:'FAIL: owner reports timeout on mobile data with Wi-Fi and Tailscale disconnected',local_ca_action:'PRESERVED_BY_LATEST_USER_INSTRUCTION'};
const ownerProofPath=resolve(root,'docs/audits/evidence/2026-11-16-public-after-network.json');
const ownerBasicPass=existsSync(ownerProofPath)&&JSON.parse(readFileSync(ownerProofPath,'utf8').replace(/^\uFEFF/,'')).status==='PASS';
if(ownerBasicPass){report.external_access='PASS_BASIC_OWNER_CONFIRMED';report.external_evidence='2026-11-16-public-after-network.json';}
const gate=(id,ok,observed)=>report.checks.push({id,status:ok?'PASS':'FAIL',observed});
const files=['ca.crt','ca.key','edge.crt','edge.key','backend.crt','backend.key','frontend.crt','frontend.key','postgres.crt','postgres.key','redis.crt','redis.key'];
const tlsBefore=Object.fromEntries(files.map(file=>[file,sha(readFileSync(resolve(root,'.secrets/tls',file)))]));
const leaf=new X509Certificate(readFileSync(resolve(root,`.secrets/acme-duckdns-20261023/deployed/${host}.fullchain.pem`)));
gate('STORED_PUBLIC_LEAF_CURRENT_AND_MATCHES_HOST',!!leaf.checkHost(host)&&Date.parse(leaf.validFrom)<=Date.now()&&Date.now()<Date.parse(leaf.validTo)&&!leaf.ca,{host,issuer:leaf.issuer,valid_from:leaf.validFrom,valid_to:leaf.validTo,fingerprint:leaf.fingerprint256});
const addresses=await lookup(host,{all:true});
report.local_name_resolution={has_private_ipv4:addresses.some(x=>x.family===4&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)),address_count:addresses.length,scope:'OS lookup includes local hosts; not public DNS proof'};
const resolver=new Resolver({timeout:5000,tries:1});resolver.setServers(['1.1.1.1']);
let publicAddresses=[];try{publicAddresses=await resolver.resolve4(host);report.public_dns={status:'PASS',ipv4_count:publicAddresses.length,address_digests:publicAddresses.map(sha),differs_from_local_lookup:publicAddresses.some(ip=>!addresses.some(x=>x.address===ip))}}catch(error){report.public_dns={status:'BLOCKED',reason:error.code}}
// Only owned local addresses are eligible for the second socket destination.
const own=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"ConvertTo-Json -InputObject @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress)"],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
const targets=[{name:'LOOPBACK_SNI',address:'127.0.0.1'},...addresses.filter(x=>x.family===4&&own.includes(x.address)&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)).map(x=>({name:'EXISTING_OWN_LAN_FORWARDING',address:x.address}))];
async function get(target,path){return await new Promise(resolve=>{
 const req=https.get({hostname:target.address,servername:host,path,port:443,headers:{Host:host},ca:rootCertificates,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(_name,cert)=>checkServerIdentity(host,cert)},res=>{
  const cert=res.socket.getPeerCertificate(),authorized=res.socket.authorized,protocol=res.socket.getProtocol();let bytes=0;const digest=createHash('sha256');res.on('data',b=>{bytes+=b.length;digest.update(b)});res.on('end',()=>resolve({path,http:res.statusCode,authorized,tls_protocol:protocol,public_node_roots_only:true,tls_bypass:false,fingerprint:cert.fingerprint256,bytes,body_sha256:digest.digest('hex')}));
 });req.setTimeout(10000,()=>req.destroy(Object.assign(Error('timeout'),{code:'TIMEOUT'})));req.on('error',error=>resolve({path,error:error.code||error.name,tls_bypass:false}));
})}
for(const target of targets){
 const results=await Promise.all(['/','/healthz','/readyz','/api/health/ready/','/api/profiles/'].map(path=>get(target,path)));
 gate(target.name,results.every(x=>x.authorized&&x.fingerprint===leaf.fingerprint256&&x.bytes>0&&(x.path==='/api/profiles/'?x.http===401:x.http===200)),{results,scope:'Socket remains on this computer; valid public-SNI certificate and local ingress do not certify Internet reachability'});
}
try{
 const observed=await new Promise((resolve,reject)=>{const r=https.get('https://api.ipify.org?format=json',{ca:rootCertificates,rejectUnauthorized:true},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>{try{if(s.statusCode!==200)throw Error('non200');resolve(JSON.parse(text).ip)}catch{reject(Error('No valid IP response'))}})});r.setTimeout(10000,()=>r.destroy());r.on('error',reject)});
 report.egress_comparison={status:'PASS',public_dns_matches_current_egress:publicAddresses.includes(observed),egress_address_digest:sha(observed),scope:'Address equality only; egress and ingress may differ, no router/ISP cause inferred'};
}catch{report.egress_comparison={status:'BLOCKED',reason:'Public egress observation unavailable'}}
gate('LOCAL_PKI_UNCHANGED',files.every(file=>sha(readFileSync(resolve(root,'.secrets/tls',file)))===tlsBefore[file]),{public_ca_sha256:tlsBefore['ca.crt'],files_compared:files.length,no_certificate_or_key_replaced:true});
report.local_tls_status=report.checks.every(x=>x.status==='PASS')?'PASS':'FAIL';report.status=report.local_tls_status==='PASS'?(ownerBasicPass?'PASS':'BLOCKED'):'FAIL';report.reason=ownerBasicPass?'Local public-SNI checks and separately owner-confirmed basic public reachability PASS; no authenticated-role/WSS/WAN-media certification':'Local diagnostics alone cannot close WAN acceptance; see independent external evidence';report.completed_at=new Date().toISOString();
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,local_tls:report.local_tls_status,checks:report.checks.map(({id,status})=>({id,status})),dns_differs:report.public_dns.differs_from_local_lookup,egress_matches:report.egress_comparison.public_dns_matches_current_egress}));
