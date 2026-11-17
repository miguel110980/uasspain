import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {project,work,lab,docker,inspect,verifyLabIdentity,originalFingerprint} from './four-issues-lab-common.mjs';

verifyLabIdentity();
const original=JSON.parse(readFileSync(resolve(work,'original-before.json'),'utf8'));
assert.equal(originalFingerprint(),original.fingerprint,'Original account data changed; reconcile before continuing');
const originalContainers=['nginx','frontend','backend','postgres','redis'].map(service=>{const c=inspect(`uasspain-${service}`);return {service,id:c.Id,started_at:c.State.StartedAt};});
const database=inspect(`${project}-postgres-e2e-1`);
const images=Object.fromEntries(['backend','frontend'].map(service=>[service,`uasspain-audit-${service}:four-issues-candidate-20261117`]));
const identities=Object.fromEntries(Object.entries(images).map(([service,image])=>[service,JSON.parse(docker(['image','inspect',image]))[0].Id]));
const override=resolve(work,'lab-images.yml');
const before=readFileSync(override,'utf8');
writeFileSync(resolve(work,'lab-images-before-candidate.yml'),before);
writeFileSync(resolve(lab,'keys/webrtc-ice-servers.json'),readFileSync('config/webrtc-ice-servers.json'));
writeFileSync(override,`services:\n  backend-e2e:\n    image: ${images.backend}\n    ports: !reset []\n    environment:\n      WEBRTC_ICE_SERVERS_FILE: /fixture/webrtc-ice-servers.json\n  web-e2e:\n    image: ${images.frontend}\n`);
const args=['compose','-p',project,'-f',resolve(lab,'compose.api.json'),'-f',override];
const model=JSON.parse(docker([...args,'config','--format','json']));
assert.ok(!model.services['backend-e2e'].ports?.length);
for(const binding of model.services['web-e2e'].ports||[])assert.equal(binding.host_ip,'127.0.0.1');
try {docker([...args,'up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120','backend-e2e','web-e2e']);}
catch(error){writeFileSync(override,before);docker([...args,'up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120','backend-e2e','web-e2e']);throw error;}
assert.equal(inspect(`${project}-postgres-e2e-1`).Id,database.Id);
assert.equal(inspect(`${project}-postgres-e2e-1`).State.StartedAt,database.State.StartedAt);
const deployed=[];
for(const [service,label] of [['backend-e2e','backend'],['web-e2e','frontend']]){
  const c=inspect(`${project}-${service}-1`);assert.equal(c.Image,identities[label]);assert.equal(c.State.Health?.Status,'healthy');deployed.push({service,id:c.Id,image:c.Image,started_at:c.State.StartedAt});
}
for(const c of originalContainers){const current=inspect(`uasspain-${c.service}`);assert.equal(current.Id,c.id);assert.equal(current.State.StartedAt,c.started_at);assert.equal(current.State.Health?.Status,'healthy');}
assert.equal(originalFingerprint(),original.fingerprint);
const report={observed_at:new Date().toISOString(),scope:'Candidate images applied only to the existing isolated fixture; current original containers preserved during this operation',status:'PASS_CANDIDATE_LAB_DEPLOYED',deployed,database_container_and_start_preserved:true,original_five_healthy_unchanged:true,original_accounts_unchanged:true,original_containers_before:originalContainers,production_deployment:'NOT_RUN_IN_THIS_LAB_OPERATION'};
const phase=process.argv.includes('--reconnection')?'reconnection-candidate-lab':'four-issues-candidate-lab';
writeFileSync(`docs/audits/evidence/2026-11-17-${phase}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
