import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.env.PUBLIC_RESPONSIVE_ORIGIN || 'https://localhost',dir=process.env.PUBLIC_RESPONSIVE_REPORT || '.run/public-responsive';await mkdir(dir,{recursive:true});
const app=await readFile('frontend/src/App.tsx','utf8');
const routes=[...app.matchAll(/<Route path="([^"]+)" element=\{<(\w+)\s*\/>\}/g)].filter(m=>!m[1].includes('*')&&!m[1].includes(':')&&!m[1].startsWith('/elegir-panel')&&!m[1].startsWith('/restablecer')).map(m=>m[1]);
const sizes=(process.env.PUBLIC_RESPONSIVE_SIZES || '320x568,430x932,768x1024,1024x768,1366x768,1440x900,2560x1080,844x390,3440x1440,3840x2160').split(',').map(v=>v.split('x').map(Number));for(const size of sizes){assert.equal(size.length,2);assert.ok(size.every(n=>Number.isInteger(n) && n>0));}
const report={origin,time:new Date().toISOString(),states:[],errors:[],warnings:[]};const browser=await chromium.launch();
const measure=page=>page.evaluate(()=>{
 const nav=document.querySelector('nav[aria-label="Navegación principal"]'),inner=nav.firstElementChild;
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const s=getComputedStyle(nav);return {nav:box(nav),inner:box(inner),border:parseFloat(s.borderBottomWidth),shadow:s.boxShadow,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,lines:[...document.querySelectorAll('section > .h-px,footer > .h-px')].filter(e=>e.getBoundingClientRect().width>inner.getBoundingClientRect().width*.9).length};
});
try{
 for(const theme of ['dark','light']){
  const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce',viewport:{width:1440,height:900}});await context.addInitScript(t=>localStorage.setItem('theme',t),theme);const page=await context.newPage();
  const version=await (await context.request.get(origin+'/version.json')).json();if(!report.buildId)report.buildId=version.buildId;assert.equal(version.buildId,report.buildId);
  if(theme==='dark'){const response=await context.request.get(origin+'/api/courses');assert.equal(response.status(),200);const courses=await response.json();for(const course of courses)routes.push('/formacion/'+course.slug.split('/').map(encodeURIComponent).join('/'));}
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());if(m.type()==='warning')report.warnings.push(m.text());});
  for(const path of routes){
   await page.goto(origin+path);await page.locator('nav[aria-label="Navegación principal"]').waitFor();await page.locator('h1').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1000);
   for(const [width,height]of sizes){
    await page.setViewportSize({width,height});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(350);const initial=await measure(page);
    assert.equal(initial.nav.width,width,path+' initial header');assert.equal(initial.nav.x,0);assert.equal(initial.overflow,false,path+' overflow');assert.equal(initial.border,0);assert.equal(initial.shadow,'none');assert.equal(initial.lines,0);
    await page.evaluate(()=>scrollTo(0,220));await page.waitForTimeout(350);const scrolled=await measure(page);assert.deepEqual(scrolled.nav,initial.nav,path+' header scroll');assert.deepEqual(scrolled.inner,initial.inner);assert.equal(scrolled.border,0);assert.equal(scrolled.shadow,'none');assert.equal(scrolled.overflow,false);
    if(path==='/'||path==='/contacto'||path==='/nosotros'||path==='/blog'){
     if([320,1440].includes(width)){await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:`${dir}/${theme}-${path.replaceAll('/','_')||'home'}-${width}.png`});}
    }
    if(path==='/'){
     const coverage=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      const art=rect(document.querySelector('.hero-art')),left=rect(document.querySelector('.hero-photo-extension-left')),right=rect(document.querySelector('.hero-photo-extension-right')),top=rect(document.querySelector('.hero-photo-extension-top'));
      return {art,left,right,top,topLeft:rect(document.querySelector('.hero-photo-extension-top-left')),topRight:rect(document.querySelector('.hero-photo-extension-top-right')),viewport:innerWidth,sideBackground:getComputedStyle(document.querySelector('.hero-photo-extension-left'),'::before').backgroundSize,topBackground:getComputedStyle(document.querySelector('.hero-photo-extension-top'),'::before').backgroundSize};
     });
     assert.ok(coverage.art.left<=0||coverage.left.right>=coverage.art.left,'left covered');assert.ok(coverage.art.right>=width||coverage.right.left<=coverage.art.right,'right covered');assert.ok(coverage.top.left<=0||coverage.topLeft.right>=coverage.top.left,'top-left covered');assert.ok(coverage.top.right>=width||coverage.topRight.left<=coverage.top.right,'top-right covered');assert.ok(coverage.top.bottom>=coverage.art.top,'top covered');
    }
    report.states.push({theme,path,width,height,initial,scrolled});
   }
  }
  // A fresh response renders the same header geometry before hydration.
  await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/');await page.locator('nav').waitFor();await page.waitForTimeout(1000);const hydrated=await measure(page);
  const ssr=await browser.newContext({ignoreHTTPSErrors:true,javaScriptEnabled:false,viewport:{width:1440,height:900}});const nojs=await ssr.newPage();await nojs.goto(origin+'/');await nojs.evaluate(()=>document.fonts.ready);const prerendered=await measure(nojs);assert.deepEqual(prerendered.nav,hydrated.nav);assert.deepEqual(prerendered.inner,hydrated.inner);await ssr.close();
  await page.reload();await page.locator('nav').waitFor();await page.waitForTimeout(1000);assert.deepEqual((await measure(page)).inner,hydrated.inner);assert.equal((await (await context.request.get(origin+'/version.json')).json()).buildId,report.buildId);await context.close();
 }
 assert.deepEqual(report.errors,[]);report.result='PASS';console.log('PUBLIC_RESPONSIVE=PASS STATES='+report.states.length+' HEADER_INITIAL=PASS HEADER_SCROLL=PASS RELOAD=PASS OVERFLOW=0 GREEN_LINES=0 PHOTO_COVERAGE=PASS');
}catch(e){report.result='FAIL';report.failure=e.message;throw e;}finally{await browser.close();await writeFile(`${dir}/result.json`,JSON.stringify(report,null,2));}
