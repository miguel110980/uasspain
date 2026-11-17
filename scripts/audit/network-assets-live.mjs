/** Targeted follow-up to the saved stylesheet-parser failure; no service changes. */
import https from 'node:https';
import {rootCertificates,checkServerIdentity} from 'node:tls';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const host='uasspain-prueba.duckdns.org';
const reportDate=process.argv.find(value=>value.startsWith('--report-date='))?.split('=')[1]||'2026-11-16';
const reportName=process.argv.find(value=>value.startsWith('--report-name='))?.split('=')[1]||'network-assets-live';
if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))throw Error('Invalid explicit report date');
if(!/^[a-z0-9-]+$/.test(reportName))throw Error('Invalid report label');
async function get(path){return new Promise((resolve,reject)=>{
 const req=https.get({hostname:'192.168.1.34',servername:host,path,headers:{Host:host},ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(host,cert)},res=>{const chunks=[];const authorized=res.socket.authorized;res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({http:res.statusCode,authorized,type:res.headers['content-type'],body:Buffer.concat(chunks)}));});
 req.setTimeout(12000,()=>req.destroy(Error('Timeout')));req.on('error',reject);
});}
const report={observed_at:new Date().toISOString(),scope:'Targeted server-LAN asset follow-up only; not a second-device or Internet check',previous_evidence:'2026-11-16-network-server-live.json',root_cause:'Diagnostic omitted data-stylesheet references used by the existing Home prerender; application CSS was embedded, not missing.',checks:[],application_changes:0,tls_bypass:false};
const check=(id,ok,observed)=>report.checks.push({id,status:ok?'PASS':'FAIL',observed});
const page=await get('/'),html=page.body.toString('utf8');
check('HTML',page.http===200&&page.authorized,{http:page.http,bytes:page.body.length});
for(const service of ['nginx','frontend','backend','postgres','redis']){const c=JSON.parse(execFileSync('docker',['inspect','uasspain-'+service],{encoding:'utf8',windowsHide:true}))[0];check('POST_ROUTER_HEALTH:'+service,c.Config.Labels['com.docker.compose.project']==='uasspain'&&c.State.Running&&c.State.Health?.Status==='healthy',{id:c.Id,image:c.Image,health:c.State.Health?.Status});}
for(const path of ['/healthz','/readyz','/api/health/live/','/api/health/ready/','/api/profiles/']){const r=await get(path);check('POST_ROUTER_HTTP:'+path,r.authorized&&r.http===(path==='/api/profiles/'?401:200),{http:r.http,authorized:r.authorized});}
const paths=[...new Set([...html.matchAll(/(?:src|href|data-stylesheet)=["'](\/assets\/[^"'<>]+\.(?:js|css))["']/g)].map(x=>x[1]))];
check('JS_AND_CSS_REFERENCES',paths.some(x=>x.endsWith('.js'))&&paths.some(x=>x.endsWith('.css')),{paths});
for(const path of paths){const asset=await get(path);check('ASSET:'+path,asset.http===200&&asset.authorized&&asset.body.length>20&&(/\.css$/.test(path)?asset.type?.includes('text/css'):/javascript/.test(asset.type)),{http:asset.http,bytes:asset.body.length,type:asset.type});}
for(const [,path,contents] of html.matchAll(/<style data-stylesheet="([^"]+)">([\s\S]*?)<\/style>/g)){
 const asset=await get(path);let actual=asset.body.toString('utf8');
 for(const font of [...actual.matchAll(/url\((\/fonts\/[^)]+-critical\.woff2)\)/g)]){const file=await get(font[1]);check('CRITICAL_FONT:'+font[1],file.http===200&&file.authorized&&file.body.length>100,{http:file.http,bytes:file.body.length});actual=actual.replaceAll(font[0],`url(data:font/woff2;base64,${file.body.toString('base64')})`);}
 check('INLINE_CSS_EQUALS_COMPILED:'+path,contents===actual.replace(/<\/style/gi,'<\\/style'),{bytes:Buffer.byteLength(contents),sha256:createHash('sha256').update(contents).digest('hex')});
}
report.status=report.checks.every(x=>x.status==='PASS')?'PASS_SCOPED_ASSETS_ONLY':'FAIL';
writeFileSync('docs/audits/evidence/'+reportDate+'-'+reportName+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.checks.filter(x=>x.status==='FAIL').map(x=>x.id)}));if(report.status==='FAIL')process.exitCode=1;
