import {chromium,expect} from '../../frontend/node_modules/@playwright/test/index.mjs';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {work,origin,loadProtected,saveProtected,verifyLabIdentity,client,login,originalFingerprint} from './four-issues-lab-common.mjs';

verifyLabIdentity();
const entropy='UASSpain|four-issues-20261117|actors|v1',file=resolve(work,'actors.dpapi'),fixture=loadProtected(file,entropy);
const report={observed_at:new Date().toISOString(),scope:'Actual candidate Docker UI in existing synthetic lab; no original writes or permission overrides',checks:[]};
const save=()=>writeFileSync('docs/audits/evidence/2026-11-17-four-issues-browser-regression.json',JSON.stringify(report,null,2)+'\n');
const gate=(id,ok)=>{report.checks.push({id,status:ok?'PASS':'FAIL'});save();if(!ok)throw Error(id);};
const before=originalFingerprint();
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const instructor=fixture.actors.find(a=>a.name==='newTeacher'),own=fixture.actors.find(a=>a.name==='otherStudent'),foreign=fixture.actors.find(a=>a.name==='student');
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  await page.goto(origin+'/?auth=login');await page.locator('#login-email').fill(instructor.email);await page.locator('#login-password').fill(instructor.password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL(/\/instructor$/);await page.locator('aside').waitFor({state:'visible'});
  await page.locator('aside').getByRole('button',{name:'Alumnos',exact:true}).click();
  await expect(page.getByText(`${own.nombre} ${own.apellidos}`,{exact:true}).filter({visible:true}).first()).toBeVisible();
  gate('NEW_INSTRUCTOR_OWN_ASSIGNED_STUDENT_RENDERED',await page.getByText(`${own.nombre} ${own.apellidos}`,{exact:true}).filter({visible:true}).first().isVisible());
  gate('NEW_INSTRUCTOR_FOREIGN_STUDENT_NOT_RENDERED',await page.getByText(`${foreign.nombre} ${foreign.apellidos}`,{exact:true}).count()===0);
  await page.screenshot({path:'docs/audits/evidence/2026-11-17-four-issues-new-instructor.png'});
  const staff=client();await login(staff,instructor.email,instructor.password);const contacts=await staff.call('/api/mensajes-staff/contacts/');gate('NEW_INSTRUCTOR_AUTHORIZED_STAFF_CONTACTS',contacts.status===200&&contacts.body.some(p=>p.id===fixture.actors.find(a=>a.name==='oldTeacher').id)&&!contacts.body.some(p=>p.id===foreign.id));
  const anonymousContext=await browser.newContext({viewport:{width:1440,height:1000}}),publicPage=await anonymousContext.newPage();
  await publicPage.goto(origin+'/blog');
  const published=fixture.publications.find(p=>p.name==='published');await expect(publicPage.getByRole('heading',{name:published.title,exact:true})).toBeVisible();gate('SAVED_BOE_RENDERED_ON_PUBLIC_BLOG',true);
  for(const name of ['private','future'])gate('PUBLIC_UI_EXCLUDES:'+name,await publicPage.getByText(fixture.publications.find(p=>p.name===name).title,{exact:true}).count()===0);
  await page.locator('aside').getByRole('button',{name:'Material',exact:true}).click();await page.getByRole('button',{name:'Publicaciones BOE',exact:true}).click();
  const title=`FOUR-${fixture.suffix} BOE from real instructor form`;
  await page.locator('#instructormaterial-field-5').fill(title);await page.locator('#instructormaterial-field-6').fill('2026-11-17');await page.locator('#instructormaterial-field-7').fill('Publicación sintética creada mediante el formulario real.');await page.locator('#instructormaterial-field-8').fill('https://www.boe.es/diario_boe/');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/publicaciones-boe/')&&r.request().method()==='POST');
  await page.locator('form').filter({has:page.locator('#instructormaterial-field-5')}).getByRole('button',{name:/Añadir Publicación/i}).click();
  const response=await created;gate('BOE_CREATED_BY_INSTRUCTOR_FORM',response.status()===201);const row=await response.json();fixture.publications.push({name:'ui',id:row.id,title});saveProtected(file,entropy,fixture);
  await expect(publicPage.getByRole('heading',{name:title,exact:true})).toBeVisible({timeout:40000});gate('BOE_REACHES_ALREADY_OPEN_PUBLIC_PAGE_WITHOUT_RELOAD',true);
  await expect(publicPage.locator('article').filter({has:publicPage.getByRole('heading',{name:title,exact:true})}).getByRole('link',{name:'Consultar publicación oficial'})).toHaveAttribute('href','https://www.boe.es/diario_boe/');gate('BOE_REFERENCE_LINK_PRESERVED',true);
  await publicPage.screenshot({path:'docs/audits/evidence/2026-11-17-four-issues-boe-public.png'});
  await page.locator('aside').getByRole('button',{name:'Exámenes',exact:true}).click();
  await page.locator('#archivo_preguntas').setInputFiles('C:/Users/migue/OneDrive/Desktop/EXAMEN STS 3.pdf');await page.getByRole('combobox',{name:'Categoría del examen'}).selectOption('STS');
  await page.getByRole('button',{name:/Analizar|Importar|Subir/i}).filter({visible:true}).first().click();
  const preview=page.getByRole('dialog',{name:'Previsualización de la importación'});await expect(preview).toBeVisible({timeout:20000});
  for(const number of [5,7,21,22])await expect(preview.getByText(new RegExp('Pregunta '+number+':'))).toBeVisible();
  await expect(preview.getByRole('button',{name:'Confirmar importación en borrador'})).toBeDisabled();gate('STS3_PREVIEW_DIAGNOSES_FOUR_UNMARKED_QUESTIONS_AND_BLOCKS_CONFIRMATION',true);
  await page.screenshot({path:'docs/audits/evidence/2026-11-17-four-issues-sts3-preview.png'});
  await preview.getByRole('button',{name:'Cancelar importación'}).click();
  gate('ORIGINAL_PROFILES_AND_CREDENTIALS_UNCHANGED',before===originalFingerprint());
  report.status='PASS_SCOPED_BROWSER_REGRESSION';
} catch(error){report.status='BLOCKED_OR_FAILED_BROWSER';report.error_type=error.name;report.error=String(error.message).replace(/password[^\n]*/gi,'redacted').slice(0,700);process.exitCode=1;}
finally{await browser.close();save();console.log(JSON.stringify(report));}
