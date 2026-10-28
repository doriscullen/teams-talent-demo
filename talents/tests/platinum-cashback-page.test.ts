import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seedState, SEED_VERSION } from '../server/seed.ts';
import { appendPlatinumCashbackPage, platinumCashbackPageArtifact } from '../server/platinum-cashback-page.ts';
import { buildExport } from '../server/export.ts';
import { contentDir, repositoryRoot } from '../server/config.ts';
import { platinumCashbackPage } from '../../shared/platinum-cashback-page.ts';
import { clientState, ownedState } from '../server/teams-data.ts';
import snapshot from './fixtures/teams-snapshot.json' with { type: 'json' };

test('scenario registration is additive, idempotent and does not migrate the existing Talents seed',()=>{
 assert.equal(SEED_VERSION,12);
 const state=seedState();state.artifacts=state.artifacts.filter(item=>item.id!==platinumCashbackPage.artifactId);state.revision=41;
 state.tasks.push({id:'keep-user-task',status:'running'});
 const before=structuredClone(state),result=appendPlatinumCashbackPage(state);
 assert.equal(result.added,true);assert.deepEqual(state,before);assert.deepEqual({...result.state,artifacts:result.state.artifacts.filter(item=>item.id!==platinumCashbackPage.artifactId)},before);
 assert.equal(appendPlatinumCashbackPage(result.state).state,result.state);assert.equal(appendPlatinumCashbackPage(result.state).added,false);
 result.state.artifacts.find(item=>item.id===platinumCashbackPage.artifactId)!.desc='用户已改';
 assert.throws(()=>appendPlatinumCashbackPage(result.state),/内容不同/);
});
test('existing HTTP client-state round trip changes only the single artifact',()=>{
 const previous=seedState();previous.artifacts=previous.artifacts.filter(item=>item.id!==platinumCashbackPage.artifactId);
 const client=clientState(previous,snapshot as any),added=appendPlatinumCashbackPage(client as any),saved=ownedState(added.state,previous);
 assert.deepEqual({...saved,artifacts:saved.artifacts.filter(item=>item.id!==platinumCashbackPage.artifactId)},previous);
 assert.deepEqual(saved.artifacts.at(-1),platinumCashbackPageArtifact());
});
test('published scenario contains exact full texts and verified repository references, without generated delivery facts',async()=>{
 const artifact=platinumCashbackPageArtifact(),state=seedState(),output=buildExport(state);
 const published=output.knowledge.artifacts.find(item=>item.id===artifact.id)!;
 assert.equal(published.files.length,5);assert.equal(published.projectId,'carddemo');assert.equal(state.tasks.some(task=>task.artifact===artifact.id),false);
 const manifest=JSON.parse(await readFile(join(contentDir,platinumCashbackPage.manifest),'utf8'));
 for(const file of manifest.knowledgeFiles){const content=await readFile(join(contentDir,file.path));assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256);assert.equal(output.files.get(artifact.id+'/v1')!.find(item=>item.path===file.path)!.text,content.toString('utf8'));}
 for(const file of manifest.sourceFiles)assert.equal(createHash('sha256').update(await readFile(join(repositoryRoot,file.path))).digest('hex'),file.sha256);
 const implementation=await readFile(join(contentDir,platinumCashbackPage.files.implementation),'utf8');assert.match(implementation,/没有白金等级/);assert.match(implementation,/不是 React/);
 const acceptance=await readFile(join(contentDir,platinumCashbackPage.files.acceptance),'utf8');assert.match(acceptance,/待执行的用例/);assert.match(acceptance,/不发送报名、交易、奖励评估或入账/);
});
