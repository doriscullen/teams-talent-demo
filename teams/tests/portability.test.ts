import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadLocalConfiguration } from '../server/local-config.js';
import { readFixtures } from '../server/http-shared.js';
import { root, workspace, runtimeDir } from '../server/config.js';
// @ts-expect-error standalone Node startup scripts intentionally have no TypeScript declarations
import { serviceHealth } from '../scripts/services.mjs';

test('runtime fixture paths follow the material root rather than the imported machine',async()=>{
  const data=await readFixtures();assert.ok(data.skills.length>0);
  for(const skill of data.skills)assert.equal(skill.path,join(workspace,'.agents','skills',skill.name,'SKILL.md'));
  assert.equal(data.localPaths.cli,join(root,'scripts/teams-demo.mjs'));
  assert.equal(data.localPaths.collaborationSkill,join(root,'skills/teams-demo-collaboration/SKILL.md'));
});
test('launcher rejects a different workspace, state directory or app on an occupied port',async()=>{
  let value:any={app:'teams-talent-carddemo',workspaceRoot:root,stateRoot:runtimeDir};
  const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.setHeader('connection','close');res.end(JSON.stringify(value));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address() as {port:number},service={id:'teams',app:'teams-talent-carddemo',origin:'http://127.0.0.1:'+address.port,runtimeDir};
  try {assert.equal((await serviceHealth(service)).workspaceRoot,root);
    for(const other of [{...value,workspaceRoot:'/another/copy'},{...value,stateRoot:'/another/state'},{app:value.app},{...value,app:'another-app'}]){value=other;await assert.rejects(serviceHealth(service),/其他|旧版/);}
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  assert.equal(await serviceHealth(service),null);
});

test('local startup configuration is shared, explicit, validated and overridden by environment',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'teams-local-config-')),file=join(directory,'settings.json'),state=join(directory,'state'),material=join(directory,'material');
  try{
    assert.equal(loadLocalConfiguration(directory,{}).loaded,false);assert.throws(()=>loadLocalConfiguration(directory,{DEMO_LOCAL_CONFIG:join(directory,'absent.json')}),/ENOENT/);
    await writeFile(file,JSON.stringify({DEMO_STATE_DIR:state,DEMO_MATERIAL_ROOT:material,DEMO_PORT:46190}));
    const env:NodeJS.ProcessEnv={DEMO_LOCAL_CONFIG:file,DEMO_PORT:'46191'};assert.equal(loadLocalConfiguration(directory,env).loaded,true);assert.equal(env.DEMO_PORT,'46191');assert.equal(env.DEMO_STATE_DIR,state);assert.equal(env.DEMO_MATERIAL_ROOT,material);
    const childEnv:NodeJS.ProcessEnv={...process.env,DEMO_LOCAL_CONFIG:file,DEMO_PORT:'46192'};delete childEnv.DEMO_STATE_DIR;delete childEnv.DEMO_MATERIAL_ROOT;
    const config=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {workspace,materialRoot,runtimeDir,port} from './server/config.ts'; console.log(JSON.stringify({workspace,materialRoot,runtimeDir,port}));`],{cwd:root,env:childEnv,encoding:'utf8'}));assert.equal(config.materialRoot,material);assert.equal(config.runtimeDir,state);assert.equal(config.port,46192);assert.equal(config.workspace,join(material,'workspace'));
    for(const bad of ['{',JSON.stringify([]),JSON.stringify({TYPO:'value'}),JSON.stringify({DEMO_ICODE_BINARY:'relative'}),JSON.stringify({DEMO_PORT:'45970'}),JSON.stringify({DEMO_PORT:80})]){await writeFile(file,bad);assert.throws(()=>loadLocalConfiguration(directory,{DEMO_LOCAL_CONFIG:file}),/配置/);}
    assert.throws(()=>loadLocalConfiguration(directory,{DEMO_LOCAL_CONFIG:'relative'}),/绝对路径/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
