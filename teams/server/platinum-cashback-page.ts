import { createHash } from 'node:crypto';
import { DomainError } from '../src/domain.js';
import type { RequirementNode } from '../src/delivery-requirements.js';
import type { PublishedArtifact } from '../../shared/contracts.js';
import { platinumCashbackPage, platinumCashbackPageNodes } from '../../shared/platinum-cashback-page.js';
export type PublishedInputReader=(artifactId:string,version:number,path:string)=>Promise<{content:string;absolutePath?:string}>;
/** Full texts come only from the exact published artifact/version; no embedded document fallback. */
export async function platinumPageKnowledge(published:PublishedArtifact[],node:RequirementNode,read?:PublishedInputReader){
 const artifact=published.find(item=>item.id===platinumCashbackPage.artifactId&&item.projectId===platinumCashbackPage.projectId);
 if(!artifact)return undefined;
 if(artifact.version!==platinumCashbackPage.version)throw new DomainError('权益说明资料的发布版本与场景配置不一致，请核对后再导入',409);
 if(!read)throw new DomainError('权益说明资料原文读取尚未接入',502);
 if(!artifact.files.some(file=>file.path===platinumCashbackPage.manifest))throw new DomainError('权益说明产物缺少来源清单',502);
 let manifest:any;
 try{manifest=JSON.parse((await read(artifact.id,artifact.version,platinumCashbackPage.manifest)).content);}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('权益说明产物来源清单无效',502);}
 if(manifest.schemaVersion!==1||manifest.scenarioId!==platinumCashbackPage.id||manifest.artifactId!==artifact.id||manifest.version!==artifact.version||manifest.projectId!==artifact.projectId||manifest.exactTitle!==platinumCashbackPage.title||!Array.isArray(manifest.knowledgeFiles))throw new DomainError('权益说明产物来源范围不匹配',502);
 const selected=platinumCashbackPageNodes[node];
 const documents=await Promise.all(selected.knowledge.map(async item=>{
  const path=platinumCashbackPage.files[item.file],file=artifact.files.find(file=>file.path===path),proofs=manifest.knowledgeFiles.filter((entry:any)=>entry.path===path);
  if(!file||proofs.length!==1||!/^[a-f0-9]{64}$/.test(proofs[0].sha256))throw new DomainError('权益说明产物缺少所需原文或唯一版本依据：'+path,502);
  const content=(await read(artifact.id,artifact.version,path)).content,sha256=createHash('sha256').update(content).digest('hex');
  if(sha256!==proofs[0].sha256)throw new DomainError('权益说明产物原文与发布依据不一致：'+path,502);
  return {...item,path,title:file.title,content,sha256};
 }));
 return {artifact,documents};
}
