import {expect, test, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const accounts={
  admin:['e2e-admin@test.local','E2eAdmin_2026!'], // pragma: allowlist secret - isolated fixture
  instructor:['instructor.e2e@test.local','E2eInstr_2026!'], // pragma: allowlist secret - isolated fixture
  alumno:['alumno.e2e@test.local','E2ePass_2026!'], // pragma: allowlist secret - isolated fixture
};
async function login(page:Page, role:keyof typeof accounts){
  await page.goto('/?auth=login');await page.locator('#login-email').fill(accounts[role][0]);
  await page.locator('#login-password').fill(accounts[role][1]);
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${role}$`));
}
async function call(page:Page,path:string,method='GET',payload?:unknown){
  return page.evaluate(async({path,method,payload})=>{
    const windowId=sessionStorage.getItem('uasspain.window_session_id');
    const response=await fetch(path,{method,headers:{'Content-Type':'application/json','X-UASSpain-Window-Id':windowId||''},body:payload===undefined?undefined:JSON.stringify(payload)});
    return {status:response.status,body:response.status===204?null:await response.json()};
  },{path,method,payload});
}

test('@instructor-access unified grants synchronize panels and report partial failures',async({browser,baseURL},testInfo)=>{
  test.setTimeout(150_000);
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({baseURL,ignoreHTTPSErrors:Boolean(process.env.E2E_BROWSER_ORIGIN),viewport:{width:1440,height:1000}})));
  const [teacher,student,admin]=await Promise.all(contexts.map(c=>c.newPage()));
  const resources:Array<{path:string,id:string}>=[];
  try{
    await login(admin,'admin');await login(teacher,'instructor');await login(student,'alumno');
    const pupil=(await call(student,'/api/auth/me/')).body;expect(pupil.id).toBeTruthy();
    const suffix=crypto.randomUUID();
    for(let i=0;i<2;i++){
      const created=await call(admin,'/api/materiales/','POST',{titulo:`TEMP browser bulk ${i} ${suffix}`,categoria:'A1/A3',tipo:'pdf',activo:true,descripcion:'Synthetic bulk persistence check'});
      expect(created.status).toBe(201);resources.push({path:'/api/materiales/',id:created.body.id});
    }
    const exam=await call(teacher,'/api/examenes/','POST',{nombre:`TEMP browser exam ${suffix}`,categoria:'A1/A3',activo:true,num_preguntas:1});
    expect(exam.status).toBe(201);resources.push({path:'/api/examenes/',id:exam.body.id});
    const nav=(page:Page,name:string)=>page.locator('aside:visible nav').getByRole('button',{name,exact:true}).click();
    await nav(teacher,'Alumnos');
    const row=teacher.getByRole('row').filter({hasText:accounts.alumno[0]});
    await expect(row.getByRole('button',{name:'Exámenes',exact:true})).toHaveCount(0);
    await row.getByRole('button',{name:'Gestionar accesos',exact:true}).click();
    const dialog=teacher.getByRole('dialog'),items=resources.slice(0,2).map(r=>dialog.locator(`[data-resource-id="${r.id}"]`));
    for(const item of items){await expect(item).toBeVisible();await item.getByRole('checkbox').check();}
    await dialog.getByRole('button',{name:'Revocar seleccionados',exact:true}).click();
    for(const item of items)await expect(item.getByRole('button')).toHaveAttribute('aria-label',/^Conceder/);
    const persisted=(await call(admin,`/api/instructor/access/${pupil.id}/`)).body.materiales;
    for(const item of resources.slice(0,2))expect(persisted.find(m=>m.id===item.id).acceso).toBe(false);
    await nav(student,'Material');
    for(let i=0;i<2;i++)await expect(student.getByText(`TEMP browser bulk ${i} ${suffix}`,{exact:true})).toHaveCount(0);
    for(const item of items)await item.getByRole('checkbox').check();
    await dialog.getByRole('button',{name:'Conceder seleccionados',exact:true}).click();
    for(let i=0;i<2;i++)await expect(student.getByText(`TEMP browser bulk ${i} ${suffix}`,{exact:true})).toBeVisible({timeout:22_000});
    for(const item of items)await item.getByRole('checkbox').check();
    let mutations=0;
    await teacher.route('**/api/instructor/access/toggle/',async route=>{
      mutations++;if(mutations===2)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Isolated second-write failure'})});else await route.continue();
    });
    await dialog.getByRole('button',{name:'Revocar seleccionados',exact:true}).click();
    await expect(dialog.getByText(/1 recurso\(s\) guardado\(s\)/)).toBeVisible();
    await expect(items[0].getByRole('button')).toHaveAttribute('aria-label',/^Conceder/);
    await expect(items[1].getByRole('button')).toHaveAttribute('aria-label',/^Revocar/);
    await teacher.unroute('**/api/instructor/access/toggle/');
    await dialog.getByRole('button',{name:'Actualizar permisos',exact:true}).click();
    for(const theme of ['light','dark']){
      await teacher.evaluate(theme=>{document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(theme);},theme);
      for(const width of [320,768,1440]){
        await teacher.setViewportSize({width,height:1000});await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      }
      await dialog.evaluate(el=>el.setAttribute('data-access-audit','true'));
      const audit=await new AxeBuilder({page:teacher}).include('[data-access-audit]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      expect(audit.violations).toEqual([]);
      await teacher.screenshot({path:testInfo.outputPath(`access-${theme}.png`),fullPage:true});
    }
    await dialog.getByRole('button',{name:'Exámenes',exact:true}).click();
    const examItem=dialog.locator(`[data-resource-id="${exam.body.id}"]`);
    await examItem.getByRole('button').click();
    await nav(student,'Exámenes');await expect(student.getByText(exam.body.nombre,{exact:true})).toHaveCount(0);
    await examItem.getByRole('button').click();
    await expect(student.getByText(exam.body.nombre,{exact:true})).toBeVisible({timeout:22_000});
    await examItem.getByRole('button').click();
    await expect(student.getByText(exam.body.nombre,{exact:true})).toHaveCount(0,{timeout:22_000});
    await teacher.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await expect(row.getByRole('button',{name:'Gestionar accesos',exact:true})).toBeFocused();
  }finally{
    try{
      for(const resource of resources){
        // These resource UUIDs were created in this test; remove only their permissions.
        const path=resource.path==='/api/materiales/'?'/api/permisos-acceso-material/':'/api/bloqueos-examen/';
        const key=resource.path==='/api/materiales/'?'material_id':'examen_id';
        const permissionRows=await call(admin,path+`?${key}=${resource.id}`);expect(permissionRows.status).toBe(200);
        for(const permission of permissionRows.body){const removed=await call(admin,path+permission.id+'/','DELETE');expect(removed.status).toBe(204);}
        const response=await call(admin,resource.path+resource.id+'/','DELETE');expect([204,404]).toContain(response.status);
      }
    }finally{for(const context of contexts)await context.close();}
  }
});

test('@instructor-access late connection totals cannot replace newer navigation totals',async({page})=>{
  const connections:Array<{send:(message:string)=>void}>=[];
  await page.routeWebSocket(/\/ws\/conexiones\//,socket=>{
    socket.connectToServer();connections.push(socket);
  });
  await login(page,'instructor');
  await expect(page.locator('header h1')).toHaveText('Dashboard');
  const totals=await call(page,'/api/dashboard/counts/');expect(totals.status).toBe(200);
  await expect.poll(()=>connections.length).toBeGreaterThan(0);
  let releaseOld:()=>void=()=>{};
  const oldPending=new Promise<void>(resolve=>{releaseOld=resolve;});
  let requests=0;
  await page.route('**/api/dashboard/counts/',async route=>{
    const old=++requests===1;
    if(old)await oldPending;
    await route.fulfill({status:200,json:{...totals.body,students:old?313:919}});
  });
  try{
    // Keep the real socket; inject only the event which triggers this refresh.
    connections[0].send(JSON.stringify({type:'conexion'}));
    await expect.poll(()=>requests).toBe(1);
    await page.locator('aside:visible nav').getByRole('button',{name:'Dashboard',exact:true}).click();
    const card=page.locator('main p').filter({hasText:/^Alumnos$/}).locator('..');
    await expect(card.getByText('919',{exact:true})).toBeVisible();
    const late=page.waitForResponse(async response=>response.url().endsWith('/api/dashboard/counts/')&&response.status()===200&&(await response.json()).students===313);
    releaseOld();await late;
    await page.waitForTimeout(250);
    await expect(card.getByText('919',{exact:true})).toBeVisible();
    await expect(card.getByText('313',{exact:true})).toHaveCount(0);
  }finally{releaseOld();}
});
