/** Source candidate links prevent blindly rerunning old suites; these are not PASS. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),ts=createRequire(resolve(root,'frontend/package.json'))('typescript');
function parse(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if(ch==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=ch}if(cell||row.length){row.push(cell);rows.push(row)}const columns=rows.shift();return{columns,rows:rows.map(v=>Object.fromEntries(columns.map((c,i)=>[c,v[i]||''])))}}
const csv=(rows,columns)=>{const q=x=>'"'+String(x??'').replaceAll('"','""')+'"';return[columns.map(q).join(','),...rows.map(r=>columns.map(c=>q(r[c])).join(','))].join('\n')+'\n'};
const walk=path=>readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path+'/'+x.name):[path+'/'+x.name]);
const sources=[...walk('scripts/e2e').filter(x=>x.endsWith('.mjs')),...walk('frontend/src').filter(x=>/\.test\.[jt]sx?$/.test(x))];
const references=[],imports=[];
function literal(node){if(!node)return null;if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;if(ts.isTemplateExpression(node))return node.head.text+node.templateSpans.map(s=>'{value}'+s.literal.text).join('');return null}
const canonical=path=>path.replace(/\{[^}]+\}/g,'{value}').replace(/\?.*$/,'').replace(/\/$/,'');
for(const path of sources){const text=readFileSync(resolve(root,path),'utf8'),source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.JS);function visit(node){
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
  const fn=node.expression.name.text,url=literal(node.arguments[0]);let method=fn==='call'?(literal(node.arguments[1])||(!node.arguments[1]?'GET':null)):['get','post','put','patch','delete','head','options'].includes(fn)?fn.toUpperCase():null;
  if(url?.startsWith('/api/')&&method&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method))references.push({path,method,url:canonical(url),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
 }
 if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){const spec=node.moduleSpecifier.text;if(spec.startsWith('.')||spec.startsWith('@/')){const target=spec.startsWith('@/')?resolve(root,'frontend/src',spec.slice(2)):resolve(root,dirname(path),spec);imports.push({path,target:target.replaceAll('\\','/')})}}
 ts.forEachChild(node,visit)}visit(source)}
const apiPath=resolve(root,'docs/audits/2026-11-16-api-actual.csv'),api=parse(readFileSync(apiPath,'utf8'));
for(const row of api.rows){const links=references.filter(x=>x.method===row.method&&x.url===canonical(row.path));row.candidate_test_sources=[...new Set(links.map(x=>x.path+':'+x.line))].join(';');row.candidate_test_scope='Static literal/template endpoint reference only; not a test execution or complete role/branch coverage'}
const controlsPath=resolve(root,'docs/audits/2026-11-16-controles-actuales.csv'),controls=parse(readFileSync(controlsPath,'utf8'));
for(const row of controls.rows){const target=resolve(root,row.source).replaceAll('\\','/').replace(/\.[jt]sx?$/,'');row.candidate_test_sources=[...new Set(imports.filter(x=>x.target.replace(/\.[jt]sx?$/,'')===target).map(x=>x.path))].join(';');row.candidate_test_scope='Static direct test import of component only; not a PASS for this control or its variants'}
for(const [path,table]of[[apiPath,api],[controlsPath,controls]]){const columns=[...table.columns.filter(x=>!['candidate_test_sources','candidate_test_scope'].includes(x)),'candidate_test_sources','candidate_test_scope'];writeFileSync(path,csv(table.rows,columns))}
console.log(JSON.stringify({test_sources:sources.length,endpoint_references:references.length,api_entries_with_candidates:api.rows.filter(x=>x.candidate_test_sources).length,control_occurrences_with_candidate_import:controls.rows.filter(x=>x.candidate_test_sources).length,execution_statuses_preserved:true}));
