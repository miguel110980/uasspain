import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { concurrentFixtures, loginFixture } from '../../scripts/e2e/concurrent-fixtures.mjs';
import { backend, postgres, sql } from '../../scripts/e2e/auth-fixtures.mjs';

type Observed = Window & { auditSockets: WebSocket[] };
const binding = (page: Page) => page.evaluate(() => sessionStorage.getItem('uasspain.window_session_id') || '');
const nav = (page: Page) => page.locator('aside:visible nav');
const bubble = (page:Page,text:string) => page.locator('p.whitespace-pre-wrap').and(page.getByText(text,{exact:true}));

test('@private-channel-regression student exports and clears only the authorized conversation',async({browser})=>{
  const seed=await concurrentFixtures(8),contexts=[];
  try {
    const teacher=await loginFixture(seed.fixtures[1]);
    for(const i of [3,4])sql(`UPDATE accounts_userprofile SET assigned_instructor_id='${seed.fixtures[1].id}' WHERE id='${seed.fixtures[i].id}'`);
    const ownText='OWN-EXPORT-'+seed.fixtures[3].id,foreignText='OTHER-EXPORT-'+seed.fixtures[4].id;
    for(const [i,text] of [[3,ownText],[4,foreignText]] as const)expect((await teacher.call('/api/mensajes/','POST',{alumno_id:seed.fixtures[i].id,contenido:text})).status).toBe(201);
    const pages=[];
    for(const i of [3,4]){
      const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);
      await page.goto('/?auth=login');await page.locator('#login-email').fill(seed.fixtures[i].email);await page.locator('#login-password').fill(seed.fixtures[i].password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page.locator('header h1')).toHaveText('Dashboard');await nav(page).getByRole('button',{name:'Chat',exact:true}).click();
    }
    const [a,b]=pages;await expect(bubble(a,ownText)).toHaveCount(1);await expect(bubble(b,foreignText)).toHaveCount(1);
    const downloadPromise=a.waitForEvent('download');await a.getByRole('button',{name:'Exportar conversación a PDF',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.pdf$/);const pdf=readFileSync((await download.path())!);expect(pdf.subarray(0,4).toString()).toBe('%PDF');expect(pdf.toString('latin1')).toContain(ownText);expect(pdf.toString('latin1')).not.toContain(foreignText);
    expect((await a.request.get(`/api/mensajes/?alumno_id=${seed.fixtures[4].id}`,{headers:{Origin:new URL(a.url()).origin,'X-UASSpain-Window-Id':await binding(a)}})).status()).toBe(403);
    await a.getByRole('button',{name:'Limpiar conversación',exact:true}).click();const confirmation=a.getByRole('dialog',{name:'Limpiar chat',exact:true});await expect(confirmation).toBeVisible();await confirmation.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(bubble(a,ownText)).toHaveCount(1);
    await a.getByRole('button',{name:'Limpiar conversación',exact:true}).click();await confirmation.getByRole('button',{name:'Limpiar chat',exact:true}).click();await expect(confirmation).toHaveCount(0);await expect(bubble(a,ownText)).toHaveCount(0);await expect(bubble(b,foreignText)).toHaveCount(1);await a.reload();await nav(a).getByRole('button',{name:'Chat',exact:true}).click();await expect(bubble(a,ownText)).toHaveCount(0);
    expect((await teacher.call(`/api/mensajes/?alumno_id=${seed.fixtures[3].id}`)).body).toEqual([]);expect((await teacher.call(`/api/mensajes/?alumno_id=${seed.fixtures[4].id}`)).body.some(m=>m.contenido===foreignText)).toBe(true);
  }finally{await Promise.all(contexts.map(c=>c.close()));await seed.cleanup();}
});

test('@private-channel-regression an unassigned student sees the real state and cannot send',async({page})=>{
  const seed=await concurrentFixtures(8);
  try {
    const f=seed.fixtures[3];
    sql(`UPDATE accounts_userprofile SET assigned_instructor_id=NULL WHERE id='${f.id}'`);
    const sockets:string[]=[];
    page.on('websocket',socket=>sockets.push(new URL(socket.url()).pathname));
    await page.goto('/?auth=login');
    await page.getByLabel('Correo electrónico *',{exact:true}).fill(f.email);
    await page.getByLabel('Contraseña *',{exact:true}).fill(f.password);
    await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await expect(page.locator('header h1')).toHaveText('Dashboard');
    await nav(page).getByRole('button',{name:'Chat',exact:true}).click();
    await expect(page.getByText('Aún no tienes un instructor asignado.',{exact:true})).toBeVisible();
    await expect(page.getByPlaceholder('Escribe un mensaje...')).toBeDisabled();
    await expect(page.getByRole('button',{name:'Enviar mensaje',exact:true})).toBeDisabled();
    expect(sockets.some(path=>path.startsWith('/ws/chat/'))).toBe(false);
  } finally {await seed.cleanup();}
});

