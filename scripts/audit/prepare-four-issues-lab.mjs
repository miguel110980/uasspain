import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { project,lab,work,docker,inspect,verifyLabIdentity,originalFingerprint,env } from './four-issues-lab-common.mjs';

verifyLabIdentity();
const beforeFile=resolve(work,'original-before.json');
assert.ok(!existsSync(beforeFile),'Baseline already exists; do not overwrite preservation evidence');
const services=['nginx','frontend','backend','postgres','redis'];
const original=services.map(service=>{const c=inspect(`uasspain-${service}`);return {service,id:c.Id,image:c.Image,started_at:c.State.StartedAt};});
const fingerprint=originalFingerprint();
writeFileSync(beforeFile,JSON.stringify({observed_at:new Date().toISOString(),original,fingerprint},null,2));
const images={};
for(const service of ['backend','frontend']) {
  images[service]=`uasspain-audit-${service}:four-issues-before-20261117`;
  docker(['image','tag',original.find(c=>c.service===service).image,images[service]]);
}
const override=resolve(work,'lab-images.yml');
writeFileSync(override,`services:\n  backend-e2e:\n    image: ${images.backend}\n    ports: !reset []\n  web-e2e:\n    image: ${images.frontend}\n`);
const args=['compose','-p',project,'-f',resolve(lab,'compose.api.json'),'-f',override];
const model=JSON.parse(docker([...args,'config','--format','json']));
assert.deepEqual(Object.keys(model.services).sort(),['backend-e2e','postgres-e2e','web-e2e']);
assert.ok(!model.services['backend-e2e'].ports?.length);
for(const port of model.services['web-e2e'].ports||[])assert.equal(port.host_ip,'127.0.0.1');
const databaseId=inspect(`${project}-postgres-e2e-1`).Id;
docker(['start',databaseId]);
docker([...args,'up','-d','--no-build','--pull','never','--no-deps','--wait','--wait-timeout','120','backend-e2e','web-e2e']);
assert.equal(inspect(`${project}-postgres-e2e-1`).Id,databaseId);
assert.equal(originalFingerprint(),fingerprint);
for(const c of original){const current=inspect(`uasspain-${c.service}`);assert.equal(current.Id,c.id);assert.equal(current.State.StartedAt,c.started_at);}
const report={observed_at:new Date().toISOString(),project,status:'PASS_EXISTING_LAB_STARTED_ORIGINAL_UNCHANGED',images,database_container_preserved:true,original_unchanged:true,smtp_started:false,production_mounts:false,owner_test_sources:'Three desktop STS PDFs; originals not changed',scope:'Existing isolated fixture only, loopback HTTP, not public production validation'};
writeFileSync('docs/audits/evidence/2026-11-17-four-issues-lab-start.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
