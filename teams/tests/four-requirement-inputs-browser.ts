import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {chromium,type Browser} from 'playwright';
import {initialState} from '../src/domain.js';
import {createDeliveryRequirement} from '../src/delivery-requirements.js';
import {migrateMainDelivery} from '../server/delivery-migration.js';
import {fourRequirementScenarios} from '../../shared/four-requirement-scenarios.js';
import {appendFourRequirements} from '../../talents/server/four-requirements.ts';
import {seedState} from '../../talents/server/seed.ts';
import {buildExport,writeExport} from '../../talents/server/export.ts';
const temp=await mkdtemp(join(tmpdir(),'four-requirement-ui-')),origin='http://127.0.0.1:46314',evidence='test-results/four-requirements-20261028/ui';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const state=initialState();migrateMainDelivery(state);
const tasks=fourRequirementScenarios.map(s=>createDeliveryRequirement(state,'owner',{projectId:'carddemo',id:'REQ-'+randomUUID(),title:s.title,description:s.creationDescription,assigneeId:'member'},'2026-10-28T00:00:00Z'));
let child:ChildProcess|undefined,browser:Browser|undefined,logs='';const errors:string[]=[],writes:string[]=[],checks:string[]=[];
try{
 await mkdir(evidence,{recursive:true});await writeFile(join(temp,'state.json'),JSON.stringify(state));await writeExport(join(temp,'shared'),buildExport(appendFourRequirements(seedState()).state));
 const bundle=await build({entryPoints:['src/main.tsx'],bundle:true,outdir:join(temp,'bundle'),format:'esm',minify:true,target:['chrome120'],define:{'process.env.NODE_ENV':'"production"'},write:false});
 child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DEMO_PORT:'46314',DEMO_TALENT_PORT:'46315',DEMO_STATE_DIR:temp,DEMO_SHARED_DIR:join(temp,'shared'),DEMO_SHARED_SEED_DIR:join(temp,'none'),DEMO_NATIVE_DISABLED:'1'},stdio:['ignore','pipe','pipe']});child.stdout!.on('data',v=>logs+=v);child.stderr!.on('data',v=>logs+=v);
 let ready=false;for(let n=0;n<100;n++){try{const h=await(await fetch(origin+'/api/health')).json();if(h.pid===child.pid){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,logs);
 // Let the existing bootstrap synchronize published project knowledge before the read-only UI interval.
 await fetch(origin+'/api/state');
 const before=await readFile(join(temp,'state.json'));
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{if(!['GET','HEAD'].includes(route.request().method())){writes.push(route.request().url());return route.abort();}return route.continue();});
 for(const file of bundle.outputFiles!)await page.route(origin+'/'+basename(file.path),route=>route.fulfill({body:Buffer.from(file.contents),contentType:file.path.endsWith('.css')?'text/css':'text/javascript'}));
 const visit=async(index:number,node='prepare')=>{await page.goto(origin+'/teams?demo-role=owner#/projects?'+new URLSearchParams({project:'carddemo',tab:'delivery',task:tasks[index].id,node}));await page.getByText('查看需求、采用版本与上游结果',{exact:true}).click();await page.getByRole('button',{name:'阅读 原始需求',exact:true}).waitFor();};
 for(let i=0;i<tasks.length;i++){
  await visit(i);await page.getByRole('button',{name:'阅读 原始需求',exact:true}).click();const drawer=page.getByRole('dialog',{name:'原始需求 · v1'}),pre=drawer.locator('pre');await pre.waitFor();assert.equal(hash(await pre.innerText()),fourRequirementScenarios[i].sourceSha256);
  if(i===0)await page.screenshot({path:evidence+'/source-fulltext.png',fullPage:true,animations:'disabled'});await drawer.locator('.ant-drawer-close').click();
  await page.getByRole('button',{name:'阅读 test-profile',exact:true}).click();await page.getByRole('dialog',{name:'test-profile · v1'}).getByText(/审批来源：用户 2026-10-28/).waitFor();await page.locator('.ant-drawer-close:visible').click();checks.push(fourRequirementScenarios[i].businessId+' exact body + profile');
 }
 await visit(0,'verify');await page.locator('[data-artifact-slot="test-cases"]').getByRole('button',{name:'查看全部 8 项'}).click();await page.getByRole('dialog').getByText(/REQ-2026-001-US-008/).waitFor();await page.locator('.ant-drawer-close:visible').click();checks.push('verify source-specific eight cases');
 await visit(0);let release!:()=>void;const gate=new Promise<void>(r=>release=r);let pending!:()=>void;const requested=new Promise<void>(r=>pending=r);
 await page.route('**/api/talents/file?*',async route=>{const response=await route.fetch();pending();await gate;await route.fulfill({response});},{times:1});
 await page.getByRole('button',{name:'阅读 原始需求',exact:true}).click();await requested;await page.evaluate(id=>{location.hash='/projects?'+new URLSearchParams({project:'carddemo',tab:'delivery',task:id,node:'prepare'});},tasks[1].id);await page.getByText(tasks[1].title,{exact:true}).first().waitFor();release();await page.waitForTimeout(300);assert.equal(await page.getByRole('dialog').count(),0);checks.push('stale old-task read discarded');
 await visit(1);await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'阅读 原始需求',exact:true}).click();await page.getByRole('dialog').locator('pre').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:evidence+'/source-narrow.png',fullPage:true,animations:'disabled'});
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);const after=await readFile(join(temp,'state.json'));assert.equal(hash(after),hash(before));
 await writeFile(evidence+'/result.json',JSON.stringify({passed:true,checks,writes,errors,stateBefore:hash(before),stateAfter:hash(after),note:'Isolated fixture display only; no model or business transition.'},null,2));console.log(JSON.stringify({passed:true,checks,writes:0,errors:0,evidence}));
}finally{await browser?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child!.once('exit',r));}await writeFile(evidence+'/server.log',logs);await rm(temp,{recursive:true,force:true});}
