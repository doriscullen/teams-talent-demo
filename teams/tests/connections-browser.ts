import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState } from '../src/domain.js';

const origin='http://127.0.0.1:45974',dir=await mkdtemp(join(tmpdir(),'teams-source-data-')),output='test-results/source-data';
await mkdir(output,{recursive:true});
const initial=initialState();initial.workspace.connections.find(item=>item.id==='requirements')!.enabled=false;
await writeFile(join(dir,'state.json'),JSON.stringify(initial));
const server=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,DEMO_PORT:'45974',DEMO_TALENT_PORT:'45984',DEMO_STATE_DIR:dir,DEMO_SHARED_DIR:join(dir, 'shared'),DEMO_SHARED_SEED_DIR:join(dir,'no-seed'),DEMO_NATIVE_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
let browser;
try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready,logs);
  const before=await readFile(join(dir,'state.json'),'utf8'),errors:string[]=[],writes:string[]=[],layouts:unknown[]=[];
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/api/**',route=>{if(route.request().method()==='POST'){writes.push(route.request().url());return route.abort();}return route.continue();});
  const knowledgeReads:string[]=[];page.on('request',request=>{if(/\/api\/(knowledge|talents)\//.test(new URL(request.url()).pathname))knowledgeReads.push(request.url());});
  await page.goto(origin+'/teams#/connections');await page.getByRole('button',{name:'查看代码托管平台数据',exact:true}).waitFor();
  assert.equal(await page.locator('.enterprise-plugin-card').count(),5);
  assert.equal(await page.locator('[data-platform="business-knowledge"]').count(),0,'business knowledge is shown on the project knowledge page, not as a source plugin');assert.equal(await page.getByText('业务知识（Talent）',{exact:true}).count(),0);
  assert.equal(await page.locator('[data-platform="requirements"]').getByRole('button',{name:'在项目中使用',exact:true}).isEnabled(),false);
  const checks=[
    ['repository','代码托管平台','白金卡返现规则','carddemo-java-1025',6],
    ['requirements','需求平台','信用卡消费返现','MKT-001',11],
    ['defects','缺陷平台','普通卡不应进入白金卡返现范围','CARD-BUG-001',8],
    ['design-library','设计文档 / 知识库','营销能力设计','marketing-capability',7],
    ['test-assets','测试资产平台','白金卡客户范围','CARD-TC-01',7],
  ] as const;
  for(const [id,name,title,record,count] of checks){
    await page.getByRole('button',{name:'查看'+name+'数据',exact:true}).click();const drawer=page.locator('.enterprise-source-drawer');await drawer.getByRole('button',{name:title,exact:true}).waitFor();
    const recordIds:string[]=[];
    while(true){recordIds.push(...await drawer.locator('.ant-table-row').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-row-key')!)));const next=drawer.locator('.ant-pagination-next:not(.ant-pagination-disabled)');if(!await next.count())break;await next.click();}
    assert.equal(recordIds.length,count);assert.equal(new Set(recordIds).size,count);
    if(id==='requirements')assert.deepEqual(recordIds.map(value=>value.split(':').at(-1)),['DEMO-MKT-001','MKT-002','MKT-003','MKT-004','MKT-005','REQ-T104','REQ-T105','REQ-T106','REQ-T107','REQ-T108','REQ-WINDOWS-RECONNECT']);
    if(id==='defects')assert.deepEqual(recordIds.map(value=>value.split(':').at(-1)),['CARD-BUG-001','CARD-BUG-002','CARD-BUG-003','CARD-BUG-004','CARD-BUG-005','CARD-BUG-006','CARD-BUG-007','TEAMS-BUG-001']);
    const firstPage=drawer.locator('.ant-pagination-item-1');if(await firstPage.count())await firstPage.click();
    await drawer.getByText('Credit Card',{exact:true}).first().waitFor();await drawer.getByText('iCode Teams',{exact:true}).first().waitFor();
    await drawer.getByRole('button',{name:title,exact:true}).click();await drawer.getByRole('heading',{name:title,exact:true}).waitFor();await drawer.getByText(record,{exact:true}).waitFor();
    assert.ok((await drawer.locator('.enterprise-source-detail').innerText()).includes('来源记录'));
    if(id==='design-library'){await drawer.getByRole('button',{name:'阅读营销能力设计',exact:true}).click();await drawer.locator('.enterprise-source-reference pre').waitFor();assert.ok((await drawer.locator('.enterprise-source-reference pre').innerText()).includes('白金卡消费额外返现'));}
    if(id==='test-assets')assert.ok((await drawer.locator('.enterprise-source-detail').innerText()).includes('预期结果'));
    await page.screenshot({path:output+'/'+id+'-detail.png',fullPage:true,animations:'disabled'});await drawer.getByRole('button',{name:'返回数据',exact:true}).click();await drawer.locator('.ant-table-row').first().waitFor();await drawer.locator('.ant-drawer-close').click();await drawer.waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'高级能力设置',exact:true}).click();await page.getByRole('switch',{name:'启用代码 Review',exact:true}).waitFor();
  assert.deepEqual(await page.locator('.ant-drawer .ant-tabs-tab').allTextContents(),['质量与安全','模型与工具服务'],'no Talent connection tab');await page.locator('.ant-drawer-close').click();await page.getByRole('switch',{name:'启用代码 Review',exact:true}).waitFor({state:'hidden'});
  for(const mode of ['light','dark'])for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(value=>localStorage.setItem('carddemo-theme',value),mode);await page.reload();await page.getByRole('button',{name:'查看测试资产平台数据',exact:true}).waitFor();
    let measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(measure.scrollWidth<=width);layouts.push({mode,page:'cards',...measure});
    await page.screenshot({path:output+'/'+mode+'-'+width+'-cards.png',fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'查看测试资产平台数据',exact:true}).click();const drawer=page.locator('.enterprise-source-drawer');await drawer.getByRole('button',{name:'白金卡客户范围',exact:true}).click();
    await drawer.locator('.enterprise-source-detail').waitFor();measure=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(measure.scrollWidth<=width);layouts.push({mode,page:'detail',...measure});
    await page.screenshot({path:output+'/'+mode+'-'+width+'-detail.png',fullPage:true,animations:'disabled'});await drawer.locator('.ant-drawer-close').click();await drawer.waitFor({state:'hidden'});
  }
  await page.getByRole('combobox',{name:'切换角色'}).click();await page.locator('.ant-select-item-option-content').getByText('陈晨 · 项目成员',{exact:true}).click();await page.getByText('此页面面向项目 Owner',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'查看需求平台数据',exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(knowledgeReads,[],'enterprise connections do not read Talents knowledge');assert.equal((await(await fetch(origin+'/api/state')).json()).revision,initial.revision);assert.equal(await readFile(join(dir,'state.json'),'utf8'),before);
  await writeFile(output+'/result.json',JSON.stringify({passed:true,plugins:checks.map(([id])=>id),businessKnowledgePluginRemoved:true,knowledgeReads,layouts,pageErrors:errors,posts:writes,stateUnchanged:true,memberGuard:true},null,2));console.log('PASS: 5 source plugin drawers, no business-knowledge plugin or Talent connection, local reference, read-only state, role guard, 8 layouts');
}catch(error){await writeFile(output+'/failure.log',String(error)+'\n'+logs);throw error;}finally{await browser?.close();server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
