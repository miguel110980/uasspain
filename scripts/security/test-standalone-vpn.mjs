import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Only the reviewed remote verifier is executed with in-memory command stubs.
// Never run the coordinator, SSH, installers, firewall or tunnel configuration.
const root=fileURLToPath(new URL('../../',import.meta.url));
const desktop=process.env.VPN_TEST_DESKTOP || 'C:/Users/migue/OneDrive/Desktop';
const bash=process.env.BASH_TEST_EXECUTABLE || 'C:/Program Files/Git/bin/bash.exe';
const reportPath=process.env.VPN_TEST_REPORT || join(root,'.run/catalogo-todos-20261110/standalone-vpn-tests.json');
const sources=['Configurar-VPN-UASSpain.ps1','configurar-vpn-uasspain.sh'];
const results=[],hashes={};
const cases=[
  {name:'current',timestamp:'1000',pass:true},
  {name:'recent',timestamp:'999',pass:true},
  {name:'last-valid-second',timestamp:'881',pass:true},
  {name:'stale-boundary',timestamp:'880'},
  {name:'future',timestamp:'1001'},
  {name:'zero',timestamp:'0'},
  {name:'negative',timestamp:'-1'},
  {name:'no-handshake',empty:true},
  {name:'wg-command-error',timestamp:'999',wgExit:1},
  {name:'route-command-error',timestamp:'999',routeExit:1},
  {name:'wrong-route',timestamp:'999',device:'eth0'},
  {name:'interface-prefix-collision',timestamp:'999',device:'uasb12345678x'},
];
for(const name of sources){
  const raw=await readFile(join(desktop,name));
  hashes[name]=createHash('sha256').update(raw).digest('hex');
  const text=raw.toString('utf8').replace(/\r\n/g,'\n');
  const appPrompt=text.indexOf('Introduce la IP del servidor donde está alojado UAS Spain:');
  const backupPrompt=text.indexOf('Introduce la IP del servidor externo donde se guardarán los backups:');
  assert.ok(appPrompt>=0&&backupPrompt>appPrompt,'Both required IP prompts remain in order');
  const block=name.endsWith('.ps1')?text.split("$RemoteScript=@'\n")[1]?.split("\n'@")[0]:text.split("<<'UAS_REMOTE'\n")[1]?.split('\nUAS_REMOTE')[0];
  assert.ok(block?.startsWith('set -eu\naction=$1; iface=$2; shift 2\n'),'Reviewed remote dispatch boundary');
  for(const fixture of cases){
    const output=fixture.empty?'':`synthetic-public-key\\t${fixture.timestamp}\\n`;
    const harness=`uname(){ printf 'Linux\\n'; }; id(){ printf '0\\n'; }; test(){ return 0; }; date(){ printf '1000\\n'; }; ping(){ return 0; }; wg(){ printf '${output}'; return ${fixture.wgExit||0}; }; ip(){ printf '192.0.2.2 dev ${fixture.device||'uasb12345678'}\\n'; return ${fixture.routeExit||0}; }; set -- verify uasb12345678 192.0.2.2;\n${block}`;
    const actual=spawnSync(bash,['-s'],{input:harness,encoding:'utf8',windowsHide:true,timeout:5000});
    const accepted=actual.status===0&&actual.stdout.includes('HANDSHAKE=PASS')&&actual.stdout.includes('ROUTE=PASS');
    results.push({script:name,case:fixture.name,status:accepted===Boolean(fixture.pass)?'PASS':'FAIL',expected_accept:Boolean(fixture.pass),accepted,exit:actual.status});
  }
}
await mkdir(new URL('../../.run/catalogo-todos-20261110/',import.meta.url),{recursive:true});
await writeFile(reportPath,JSON.stringify({scope:'pure isolated verifier regression; no SSH,network,installations or real WireGuard execution',hashes,results},null,2));
const failed=results.filter(x=>x.status!=='PASS');
console.log(JSON.stringify({pass:results.length-failed.length,fail:failed.map(x=>({script:x.script,case:x.case})),report:reportPath}));
process.exitCode=failed.length?1:0;
