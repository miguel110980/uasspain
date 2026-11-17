/** Prepare and validate a candidate; never apply live Compose, env or host changes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dir=resolve('.run/audit-20261117/direct-https');mkdirSync(dir,{recursive:true});
const original=readFileSync('docker-compose.yml','utf8'),needle='      - "${HTTP_BIND:-127.0.0.1}:${HTTPS_PORT:-443}:8443"';
assert.ok(!original.includes('${HTTPS_LAN_BIND'),'Direct HTTPS already configured; preserve the original proposal and use the closure verifier');
assert.equal(original.split(needle).length,2,'Require the exact current HTTPS mapping');
const newline=original.includes('\r\n')?'\r\n':'\n';
const candidate=original.replace(needle,needle+newline+'      # Explicit LAN HTTPS only; loopback default deduplicates in private deployments.'+newline+'      - "${HTTPS_LAN_BIND:-127.0.0.1}:${HTTPS_PORT:-443}:8443"');
const path=resolve(dir,'docker-compose.candidate.yml');writeFileSync(path,candidate);
function config(file,lan){return JSON.parse(execFileSync('docker',['compose','-p','uasspain','--project-directory',root,'-f',file,'-f',resolve('docker-compose.encrypted.yml'),'config','--format','json'],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,env:{...process.env,HTTPS_LAN_BIND:lan}}));}
const before=config(resolve('docker-compose.yml'),''),fallback=config(path,''),proposed=config(path,'192.168.1.34');
assert.deepEqual(Object.keys(proposed.services).sort(),['backend','frontend','nginx','postgres','redis']);
assert.deepEqual(fallback,before,'Unset LAN bind must preserve the complete private deployment');
const port=p=>`${p.host_ip}:${p.published}->${p.target}/${p.protocol}`;
assert.deepEqual(before.services.nginx.ports.map(port).sort(),['127.0.0.1:443->8443/tcp','127.0.0.1:80->8080/tcp']);
assert.deepEqual(proposed.services.nginx.ports.map(port).sort(),['127.0.0.1:443->8443/tcp','127.0.0.1:80->8080/tcp','192.168.1.34:443->8443/tcp'].sort());
const a=structuredClone(before),b=structuredClone(proposed);delete a.services.nginx.ports;delete b.services.nginx.ports;
assert.deepEqual(b,a,'No change permitted outside nginx port bindings');
const report={observed_at:new Date().toISOString(),status:'PASS_CANDIDATE_ONLY_NOT_APPLIED',cause:'Stored Windows portproxy survived boot but had no LAN listener. Refresh failed; exact removal/re-add restored it. Boot prevention not yet implemented.',live_changes:0,candidate_compose_sha256:createHash('sha256').update(candidate).digest('hex'),original_compose_sha256:createHash('sha256').update(original).digest('hex'),before_ports:before.services.nginx.ports.map(port),proposed_ports:proposed.services.nginx.ports.map(port),checks:{same_five_services:true,unset_variable_preserves_current_private_deployment:true,only_nginx_ports_change:true,no_other_container_or_security_config_change:true},proposed_env:{HTTPS_LAN_BIND:'192.168.1.34'},proposed_windows_change:'Remove only the redundant existing 192.168.1.34:443 -> 127.0.0.1:443 portproxy after recoverable snapshot; Docker will own that exact listener',service_restarts_proposed:'Official build/recreate nginx only, then one nginx restart to test direct binding persistence; no IP Helper/Tailscale restart',windows_reboot:'Owner-assisted later; NOT_AUTHORIZED_OR_EXECUTED',authorization:'REQUIRED_BEFORE_APPLY',release_gate:'BLOCKED'};
writeFileSync('docs/audits/evidence/2026-11-17-direct-https-proposal.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
