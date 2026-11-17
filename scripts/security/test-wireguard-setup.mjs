import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = root + 'infra/wireguard/setup.sh';
const source = await readFile(sourcePath, 'utf8');
const evidenceDir = root + '.run/f15-f16-20261110';
const fixtureRoot = evidenceDir + '/bash-fixture';
await mkdir(fixtureRoot + '/configs', { recursive: true });
await writeFile(fixtureRoot + '/configs/server1.conf', '# synthetic, no keys\n');
const bash = process.env.BASH_TEST_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const functions = source.slice(source.indexOf('install_wireguard() {'), source.indexOf('# ─── Main'));
if (!functions.startsWith('install_wireguard() {') || functions.includes('SERVER_NAME=')) throw new Error('Unexpected function boundaries');
const harness = `#!/usr/bin/env bash
set -euo pipefail
DRY_RUN=false; ALLOW_INSTALL=false; VPN_INTERFACE_LINUX=wg0; WG_CONFIG_DIR=configs
ROOT_DIR=$1
mode=$2
step(){ :; }
ok(){ printf 'SUCCESS:%s\\n' "$1"; }
warn(){ :; }
fail(){ printf 'REJECT:%s\\n' "$1" >&2; exit 42; }
run(){ if $DRY_RUN; then printf '[dry-run] %s\\n' "$*"; else "$@"; fi; }
date(){ printf '1000\\n'; }
sleep(){ :; }
ping(){ [[ "$mode" != ping-blocked ]]; }
ip(){ if [[ "$mode" == wrong-route ]]; then echo '192.0.2.2 dev eth0'; else echo '192.0.2.2 dev wg0'; fi; }
command(){ if [[ "$1" == -v && "$2" == wg ]]; then [[ "$mode" == installed ]]; else builtin command "$@"; fi; }
sudo(){
 case "$1" in
  test) if [[ "$2" == '!' ]]; then [[ "$mode" != symlink ]]; else [[ "$mode" == existing-conflict ]]; fi ;;
  cmp) return 1 ;;
  install) echo 'OP:install-config' ;;
  systemctl) echo 'OP:service'; [[ "$mode" != persistence-failed ]] ;;
  wg-quick) echo 'OP:activate'; [[ "$mode" != activation-failed ]] ;;
  wg)
   case "\${4:-}" in
    allowed-ips)
      if [[ "$mode" == wrong-address ]]; then printf 'peer-a\\t198.51.100.2/32\\n';
      elif [[ "$mode" == ambiguous ]]; then printf 'peer-a\\t192.0.2.2/32\\npeer-b\\t192.0.2.2/32\\n';
      else printf 'peer-a\\t198.51.100.2/32, 192.0.2.2/32\\n'; fi ;;
    latest-handshakes)
      case "$mode" in
       zero) printf 'peer-a\\t0\\n';;
       stale) printf 'peer-a\\t819\\n';;
       boundary) printf 'peer-a\\t820\\n';;
       future) printf 'peer-a\\t1001\\n';;
       invalid) printf 'peer-a\\tnan\\n';;
       wrong-peer) printf 'peer-b\\t999\\n';;
       duplicate) printf 'peer-a\\t999\\npeer-a\\t998\\n';;
       *) printf 'peer-a\\t999\\n';;
      esac ;;
    *) [[ "$mode" == active ]] ;;
   esac ;;
  *) echo 'Unexpected privileged command' >&2; exit 99 ;;
 esac
}
${functions}
case "$3" in
 global) validate_handshake ;;
 peer) validate_connectivity 192.0.2.2 SYNTHETIC ;;
 activate) activate_tunnel server1 ;;
 install) install_wireguard ;;
 dry) DRY_RUN=true; ALLOW_INSTALL=true; install_wireguard; activate_tunnel server1; validate_handshake; validate_connectivity 192.0.2.2 SYNTHETIC ;;
 *) exit 99 ;;
esac
`;
const harnessPath = evidenceDir + '/bash-validator-fixture.sh';
await writeFile(harnessPath, harness);
const fixturePosix = process.platform === 'win32' ? fixtureRoot.replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase()) : fixtureRoot;
const cases = [
  ['global-current','current','global',0],['global-zero','zero','global',42],
  ['global-stale','stale','global',42],['global-future','future','global',42],
  ['global-invalid','invalid','global',42],['global-boundary','boundary','global',0],
  ['peer-current','current','peer',0],['peer-zero','zero','peer',42],
  ['peer-stale','stale','peer',42],['peer-future','future','peer',42],
  ['peer-invalid','invalid','peer',42],['peer-wrong-address','wrong-address','peer',42],
  ['peer-wrong-key','wrong-peer','peer',42],['peer-ambiguous','ambiguous','peer',42],
  ['peer-duplicate-handshake','duplicate','peer',42],['peer-wrong-route','wrong-route','peer',42],
  ['peer-icmp-blocked','ping-blocked','peer',0],['peer-boundary','boundary','peer',0],
  ['activation-symlink','symlink','activate',42],['activation-conflict','existing-conflict','activate',42],
  ['activation-persistence-failed','persistence-failed','activate',42],['activation-failed','activation-failed','activate',42],
  ['activation-existing','active','activate',0],['activation-new','current','activate',0],
  ['install-not-authorized','current','install',42],['install-reuse','installed','install',0],
  ['direct-functions-dry-run','current','dry',0],
];
const results = cases.map(([name,mode,action,expected]) => {
  const r = spawnSync(bash, [harnessPath, fixturePosix, mode, action], { encoding:'utf8', timeout:5000, windowsHide:true });
  const output = (r.stdout || '') + (r.stderr || '');
  const drySafe = action !== 'dry' || (!output.includes('OP:') && !output.includes('SUCCESS:'));
  const rejectedSafely = expected === 0 || !output.includes('SUCCESS:');
  return {name,status:r.status === expected && drySafe && rejectedSafely ? 'PASS':'FAIL',exit:r.status,expected,output};
});
for (const role of ['server1','server2','backup1','backup2','backup3']) {
  const r = spawnSync(bash, [sourcePath, '--allow-install', '--server', role, '--dry-run'], {cwd:root,encoding:'utf8',timeout:5000,windowsHide:true});
  results.push({name:'full-dry-run-'+role,status:r.status===0 && r.stdout.includes('NOT_VALIDATED') && !r.stdout.includes('setup complete') ? 'PASS':'FAIL',exit:r.status,output:(r.stdout||'')+(r.stderr||'')});
}
for (const args of [['--server'],['--server','invalid','--dry-run'],['--server','server1','--server','server2','--dry-run'],['--unknown','--dry-run']]) {
  const r = spawnSync(bash,[sourcePath,...args],{cwd:root,encoding:'utf8',timeout:5000,windowsHide:true});
  results.push({name:'invalid-options-'+args.join(' '),status:r.status===2?'PASS':'FAIL',exit:r.status,output:(r.stdout||'')+(r.stderr||'')});
}
const report = {at:new Date().toISOString(),status:results.every(r=>r.status==='PASS')?'PASS':'FAIL',tests:results.length,failures:results.filter(r=>r.status==='FAIL').length,source_sha256:createHash('sha256').update(await readFile(sourcePath)).digest('hex'),network_or_system_changes:0,scope:'mocked privileged/network commands plus actual main dry-run only; not a real VPN/SFTP',results};
await writeFile(evidenceDir+'/wireguard-bash-tests.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,tests:report.tests,failures:report.failures,failed:results.filter(r=>r.status==='FAIL')}));
process.exitCode = report.status === 'PASS' ? 0 : 1;
