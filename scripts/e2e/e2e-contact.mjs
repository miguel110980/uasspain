import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
const root=resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const run=(args,options={})=>execFileSync('docker',args,{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024,...options}).trim();
const backend='uasspain-e2e-backend-e2e-1';
const original=JSON.parse(run(['inspect',backend]))[0];
assert.equal(original.Config.Labels['com.docker.compose.project'],'uasspain-e2e');
const pg=JSON.parse(run(['inspect','uasspain-e2e-postgres-e2e-1']))[0];assert.equal(pg.Config.Labels['com.docker.compose.project'],'uasspain-e2e');
const guid=pg.Mounts.map(m=>m.Name?.match(/^uasspain-e2e-preserved-([a-f0-9]{32})-/)?.[1]).find(Boolean);
const runnerFiles=process.env.E2E_CONTACT_COMPOSE_FILES&&JSON.parse(process.env.E2E_CONTACT_COMPOSE_FILES);
if(runnerFiles){assert.ok(Array.isArray(runnerFiles)&&runnerFiles.length>=1);for(const file of runnerFiles){const allowed=[resolve(root,'docker-compose.e2e.yml'),resolve(root,'docker-compose.realtime-e2e.yml'),guid&&resolve(root,'.run/e2e-preserved-volumes/'+guid+'.json')].filter(Boolean);assert.ok(allowed.includes(resolve(file)),'Only isolated Compose files are allowed');}assert.ok(guid||pg.Mounts.some(m=>m.Name==='uasspain-e2e_e2e_pgdata'));}
else assert.ok(guid,'A new explicitly preserved isolated volume is required');
const environment={...process.env,E2E_FIELD_ENCRYPTION_KEY:original.Config.Env.find(v=>v.startsWith('FIELD_ENCRYPTION_KEY=')).slice(21)};
assert.equal(Buffer.from(environment.E2E_FIELD_ENCRYPTION_KEY,'base64').length,32);
const own=randomUUID(),dir=resolve(root,'.run/order-20261009/05/contact-'+own),out=resolve(dir,'out');await mkdir(out,{recursive:true});
const password=randomBytes(32).toString('hex');environment.E2E_CONTACT_SMTP_PASSWORD=password;environment.FIXTURE_SMTP_PASSWORD=password;
const name='uasspain-contact-smtp-'+own,network=Object.keys(original.NetworkSettings.Networks)[0];assert.ok(network.startsWith('uasspain-e2e_'));
const base=['compose',...(runnerFiles||[resolve(root,'docker-compose.e2e.yml'),resolve(root,'.run/e2e-preserved-volumes/'+guid+'.json')]).flatMap(file=>['-f',file])];
// Never print env/config: they contain only ephemeral fixture credentials, but
// still remain private. The override file contains a variable placeholder.
const override=resolve(dir,'override.json');let configured=false,receiver=false,browser,preview;
const report={time:new Date().toISOString(),scope:'Isolated API/browser/authenticated TLS SMTP mailbox; no corporate mailbox claim',gates:[],errors:[],corporateDelivery:'NOT_VALIDATED'};
const gate=(ok,name)=>{assert.ok(ok,name);report.gates.push(name);};
const api=async(data,headers={})=>{const r=await fetch('http://127.0.0.1:8010/api/contact/',{method:'POST',headers:{Origin:'http://localhost:8010','Content-Type':'application/json',Connection:'close',...headers},body:JSON.stringify(data)});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():null};};
const input={nombre:'TEMP Contact Client',email:'Visitor+Case@example.invalid',empresa:'TEMP Company',telefono:'',servicio:'Otro',asunto:'TEMP commercial enquiry',mensaje:'First line of the enquiry.\nSecond line stays separate.',website:''};
const mailFiles=async()=> (await readdir(out)).filter(f=>f.endsWith('.json'));
const smtpConfig=async(ca='/app/backups/e2e-contact-ca.pem')=>{
 await writeFile(override,JSON.stringify({services:{'backend-e2e':{environment:{CONTACT_SMTP_HOST:'contact-smtp-e2e',CONTACT_SMTP_PORT:'2525',CONTACT_SMTP_SECURITY:'STARTTLS',CONTACT_SMTP_USER:'contact-fixture',CONTACT_SMTP_FROM:'',CONTACT_SMTP_PASSWORD:'${E2E_CONTACT_SMTP_PASSWORD}',CONTACT_SMTP_CA_FILE:ca}}}}));
 configured=true;run([...base,'-f',override,'up','-d','--no-build','--wait','--wait-timeout','90','backend-e2e'],{env:environment});
};
async function decoded(file){const raw=JSON.parse(await readFile(resolve(out,file),'utf8'));
 const script="import sys,json,email.policy,email.parser; m=email.parser.BytesParser(policy=email.policy.default).parsebytes(sys.stdin.buffer.read()); print(json.dumps({'to':m['To'].addresses[0].addr_spec,'reply':m['Reply-To'].addresses[0].addr_spec,'sender':m['From'].addresses[0].addr_spec,'subject':str(m['Subject']),'body':m.get_body(preferencelist=('plain',)).get_content(),'bcc':m.get('Bcc')},ensure_ascii=True))";
 const parsed=JSON.parse(run(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','-i','uasspain-e2e-python:local','-c',script],{input:raw.raw}));
 gate(raw.tls&&parsed.to==='info@uasspain.com'&&parsed.sender==='info@uasspain.com','TLS_and_corporate_envelope');
 gate(parsed.reply===input.email&&!parsed.bcc,'Reply_To_preserves_client_address');
 gate(parsed.subject.includes(input.asunto)&&parsed.body.includes(input.nombre)&&parsed.body.includes(input.empresa)&&parsed.body.includes(input.email)&&parsed.body.replaceAll('\r\n','\n').includes(input.mensaje),'all_human_fields_and_newlines_received');return {tls:raw.tls,to:parsed.to,reply:parsed.reply,subject:parsed.subject};
}
try{
 const publicConfig=await (await fetch('http://127.0.0.1:8010/api/contact/config/')).json();gate(publicConfig.email==='info@uasspain.com','public_destination_without_credentials');
 for(const invalid of [{email:'a@'},{email:'Client <a@example.invalid>'},{email:'a@example.invalid\r\nBcc: b@example.invalid'},{asunto:'Test\r\nBcc: b@example.invalid'},{nombre:'A\nB'},{empresa:'A\nB'},{telefono:'not-a-number'},{servicio:'invented'},{mensaje:'short'},{mensaje:'x'.repeat(2001)},{asunto:'x'.repeat(121)},{website:'spam'}])gate((await api({...input,...invalid})).status===400,'backend_rejects_'+Object.keys(invalid)[0]+'_'+report.gates.length);
 gate((await api({...input,mensaje:'x'.repeat(20000)})).status===413,'request_size_bounded');
 gate((await api(input,{Origin:'https://foreign.invalid'})).status===403,'foreign_origin_denied');
 const absent=await api(input);gate(absent.status===503&&!absent.body.smtp_accepted,'DEV_EMAIL_has_no_false_contact_success');
 const openssl=args=>execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',args,{stdio:'ignore'});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(dir,'ca-key.pem'),'-out',resolve(dir,'ca.pem'),'-days','1','-subj','/CN=Temporary contact fixture CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-keyout',resolve(dir,'key.pem'),'-out',resolve(dir,'server.csr'),'-subj','/CN=contact-smtp-e2e']);
 await writeFile(resolve(dir,'server.ext'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:contact-smtp-e2e\n');
 openssl(['x509','-req','-in',resolve(dir,'server.csr'),'-CA',resolve(dir,'ca.pem'),'-CAkey',resolve(dir,'ca-key.pem'),'-CAcreateserial','-days','1','-extfile',resolve(dir,'server.ext'),'-out',resolve(dir,'cert.pem')]);await unlink(resolve(dir,'ca-key.pem'));
 run(['run','-d','--name',name,'--label','io.uasspain.contact.fixture='+own,'--network',network,'--network-alias','contact-smtp-e2e','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','-e','FIXTURE_SMTP_PASSWORD','-v',dir+':/keys:ro','-v',out+':/out:rw','-v',resolve(root,'scripts/e2e/fixture-contact-smtp.mjs')+':/fixture.mjs:ro','node:22.23.2-alpine3.24@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85','node','/fixture.mjs'],{env:environment});receiver=true;
 for(let n=0;n<40;n++){if(run(['logs',name]).includes('ISOLATED_CONTACT_SMTP_READY'))break;await new Promise(r=>setTimeout(r,250));}gate(run(['logs',name]).includes('ISOLATED_CONTACT_SMTP_READY'),'owned_TLS_receiver_ready');
 run(['cp',resolve(dir,'ca.pem'),backend+':/app/backups/e2e-contact-ca.pem']);await smtpConfig();
 const accepted=await api(input);report.transportStatus=accepted.status;report.fixtureStages=run(['logs',name]).split('\n');gate(accepted.status===200&&accepted.body.smtp_accepted===true&&!accepted.body.warning,'corporate_transport_really_accepts');
 let files=await mailFiles();gate(files.length===1,'exactly_one_API_message_received');const apiMail=files[0];report.received=[await decoded(apiMail)];
 const origin=process.env.E2E_BROWSER_ORIGIN||'http://127.0.0.1:8011';
 if(!process.env.E2E_BROWSER_ORIGIN){preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','8011','--strictPort'],{cwd:resolve(root,'frontend'),env:{...environment,VITE_DEV_PROXY_API_ORIGIN:'http://127.0.0.1:8010'},stdio:'ignore'});for(let n=0;n<60;n++){assert.equal(preview.exitCode,null);try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}}
 browser=await chromium.launch();const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});page.on('pageerror',e=>report.errors.push(e.message));await page.goto(origin+'/contacto');
 gate(await page.getByRole('link',{name:'info@uasspain.com',exact:true}).getAttribute('href')==='mailto:'+publicConfig.email,'visible_email_matches_backend_destination');
 await page.getByRole('button',{name:'Enviar Mensaje',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Selecciona un servicio válido.');gate(true,'form_missing_fields_reported');
 const fill=async()=>{await page.locator('#contactsection-field-1').fill(input.nombre);await page.locator('#contactsection-field-2').fill(input.empresa);await page.locator('#contactsection-field-3').fill(input.email);await page.locator('#contactsection-subject').fill(input.asunto);await page.locator('#contactsection-field-5').click();await page.getByRole('option',{name:'Otro',exact:true}).click();await page.locator('#contactsection-field-6').fill(input.mensaje);};
 await fill();let submitted=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/contact/'))submitted++;});const completed=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/contact/'));await page.getByRole('button',{name:'Enviar Mensaje',exact:true}).evaluate(button=>{button.click();button.click();});gate((await completed).status()===200,'real_UI_submission_accepted');await expect(page.getByText('✓ Mensaje enviado correctamente. Te contactaremos pronto.',{exact:true})).toBeVisible();gate(submitted===1,'double_submit_sends_once');files=await mailFiles();gate(files.length===2,'exactly_one_UI_message_received');report.received.push(await decoded(files.find(f=>f!==apiMail)));
 await fill();await writeFile(resolve(out,'reject'),'reject');const rejected=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/contact/'));await page.getByRole('button',{name:'Enviar Mensaje',exact:true}).click();gate((await rejected).status()===503,'provider_rejection_reaches_UI');await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('#contactsection-field-6')).toHaveValue(input.mensaje);await expect(page.getByText('✓ Mensaje enviado correctamente. Te contactaremos pronto.',{exact:true})).toHaveCount(0);gate(true,'provider_error_preserves_form_without_false_success');gate((await mailFiles()).length===2,'provider_rejection_does_not_create_delivered_mail');
 await unlink(resolve(out,'reject'));gate((await api(input)).status===200,'retry_after_real_provider_error');gate((await api(input)).status===200,'fifth_request_within_rate');gate((await api({...input,email:'rotated@example.invalid'},{'X-Forwarded-For':'192.0.2.123'})).status===429,'backend_IP_rate_cannot_be_bypassed_by_email_or_forwarded_header');
 await smtpConfig('');const untrusted=await api(input);gate(untrusted.status===503&&!untrusted.body.smtp_accepted,'untrusted_certificate_rejected_without_false_success');
 assert.deepEqual(report.errors,[]);report.result='PASS';
}catch(e){report.result='FAIL';report.failure=e.message;process.exitCode=1;}finally{
 const cleanupFailure=e=>{report.result='FAIL';report.errors.push('Fixture cleanup: '+e.message);process.exitCode=1;};
 try{await browser?.close();}catch(e){cleanupFailure(e);}preview?.kill();
 try{if(configured){run([...base,'up','-d','--no-build','--wait','--wait-timeout','90','backend-e2e'],{env:environment});const current=JSON.parse(run(['inspect',backend]))[0];assert.equal(current.Config.Labels['com.docker.compose.project'],'uasspain-e2e');assert.equal(current.Image,original.Image);report.backendRestored=true;}}catch(e){cleanupFailure(e);}
 try{if(receiver){const c=JSON.parse(run(['inspect',name]))[0];assert.equal(c.Config.Labels['io.uasspain.contact.fixture'],own);assert.ok(Object.hasOwn(c.NetworkSettings.Networks,network));run(['rm','-f',name]);report.receiverRemoved=true;}}catch(e){cleanupFailure(e);}
 for(const file of ['key.pem','cert.pem','ca-key.pem'])try{await unlink(resolve(dir,file));}catch(e){if(e.code!=='ENOENT')cleanupFailure(e);}environment.E2E_CONTACT_SMTP_PASSWORD='';environment.FIXTURE_SMTP_PASSWORD='';environment.E2E_FIELD_ENCRYPTION_KEY='';
 await writeFile(resolve(root,'.run/order-20261009/05/contact-result.json'),JSON.stringify(report,null,2));console.log('CONTACT_ISOLATED='+report.result+' GATES='+report.gates.length);if(report.failure)console.log(report.failure);
}
