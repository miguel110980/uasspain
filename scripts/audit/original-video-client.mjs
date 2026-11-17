import https from 'node:https';
import {rootCertificates,checkServerIdentity} from 'node:tls';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';

export const publicHost='uasspain-prueba.duckdns.org';
export const originalOrigin=`https://${publicHost}`;
export function preservedAccount(email){
  let accounts;
  try {accounts=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File','.run/backend-audit-20261023/load-authorized-accounts.ps1'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));}
  catch {throw Error('Protected instructor account unavailable; sensitive output withheld');}
  const account=accounts.find(a=>a.email===email);if(!account)throw Error('Preserved account missing');return account;
}
export const preservedInstructor=()=>preservedAccount('instructor.prueba@example.invalid');
export function originalVideoClient(){
  const jar=new Map(),windowId=randomUUID();
  return {windowId,async socketStatus(callId){
    if(!/^[0-9a-f-]{36}$/.test(callId))throw Error('Invalid call identifier');
    return new Promise((resolve,reject)=>{
      const request=https.request({hostname:'192.168.1.34',servername:publicHost,path:`/ws/videollamada/${callId}/?window_id=${windowId}`,ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(publicHost,cert),headers:{Host:publicHost,Origin:originalOrigin,Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}},response=>{response.resume();resolve(response.statusCode);});
      request.on('upgrade',(response,socket)=>{socket.end();resolve(response.statusCode);});request.setTimeout(10000,()=>request.destroy(Error('TIMEOUT')));request.on('error',reject);request.end();
    });
  },async call(path,method='GET',data){
    if(!path.startsWith('/api/auth/')&&!path.startsWith('/api/videollamadas/'))throw Error('Outside video inspection scope');
    return new Promise((resolve,reject)=>{
      const body=data===undefined?null:JSON.stringify(data);
      const req=https.request({hostname:'192.168.1.34',servername:publicHost,path,method,ca:rootCertificates,rejectUnauthorized:true,checkServerIdentity:(_name,cert)=>checkServerIdentity(publicHost,cert),headers:{Host:publicHost,Origin:originalOrigin,'X-UASSpain-Window-Id':windowId,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},res=>{
        for(const item of res.headers['set-cookie']??[]){const pair=item.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{let json=null;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}resolve({status:res.statusCode,body:json});});
      });req.setTimeout(15000,()=>req.destroy(Error('TIMEOUT')));req.on('error',reject);if(body)req.write(body);req.end();
    });
  }};
}
export async function loginOriginalInstructor(actor){
  const account=preservedInstructor();
  const context=await actor.call('/api/auth/context/','POST',{});if(context.status!==200)throw Error('Original context unavailable');
  const login=await actor.call('/api/auth/login/','POST',{email:account.email,password:account.password});if(login.status!==200)throw Error('Original instructor login unavailable');
  const me=await actor.call('/api/auth/me/');if(me.status!==200||me.body.session_role!=='instructor')throw Error('Instructor identity mismatch');return me.body;
}
