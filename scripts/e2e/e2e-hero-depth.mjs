// Read-only acceptance of the production Hero: actual pixels, no API mocks.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { X509Certificate, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const sharp = createRequire(new URL('../../frontend/package.json', import.meta.url))('sharp');
const origin = process.env.FRONTEND_TEST_ORIGIN || 'https://localhost';
assert.ok(['https://localhost', 'https://localhost:8444'].includes(origin));
const dir = process.env.DEPTH_REPORT_DIR || '.run/hero-depth-20261011/depth';
mkdirSync(dir, { recursive: true });
const pin = createHash('sha256').update(new X509Certificate(readFileSync('.secrets/tls/edge.crt')).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const browser = await chromium.launch({ args: ['--ignore-certificate-errors-spki-list=' + pin] });
const sizes = [[320,568],[375,667],[390,844],[768,1024],[1024,768],[1366,768],[1440,900],[1920,1080],[2560,1440],[3840,2160],[844,390],[667,375],[2560,900]];
const report = { origin, version: null, states: [], errors: [], writes: [] };
const physicalPoints = [[610,223],[618,287],[898,197],[1058,229],[1056,271],[812,248],[671,238],[985,244],[762,298],[780,312],[560,201],[945,181],[1120,209]];
const pixels = async buffer => sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  for (const theme of ['light','dark']) for (const [width,height] of sizes) {
    const context = await browser.newContext({ viewport: { width,height }, ignoreHTTPSErrors: false });
    await context.addInitScript(({value,allowedOrigin}) => {
      if (window.top !== window || location.origin !== allowedOrigin) return;
      localStorage.setItem('theme',value);
      window.droneFirstPaint=[];
      const sample=()=>{
        const photo=document.querySelector('.hero-image'),drone=document.querySelector('.hero-drone-image');
        if(photo?.naturalWidth) window.droneFirstPaint.push({ready:Boolean(drone?.naturalWidth),sameSource:photo.currentSrc===drone?.currentSrc});
        if(window.droneFirstPaint.length<60)requestAnimationFrame(sample);
      };requestAnimationFrame(sample);
    },{value:theme,allowedOrigin:origin});
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => { if (!['GET','HEAD','OPTIONS'].includes(request.method())) report.writes.push(request.method() + ' ' + request.url()); });
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true' && [...document.querySelectorAll('.hero-stage img')].length === 4 && [...document.querySelectorAll('.hero-stage img')].every(image => image.complete && image.naturalWidth));
    await page.evaluate(() => document.fonts.ready);
    assert.ok((await page.evaluate(()=>window.droneFirstPaint)).every(frame=>frame.ready&&frame.sameSource),'The foreground must load together with the photograph');
    if (!report.version) report.version = await page.evaluate(() => fetch('/version.json').then(response => response.json()));
    const state = { theme,width,height,phases:[],reload:false,reducedMotion:false };
    const geometry = await page.evaluate(points => {
      const drone = document.querySelector('.hero-drone-layer'), photo = document.querySelector('.hero-art'), radar = document.querySelector('.hero-radar-layer');
      const cs = element => { const s=getComputedStyle(element); return { z:Number(s.zIndex),opacity:s.opacity,filter:s.filter,blend:s.mixBlendMode,perspective:s.perspective,position:s.position,transform:s.transform }; };
      const r = photo.getBoundingClientRect(), d = drone.getBoundingClientRect(), matrix = document.querySelector('.hero-drone-coordinates').getScreenCTM();
      const canvas = document.createElement('canvas'); canvas.width=innerWidth; canvas.height=innerHeight;
      const ctx=canvas.getContext('2d'); ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);
      const clip=document.querySelector('#hero-drone-clip');
      for (const item of clip.children) {
        if (item.tagName === 'path') ctx.fill(new Path2D(item.getAttribute('d')));
        else { ctx.beginPath(); ctx.ellipse(Number(item.getAttribute('cx')),Number(item.getAttribute('cy')),Number(item.getAttribute('rx')),Number(item.getAttribute('ry')),0,0,Math.PI*2); ctx.fill(); }
      }
      return { photo:cs(document.querySelector('.hero-background')),drone:cs(drone),radar:cs(radar),scene:getComputedStyle(document.querySelector('.hero-stage')).isolation,
        rectDiff:Math.max(Math.abs(r.x-d.x),Math.abs(r.y-d.y),Math.abs(r.width-d.width),Math.abs(r.height-d.height)),
        source:document.querySelector('.hero-image').currentSrc,foregroundSource:document.querySelector('.hero-drone-image').currentSrc,
        overflow:document.documentElement.scrollWidth-innerWidth,theme:document.documentElement.className,
        mask:canvas.toDataURL('image/png').split(',')[1],
        points:points.map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return [Math.round(p.x),Math.round(p.y)];}) };
    },physicalPoints);
    assert.equal(geometry.scene,'isolate');
    assert.equal(geometry.theme,theme);
    assert.ok(geometry.photo.z < geometry.radar.z && geometry.radar.z < geometry.drone.z);
    assert.equal(geometry.drone.opacity,'1'); assert.equal(geometry.drone.filter,'opacity(1)'); assert.equal(geometry.drone.blend,'normal'); assert.equal(geometry.drone.perspective,'none');
    assert.equal(geometry.drone.position,'absolute'); assert.equal(geometry.rectDiff,0); assert.equal(geometry.overflow,0); assert.equal(geometry.source,geometry.foregroundSource);
    const mask=await sharp(Buffer.from(geometry.mask,'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const inside=[],covered=[];
    for(let p=0;p<width*height;p++) if(mask.data[p*4+3]>0) covered.push(p*3);
    // Erode two pixels: an antialiased contour legitimately contains partial coverage.
    for(let y=2;y<height-2;y++) for(let x=2;x<width-2;x++) {
      if ([[-2,0],[2,0],[0,-2],[0,2],[0,0]].every(([dx,dy])=>mask.data[((y+dy)*width+x+dx)*4+3]===255)) inside.push((y*width+x)*3);
    }
    assert.ok(inside.length>100);
    for(const [x,y] of geometry.points) if(x>=0&&x<width&&y>=0&&y<height) assert.equal(mask.data[(y*width+x)*4+3],255,`Uncovered physical drone point ${x},${y}`);
    const sweep=page.locator('.hero-radar-sweep');
    const t1=await sweep.evaluate(element=>getComputedStyle(element).transform); await page.waitForTimeout(150);
    const t2=await sweep.evaluate(element=>getComputedStyle(element).transform); assert.notEqual(t1,t2,'The sweep must still rotate');
    await sweep.evaluate(element=>{element.style.animation='none';element.style.transform='rotate(-27deg)';});
    await page.locator('.hero-radar-layer').evaluate(element=>element.style.visibility='hidden'); await settle(page);
    const reference=await pixels(await page.screenshot());
    await page.locator('.hero-drone-layer').evaluate(element=>element.style.visibility='hidden'); await settle(page);
    const original=await pixels(await page.screenshot());
    let appearanceMax=0,appearanceSum=0,appearanceChanged=0;
    for(const p of covered) for(let c=0;c<3;c++) { const difference=Math.abs(reference.data[p+c]-original.data[p+c]);appearanceMax=Math.max(appearanceMax,difference);appearanceSum+=difference;if(difference>3)appearanceChanged++; }
    state.appearanceMax=appearanceMax;
    state.appearanceMean=appearanceSum/(covered.length*3);
    state.appearanceChangedFraction=appearanceChanged/(covered.length*3);
    // Include antialiased edges. Fractional CSS pixels can change interpolation
    // at isolated high-contrast pixels; a visible clipping seam changes a band.
    // At 667x375 the same photo produces 0.276% interpolation differences,
    // mean 0.046/255, max 7. Keep a bounded 0.5% photo tolerance; the separate
    // radar-occlusion assertion below still requires exactly ZERO changed pixels.
    assert.ok(appearanceMax<=12 && state.appearanceMean<1 && state.appearanceChangedFraction<0.005,`Foreground changes the existing photograph or contour: ${JSON.stringify(state)}`);
    await page.locator('.hero-drone-layer').evaluate(element=>element.style.visibility='');
    await page.locator('.hero-radar-layer').evaluate(element=>element.style.visibility='');
    const angles = [390,768,1440].includes(width) ? Array.from({length:24},(_,i)=>i*15-27) : [-27,0,90,180,270];
    for(const angle of angles) {
      await sweep.evaluate((element,value)=>element.style.transform=`rotate(${value}deg)`,angle); await settle(page);
      const frame=await pixels(await page.screenshot()); let max=0,radarPixels=0;
      for(const p of inside) for(let c=0;c<3;c++) max=Math.max(max,Math.abs(reference.data[p+c]-frame.data[p+c]));
      for(let p=0;p<frame.data.length;p+=3) if(Math.max(Math.abs(reference.data[p]-frame.data[p]),Math.abs(reference.data[p+1]-frame.data[p+1]),Math.abs(reference.data[p+2]-frame.data[p+2]))>6) radarPixels++;
      assert.equal(max,0,`Radar crosses the foreground at ${theme} ${width} phase ${angle}`); assert.ok(radarPixels>50,'Radar must remain visible');
      state.phases.push({angle,foregroundPixelDifference:max,radarPixels});
      if(angle===-27) await page.screenshot({path:`${dir}/after-${theme}-${width}x${height}.png`});
    }
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.documentElement.dataset.hydrated==='true'&&document.querySelector('.hero-drone-image')?.naturalWidth);
    await page.evaluate(()=>document.fonts.ready);
    await sweep.evaluate(element=>{element.style.animation='none';element.style.transform='rotate(-27deg)';});await settle(page);
    const reloaded=await pixels(await page.screenshot());let reloadMax=0;
    for(const p of inside)for(let c=0;c<3;c++)reloadMax=Math.max(reloadMax,Math.abs(reloaded.data[p+c]-reference.data[p+c]));
    assert.ok(reloadMax<=1,'Reload changes the drone/radar occlusion');state.reloadPixelDifference=reloadMax;
    assert.equal(await page.locator('.hero-drone-layer').evaluate(element=>getComputedStyle(element).zIndex),'2'); state.reload=true;
    await sweep.evaluate(element=>{element.style.animation='';element.style.transform='';});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await sweep.evaluate(element=>getComputedStyle(element).animationName),'none'); state.reducedMotion=true;
    state.interiorPixels=inside.length; report.states.push(state); await context.close();
    console.log(`${theme} ${width}x${height}: ${angles.length} sweep phases, ${inside.length} drone pixels protected`);
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.writes,[]);
  report.status='PASS';
} catch(error) { report.status='FAIL';report.errors.push(error.message);throw error; }
finally { writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));await browser.close(); }