test('@private-channel-regression ten open rooms retain drafts, private delivery, scroll and recover after outages', async ({ browser }) => {
  test.setTimeout(300_000);
  const seed = await concurrentFixtures(13);
  const students = seed.fixtures.slice(3);
  for (const f of students) sql(`UPDATE accounts_userprofile SET role='alumno',roles='["alumno"]',assigned_instructor_id='${seed.fixtures[1].id}' WHERE id='${f.id}'`);
  const contexts = await Promise.all([1,3,4,5].map(() => browser.newContext({ viewport:{width:1440,height:1000} })));
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const errors: string[] = [], latency: number[] = [], historyCalls: string[] = [];
  const wire: {page:number;path:string;type:string;room:string;id?:string}[]=[];
  const report = { rooms:10, independentContexts:4, messages:0, crossChannelMessages:0, duplicates:0, historyRequestsPerDelivery:0, privateSockets:0, offlineSeconds:5, backendRecovery:false, redisRecovery:false, scrollPreserved:false, reassignmentUpdatesIdentity:false, errors, latency, wire };
  const call = async (page:Page,path:string,method='GET',data?:unknown) => page.request.fetch(path, { method,data,headers:{Origin:new URL(page.url()).origin,'X-UASSpain-Window-Id':await binding(page)} });
  const post = async (room:number,content:string) => {
    const response = await call(pages[0],'/api/mensajes/','POST',{alumno_id:students[room].id,contenido:content});
    expect(response.status()).toBe(201); report.messages++; return response.json();
  };
  try {
    for (const [i,page] of pages.entries()) {
      page.on('pageerror', e => errors.push(e.message));
      page.on('websocket',socket=>socket.on('framereceived',frame=>{
        try {const data=JSON.parse(String(frame.payload));if(data.room_id)wire.push({page:i,path:new URL(socket.url()).pathname,type:data.type,room:data.room_id,id:data.data?.id});}catch{/* Non-JSON heartbeat. */}
      }));
      await page.addInitScript(() => {
        const observed = window as Observed; observed.auditSockets=[];
        const Socket=window.WebSocket;
        window.WebSocket=class extends Socket { constructor(url:string|URL,protocols?:string|string[]) { super(url,protocols);observed.auditSockets.push(this); } };
      });
      const f=seed.fixtures[[1,3,4,5][i]];
      await page.goto('/?auth=login');
      await page.getByLabel('Correo electrónico *',{exact:true}).fill(f.email);
      await page.getByLabel('Contraseña *',{exact:true}).fill(f.password);
      await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
      await expect(page.locator('header h1')).toHaveText('Dashboard');
    }
    const [teacher,...learners]=pages;
    // Real persisted history makes manual scrolling meaningful.
    for(let i=0;i<35;i++) await post(0,`history ${i} ${'Contenido de prueba '.repeat(5)}`);
    for(const page of pages) await nav(page).getByRole('button',{name:'Chat',exact:true}).click();
    for(const f of students) await teacher.locator('main button').filter({has:teacher.getByText(`Concurrent ${seed.fixtures.indexOf(f)}`,{exact:true})}).filter({visible:true}).click();
    const room=(i:number)=>teacher.getByRole('region',{name:`Conversación con Concurrent ${i+3}`,exact:true});
    for(let i=0;i<10;i++) {
      await expect(room(i)).toBeVisible();
      await room(i).getByPlaceholder('Escribe un mensaje...').fill(`Draft ${i}`);
    }
    await expect.poll(()=>teacher.evaluate(()=>(window as Observed).auditSockets.filter(s=>s.readyState===WebSocket.OPEN&&new URL(s.url).pathname.startsWith('/ws/chat/')).length)).toBe(10);
    report.privateSockets=10;
    await room(0).scrollIntoViewIfNeeded();
    for(const page of pages) page.on('request',r=>{if(r.method()==='GET'&&new URL(r.url()).pathname==='/api/mensajes/')historyCalls.push(r.url());});
    await teacher.waitForTimeout(600);
    historyCalls.length=0;
    const marker=`private DOM ${Date.now()}`;
    const started=Date.now(); await post(0,marker);
    await expect(bubble(learners[0],marker)).toHaveCount(1);
    await expect(room(0).getByText(marker,{exact:true})).toHaveCount(1);
    latency.push(Date.now()-started);
    for(const other of [room(1),room(2),learners[1],learners[2]]) await expect(other.getByText(marker,{exact:true})).toHaveCount(0);
    report.historyRequestsPerDelivery=historyCalls.length;
    expect(historyCalls).toEqual([]);
    for(let i=0;i<10;i++) await expect(room(i).getByPlaceholder('Escribe un mensaje...')).toHaveValue(`Draft ${i}`);
    // Sending in one room must not consume the drafts of the other nine.
    await room(1).getByRole('button',{name:'Enviar mensaje',exact:true}).click();
    await expect(bubble(learners[1],'Draft 1')).toHaveCount(1);
    for(const i of [0,2,3,4,5,6,7,8,9]) await expect(room(i).getByPlaceholder('Escribe un mensaje...')).toHaveValue(`Draft ${i}`);
    const scroll=room(0).locator('div.overflow-y-auto');
    await scroll.evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll'));});
    const scrollTop=await scroll.evaluate(node=>node.scrollTop);
    expect((await call(learners[0],'/api/mensajes/','POST',{contenido:'manual scroll fixture'})).status()).toBe(201);
    report.messages++;
    await expect(room(0).getByText('manual scroll fixture',{exact:true})).toHaveCount(1);
    expect(await scroll.evaluate(node=>node.scrollTop)).toBeLessThanOrEqual(scrollTop+2);
    await expect(room(0).getByRole('button',{name:/nuevo mensaje/})).toBeVisible();
    report.scrollPreserved=true;
    mkdirSync('../.run/concurrency-audit',{recursive:true});
    await teacher.screenshot({path:'../.run/concurrency-audit/private-rooms.png',fullPage:true});
    await learners[0].context().setOffline(true);
    await new Promise(resolve=>setTimeout(resolve,5000));
    await post(0,'offline catch-up fixture');
    await learners[0].context().setOffline(false);
    await expect(bubble(learners[0],'offline catch-up fixture')).toHaveCount(1,{timeout:20000});
    // Both container IDs were verified against the disposable project by the
    // fixture module. No main-stack container or volume is touched.
    expect(execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',backend],{encoding:'utf8'}).trim()).toBe('uasspain-e2e');
    execFileSync('docker',['restart','--time','1',backend],{stdio:'pipe'});
    await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:8010/api/health/ready/')).status;}catch{return 0;}},{timeout:60000}).toBe(200);
    await post(0,'backend recovery fixture');
    await expect(bubble(learners[0],'backend recovery fixture')).toHaveCount(1,{timeout:20000});
    report.backendRecovery=true;
    const redis=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}','uasspain-e2e-redis-e2e-1'],{encoding:'utf8'}).trim();
    expect(redis).toBe('uasspain-e2e');
    try {
      execFileSync('docker',['stop','--time','1','uasspain-e2e-redis-e2e-1'],{stdio:'pipe'});
      await post(0,'redis outage fixture');
      await expect(bubble(learners[0],'redis outage fixture')).toHaveCount(1,{timeout:15000});
    } finally { execFileSync('docker',['start','uasspain-e2e-redis-e2e-1'],{stdio:'pipe'}); }
    await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:8010/api/health/ready/')).status;}catch{return 0;}},{timeout:60000}).toBe(200);
    await post(0,'redis recovery fixture');
    await expect(bubble(learners[0],'redis recovery fixture')).toHaveCount(1,{timeout:15000});
    report.redisRecovery=true;
    expect((await seed.admin.call(`/api/profiles/${seed.fixtures[2].id}/assign-alumnos/`,'POST',{student_ids:[students[0].id]})).status).toBe(200);
    // The dashboard section stays mounted (hidden) and repeats the instructor
    // name, so the chat contact is matched by its own paragraph classes.
    await expect(learners[0].locator('p.text-foreground.truncate:text-is("Concurrent 2")')).toBeVisible();
    await expect(room(0)).toHaveCount(0);
    expect((await call(teacher,`/api/mensajes/?alumno_id=${students[0].id}`)).status()).toBe(403);
    const replacement=await loginFixture(seed.fixtures[2]);
    expect((await replacement.call('/api/mensajes/','POST',{alumno_id:students[0].id,contenido:'reassigned moderator fixture'})).status).toBe(201);
    await expect(bubble(learners[0],'reassigned moderator fixture')).toHaveCount(1,{timeout:5000});
    report.reassignmentUpdatesIdentity=true;
    expect(sql('SELECT current_database()')).toBe('test_e2e_uasspain');
    expect(Boolean(postgres)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(c=>c.close()));
    await seed.cleanup();
    mkdirSync('../.run/concurrency-audit',{recursive:true});
    writeFileSync('../.run/concurrency-audit/private-browser.json',JSON.stringify(report,null,2));
  }
});
