/** Applies only the two expressly approved Google origin values; no DB writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const target='https://uasspain-prueba.duckdns.org',dir='.run/audit-20261116/google-public-origin';
const sha=x=>createHash('sha256').update(x).digest('hex');
const query="SELECT json_build_object('profiles',(SELECT count(*) FROM accounts_userprofile),'identity',md5((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('auth_digest',md5(to_jsonb(u)::text)) ORDER BY p.id)::text FROM accounts_userprofile p JOIN auth_user u ON p.user_id=u.id)),'secrets',md5((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM core_systemsecret s)),'google',md5((SELECT value::text FROM core_systemsetting WHERE key='google_oauth')))";
const state=()=>JSON.parse(execFileSync('docker',['exec','uasspain-postgres','psql','-X','-U','uasspain','-d','uasspain','-qtA','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8',windowsHide:true}));
const envKeys=['GOOGLE_OAUTH_PUBLIC_ORIGIN','GOOGLE_OAUTH_VERIFIED_PUBLIC_ORIGIN'];
const onlyOther=text=>text.split(/\r?\n/).filter(line=>!envKeys.some(key=>line.startsWith(key+'='))).join('\n');
if(!process.argv.includes('--apply'))throw Error('Explicit --apply required; owner has already authorized this exact change');
assert.ok(!existsSync(dir+'/env.before'),'Existing backup/journal prevents accidental replay');
const before=readFileSync('.env'),text=before.toString('utf8'),newline=text.includes('\r\n')?'\r\n':'\n';let after=text;
for(const key of envKeys){const re=new RegExp('^'+key+'=([^\\r\\n]*)','gm');const matches=[...after.matchAll(re)];assert.ok(matches.length<=1,'Duplicate target variable');if(matches.length){after=after.replace(re,key+'='+target);}else{after+=(after.endsWith('\n')?'':newline)+key+'='+target+newline;}}
assert.equal(onlyOther(text).trimEnd(),onlyOther(after).trimEnd(),'Unrelated .env values must remain unchanged');
const baseline=state();assert.equal(baseline.profiles,8);mkdirSync(dir,{recursive:true});copyFileSync('.env',dir+'/env.before');
execFileSync('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop';$section=[System.Security.AccessControl.AccessControlSections]::Access;$source=Get-Acl -LiteralPath '.env';$backup=Get-Acl -LiteralPath '.run/audit-20261116/google-public-origin/env.before';$backup.SetSecurityDescriptorSddlForm($source.GetSecurityDescriptorSddlForm($section),$section);Set-Acl -LiteralPath '.run/audit-20261116/google-public-origin/env.before' -AclObject $backup"],{windowsHide:true,stdio:'pipe'});
writeFileSync(dir+'/state.before.json',JSON.stringify(baseline));writeFileSync('.env',after);
const report={observed_at:new Date().toISOString(),status:'APPLYING',authorization:'Specific owner approval for the two public Google origin values',target,changed_keys:envKeys,other_env_values_unchanged:true,env_backup_private:true,configuration_only:true,db_writes:0,real_provider_verification:'NOT_RUN',google_public_login:'NOT_RUN',before_profiles:baseline.profiles,before_env_sha256:sha(before),after_env_sha256:sha(Buffer.from(after)),build_log_private:true};
const path='docs/audits/evidence/2026-11-16-google-public-apply.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n');
const run=spawnSync('powershell.exe',['-NoProfile','-File','scripts/start-encrypted-stack.ps1','-Build','-Services','backend'],{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:24*1024*1024});
writeFileSync(dir+'/build.log',(run.stdout||'')+'\n'+(run.stderr||''));report.build_exit=run.status;report.build_error=run.error?.code||null;
const container=JSON.parse(execFileSync('docker',['inspect','uasspain-backend'],{encoding:'utf8',windowsHide:true}))[0];const runtime=Object.fromEntries(container.Config.Env.map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
report.runtime_matches=envKeys.every(k=>runtime[k]===target);report.container_id=container.Id;report.image_id=container.Image;report.backend_health=container.State.Health?.Status;
const current=state();report.profiles_after=current.profiles;report.identities_credentials_links_unchanged=current.identity===baseline.identity;report.provider_secrets_unchanged=current.secrets===baseline.secrets;report.google_database_setting_unchanged=current.google===baseline.google;
report.status=run.status===0&&report.runtime_matches&&report.backend_health==='healthy'&&report.identities_credentials_links_unchanged&&report.provider_secrets_unchanged&&report.google_database_setting_unchanged?'PASS_CONFIGURATION_PENDING_REAL_VERIFICATION':'BLOCKED';
report.completed_at=new Date().toISOString();writeFileSync(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(report.status==='BLOCKED')process.exitCode=1;
