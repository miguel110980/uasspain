// Disposable authenticated SMTP receiver. It never forwards mail or logs
// credentials/customer content. Use only on the isolated E2E network.
import net from 'node:net';
import tls from 'node:tls';
import {readFile,writeFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const secureContext=tls.createSecureContext({cert:await readFile('/keys/cert.pem'),key:await readFile('/keys/key.pem'),minVersion:'TLSv1.2'});
const password=process.env.FIXTURE_SMTP_PASSWORD;
if(!password)throw Error('Fixture password missing');
function connection(initial){
 let socket=initial,buffer='',data=false,lines=[],authenticated=false,authStep=0,username='',sender='',recipients=[];
 const reply=text=>socket.write(text+'\r\n');
 const attach=current=>{current.on('error',e=>{console.log('FIXTURE_SOCKET_ERROR '+e.code);current.destroy();});current.on('data',chunk=>{buffer+=chunk.toString();let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);void command(line);}});};
 async function command(line){
  if(data){if(line!=='.'){lines.push(line.startsWith('..')?line.slice(1):line);return;}data=false;
   let reject=false;try{await access('/out/reject');reject=true;}catch{}
   if(reject){reply('554 5.7.1 Fixture delivery rejected');return;}
   await writeFile('/out/'+randomUUID()+'.json',JSON.stringify({tls:!!socket.encrypted,sender,recipients,raw:lines.join('\r\n')+'\r\n'}));reply('250 2.0.0 Fixture mailbox accepted');return;
  }
  if(authStep){if(authStep===1){username=Buffer.from(line,'base64').toString();authStep=2;reply('334 UGFzc3dvcmQ6');return;}authenticated=username==='contact-fixture'&&Buffer.from(line,'base64').toString()===password;authStep=0;reply(authenticated?'235 2.7.0 Authentication successful':'535 5.7.8 Authentication failed');return;}
  const [verb,...args]=line.split(' '),value=args.join(' ');console.log('FIXTURE_COMMAND '+verb);
  if(['EHLO','HELO'].includes(verb)){reply(socket.encrypted?'250-contact-smtp-e2e\r\n250 AUTH PLAIN LOGIN':'250-contact-smtp-e2e\r\n250 STARTTLS');}
  else if(verb==='STARTTLS'&&!socket.encrypted){reply('220 2.0.0 Begin TLS');socket.removeAllListeners('data');socket=new tls.TLSSocket(socket,{isServer:true,secureContext});attach(socket);}
  else if(verb==='AUTH'&&socket.encrypted){if(value.startsWith('PLAIN ')){const parts=Buffer.from(value.slice(6),'base64').toString().split('\0');authenticated=parts.at(-2)==='contact-fixture'&&parts.at(-1)===password;reply(authenticated?'235 2.7.0 Authentication successful':'535 5.7.8 Authentication failed');}else if(value==='LOGIN'){authStep=1;reply('334 VXNlcm5hbWU6');}else reply('504 Unsupported fixture authentication');}
  else if(verb==='MAIL'&&authenticated){sender=value.replace(/^FROM:/,'');recipients=[];reply('250 Sender accepted');}
  else if(verb==='RCPT'&&authenticated){recipients.push(value.replace(/^TO:/,''));reply('250 Recipient accepted');}
  else if(verb==='DATA'&&authenticated){lines=[];data=true;reply('354 End with dot');}
  else if(verb==='RSET'){data=false;lines=[];sender='';recipients=[];reply('250 Reset');}
  else if(verb==='NOOP'){reply('250 OK');}
  else if(verb==='QUIT'){reply('221 Bye');socket.end();}
  else reply('530 Authentication and TLS required');
 }
 attach(socket);reply('220 contact-smtp-e2e ESMTP');
}
net.createServer(connection).listen(2525,'0.0.0.0',()=>console.log('ISOLATED_CONTACT_SMTP_READY'));
