import {test,expect,type Page} from '@playwright/test';
import {verifyPrivateMedia} from '../../scripts/e2e/private-media-acceptance.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {concurrentFixtures} from '../../scripts/e2e/concurrent-fixtures.mjs';
import {sql} from '../../scripts/e2e/auth-fixtures.mjs';

test('@private-channel-regression simultaneous private calls with one instructor keep distinct audio and video',async({browser})=>{
  test.setTimeout(150000);
  const seed=await concurrentFixtures(8),contexts=[];
  const errors:string[]=[],rooms:any[]=[];
  try{
    for(const i of [3,4])sql(`UPDATE accounts_userprofile SET assigned_instructor_id='${seed.fixtures[1].id}' WHERE id='${seed.fixtures[i].id}'`);
    const pages:Page[]=[];
    for(const i of [1,3,4]){
      const context=await browser.newContext({permissions:['camera','microphone']});contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
      await page.goto('/?auth=login');await page.locator('#login-email').fill(seed.fixtures[i].email);await page.locator('#login-password').fill(seed.fixtures[i].password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page.locator('header h1')).toHaveText('Dashboard');
    }
    const [teacher,a,b]=pages,headers={Origin:new URL(teacher.url()).origin,'X-UASSpain-Window-Id':await teacher.evaluate(()=>sessionStorage.getItem('uasspain.window_session_id')||'')};
    for(const i of [3,4]){const response=await teacher.request.post('/api/videollamadas/',{headers,data:{alumno_id:seed.fixtures[i].id,estado:'activa'}});expect(response.status()).toBe(201);rooms.push(await response.json());}
    expect(rooms[0].room_id).not.toBe(rooms[1].room_id);
    // Two genuine RTCPeerConnections in the same authenticated instructor
    // window. Students use the production UI/hook. Inputs are synthetic colors
    // and tones so decoded media, not just signaling, proves room isolation.
    const result=await verifyPrivateMedia({teacher,a,b,rooms,errors});
    mkdirSync('../.run/private-media-isolation',{recursive:true});writeFileSync('../.run/private-media-isolation/result.json',JSON.stringify(result,null,2));
  }finally{
    await Promise.all(contexts.map(c=>c.close()));await seed.cleanup();
  }
});
