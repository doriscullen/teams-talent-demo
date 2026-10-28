import { createHash } from 'node:crypto';
import { DomainError } from '../src/domain.js';
import type { RequirementNode } from '../src/delivery-requirements.js';
import type { TalentTaskInputs } from '../src/talent-contract.js';
import type { PublishedArtifact } from '../../shared/contracts.js';
import { fourRequirementNodes, type FourRequirementScenario } from '../../shared/four-requirement-scenarios.js';
import type { PublishedInputReader } from './platinum-cashback-page.js';

/** Every selected full text and Skill must match the reviewed, published source fingerprint. */
export async function fourRequirementKnowledge(s:FourRequirementScenario,published:PublishedArtifact[],node:RequirementNode,read?:PublishedInputReader){
 const matches=published.filter(a=>a.id===s.artifactId&&a.projectId===s.projectId);
 if(!matches.length)return undefined;
 if(matches.length!==1||matches[0].version!==s.version)throw new DomainError('需求资料发布版本不匹配：'+s.businessId,409);
 if(!read)throw new DomainError('需求资料全文读取尚未接入',502);
 const artifact=matches[0];
 if(!artifact.files.some(f=>f.path===s.manifest))throw new DomainError('需求资料缺少来源清单',502);
 let manifest:any;try{manifest=JSON.parse((await read(artifact.id,artifact.version,s.manifest)).content);}catch(error){if(error instanceof DomainError)throw error;throw new DomainError('需求资料来源清单无效',502);}
 if(manifest.schemaVersion!==1||manifest.scenarioId!==s.id||manifest.businessId!==s.businessId||manifest.artifactId!==s.artifactId||manifest.version!==s.version||manifest.projectId!==s.projectId||manifest.exactTitle!==s.title||manifest.sourceSha256!==s.sourceSha256||!Array.isArray(manifest.knowledgeFiles)||!Array.isArray(manifest.skillPackages))throw new DomainError('需求资料来源范围不一致',502);
 if(s.profileSha256&&(manifest.testProfile?.version!=='test-profile-v2'||manifest.testProfile?.path!==s.files.profile||manifest.testProfile?.sha256!==s.profileSha256))throw new DomainError('需求资料试验口径版本或摘要不匹配',409);
 const documents=await Promise.all(fourRequirementNodes[node].knowledge.map(async selected=>{
  const path=s.files[selected.file],file=artifact.files.find(f=>f.path===path),proofs=manifest.knowledgeFiles.filter((f:any)=>f.path===path);
  if(!file||proofs.length!==1||!/^[a-f0-9]{64}$/.test(proofs[0].sha256))throw new DomainError('需求资料缺少唯一完整原文：'+path,502);
  const source=await read(artifact.id,artifact.version,path),content=source.content,sha256=createHash('sha256').update(content).digest('hex');
  if(sha256!==proofs[0].sha256||selected.file==='requirement'&&sha256!==s.sourceSha256||selected.file==='profile'&&s.profileSha256&&sha256!==s.profileSha256)throw new DomainError('需求资料正文摘要不一致：'+path,502);
  return {...selected,path,title:file.title,content,sha256,absolutePath:source.absolutePath};
 }));
 return {artifact,documents,assertSkill(skill:TalentTaskInputs['skills'][number]){
  const proofs=manifest.skillPackages.filter((p:any)=>p.id===skill.id);
  if(proofs.length!==1||proofs[0].version!==skill.version||proofs[0].sha256!==skill.sha256||proofs[0].contentSha256!==skill.contentSha256||createHash('sha256').update(skill.content).digest('hex')!==skill.contentSha256)throw new DomainError('需求场景所选 Skill 包版本或正文已变化，请核对后发布新资料版本：'+skill.id,409);
 }};
}
