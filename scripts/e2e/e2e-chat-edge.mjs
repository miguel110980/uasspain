import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { request } from 'node:https';
import { root, sleep, check, sql } from './auth-fixtures.mjs';
import { concurrentFixtures, loginFixture } from './concurrent-fixtures.mjs';

const WebSocket=createRequire(resolve(root,'frontend/package.json'))('ws');
const before=process.argv.includes('--before');
const report={phase:before?'before':'after',privateRooms:20,privateSockets:0,globalSockets:0,gates:[],errors:[]};
const sockets=[];
let seed;
const gate=(ok,name)=>{report.gates.push({name,pass:Boolean(ok)});if(!ok&&!before)throw new Error(name);};
async function edgeIdentity(client) {
  return new Promise((resolveStatus,reject)=>{
    const req=request('https://localhost:8444/api/auth/me/',{
      ca:readFileSync(resolve(root,'.secrets/tls/ca.crt')),
      headers:{Origin:'http://localhost:8010','X-UASSpain-Window-Id':client.windowId,Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},
    },response=>{response.resume();resolveStatus(response.statusCode);});
    req.on('error',reject);req.end();
  });
}
async function open(client,path) {
  // Keep below the unchanged five handshakes/second IP rate limit.
  await sleep(300);
  const ws=new WebSocket(`wss://localhost:8444${path}?window_id=${client.windowId}`,{
    origin:'http://localhost:8010',ca:readFileSync(resolve(root,'.secrets/tls/ca.crt')),
    headers:{Cookie:Object.entries(client.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},handshakeTimeout:10000,
  });
  ws.on('error',()=>{});
  return new Promise(resolve=>{
    ws.once('open',()=>{sockets.push(ws);resolve({status:101,ws});});
    ws.once('unexpected-response',(_request,response)=>{resolve({status:response.statusCode});response.resume();ws.terminate();});
    ws.once('error',()=>resolve({status:0}));
  });
}
try {
  seed=await concurrentFixtures(24);
  const teacher=await loginFixture(seed.fixtures[1]);
  const students=seed.fixtures.slice(3);
  for(const f of students)sql(`UPDATE accounts_userprofile SET role='alumno',roles='["alumno"]',assigned_instructor_id='${seed.fixtures[1].id}' WHERE id='${f.id}'`);
  const clients=await Promise.all(students.slice(0,20).map(f=>loginFixture(f)));
  gate((await open(clients[0],`/ws/chat/${students[1].id}/`)).status===403,'edge_rejects_foreign_student_room');
  const global=await open(teacher,'/ws/conexiones/');
  gate(global.status===101,'shared_global_socket_opens');report.globalSockets=global.status===101?1:0;
  for(let i=0;i<20;i++) {
    for(const client of [teacher,clients[i]]) {
      const result=await open(client,`/ws/chat/${students[i].id}/`);
      if(result.status!==101) {report.errors.push(`private socket ${i}: HTTP ${result.status}`);break;}
      report.privateSockets++;
    }
    if(i===0&&!before)gate((await open(teacher,`/ws/chat/${students[0].id}/`)).status===429,'two_connections_per_ip_and_private_room_bound');
    if(report.errors.length)break;
  }
  gate(report.privateSockets===40,'twenty_rooms_and_both_peers_fit_with_shared_global_socket');
  if(!before) {
    gate((await open(teacher,`/ws/chat/${students[20].id}/`)).status===429,'forty_private_connections_per_ip_bound');
    for(let i=1;i<10;i++)gate((await open(teacher,'/ws/conexiones/')).status===101,`global_socket_${i+1}`);
    report.globalSockets=10;
    gate((await open(teacher,'/ws/conexiones/')).status===429,'original_global_connection_bound_preserved');
    gate(await edgeIdentity(teacher)===200,'authenticated_https_remains_available_at_connection_bound');
  }
  console.log(`CHAT_EDGE=${report.gates.filter(g=>g.pass).length}/${report.gates.length}; private=${report.privateSockets}; phase=${report.phase}`);
  if(!before)check(report.errors.length===0,'No unexpected edge errors');
}catch(error){report.errors.push(error.message.split('\n')[0]);process.exitCode=1;console.error('CHAT_EDGE=FAIL: '+report.errors.at(-1));}
finally {
  for(const ws of sockets)ws.terminate();
  if(seed)await seed.cleanup();
  const folder=resolve(root,'.run/concurrency-audit');mkdirSync(folder,{recursive:true});
  writeFileSync(resolve(folder,`chat-edge-${report.phase}.json`),JSON.stringify(report,null,2));
}
