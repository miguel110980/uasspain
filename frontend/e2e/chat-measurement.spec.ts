import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { concurrentFixtures } from '../../scripts/e2e/concurrent-fixtures.mjs';

test('@private-chat-measurement measures real delivery latency and history requests per message', async ({ browser }) => {
  const seed=await concurrentFixtures(8);
  const contexts=await Promise.all([1,4,6].map(()=>browser.newContext({viewport:{width:1440,height:1000}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  const phase=process.env.E2E_AUDIT_BEFORE==='true'?'before':'after';
  const requests: string[]=[], latency:number[]=[], perMessage:number[]=[], apiPerMessage:number[]=[];
  const apiRequests:{method:string;path:string}[]=[];
  const bubble=(page:Page,text:string)=>page.locator('p.whitespace-pre-wrap').and(page.getByText(text,{exact:true}));
  try {
    for(const [i,page] of pages.entries()) {
      await page.addInitScript(()=>{
        const observed=window as Window & {auditSockets:WebSocket[]};observed.auditSockets=[];
        const Socket=window.WebSocket;
        window.WebSocket=class extends Socket {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);observed.auditSockets.push(this);}};
      });
      const f=seed.fixtures[[1,4,6][i]];
      await page.goto('/?auth=login');
      await page.getByLabel('Correo electrónico *',{exact:true}).fill(f.email);
      await page.getByLabel('Contraseña *',{exact:true}).fill(f.password);
      await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
      await expect(page.locator('header h1')).toHaveText('Dashboard');
      await page.locator('aside:visible nav').getByRole('button',{name:'Chat',exact:true}).click();
    }
    const [teacher,first,second]=pages;
    for(const i of [4,6]) await teacher.locator('main button').filter({has:teacher.getByText(`Concurrent ${i}`,{exact:true})}).filter({visible:true}).click();
    const room=teacher.getByRole('region',{name:'Conversación con Concurrent 4',exact:true});
    await expect(room).toBeVisible();
    await teacher.waitForTimeout(1200);
    for(const page of pages) page.on('request',r=>{
      const path=new URL(r.url()).pathname;
      if(path.startsWith('/api/'))apiRequests.push({method:r.method(),path});
      if(r.method()==='GET'&&path==='/api/mensajes/')requests.push(r.url());
    });
    for(let i=0;i<6;i++) {
      const text=`delivery measurement ${i} ${Date.now()}`;
      await room.getByPlaceholder('Escribe un mensaje...').fill(text);
      const start=Date.now(),previous=requests.length,previousApi=apiRequests.length;
      await room.getByRole('button',{name:'Enviar mensaje',exact:true}).click();
      await expect(bubble(first,text)).toHaveCount(1,{timeout:5000});
      await expect(room.getByText(text,{exact:true})).toHaveCount(1);
      await expect(bubble(second,text)).toHaveCount(0);
      latency.push(Date.now()-start);
      await teacher.waitForTimeout(250);
      perMessage.push(requests.length-previous);
      apiPerMessage.push(apiRequests.length-previousApi);
    }
    const sockets=await Promise.all(pages.map(page=>page.evaluate(()=>(window as Window&{auditSockets:WebSocket[]}).auditSockets.filter(s=>s.readyState===WebSocket.OPEN).map(s=>new URL(s.url).pathname))));
    const sorted=[...latency].sort((a,b)=>a-b);
    const percentile=(p:number)=>sorted[Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1)];
    const endpoints=apiRequests.reduce<Record<string,number>>((totals,r)=>{const key=`${r.method} ${r.path}`;totals[key]=(totals[key]||0)+1;return totals;},{});
    const report={phase,backend:'current isolated Rust API in both phases',frontend:phase==='before'?'acc7878':'working tree',messages:6,apiRequests:apiRequests.length,apiRequestsPerMessage:apiPerMessage,endpoints,historyRequests:requests.length,historyRequestsPerMessage:perMessage,deliveryP50Ms:percentile(.5),deliveryP95Ms:percentile(.95),deliveryP99Ms:percentile(.99),latencyMs:latency,sockets,duplicates:0,crossChannelMessages:0};
    mkdirSync('../.run/concurrency-audit',{recursive:true});
    writeFileSync(`../.run/concurrency-audit/chat-browser-metrics-${phase}.json`,JSON.stringify(report,null,2));
    if(phase==='after')expect(perMessage).toEqual(Array(6).fill(0));
  } finally {await Promise.all(contexts.map(c=>c.close()));await seed.cleanup();}
});
