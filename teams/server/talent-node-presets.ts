import type { RequirementNode } from '../src/delivery-requirements.js';
export const nodePresetVersion = 'task-node-inputs-v1';
export interface NodePreset { knowledge: Array<{ id: string; title: string; content: string; slot: string; reason: string }>; skills: string[]; skillSlot: string }
const k=(id:string,title:string,content:string,slot:string,reason:string)=>({id,title,content,slot,reason});
const unresolved='正式日期起算、消费范围、限额、舍入、退款及冲正口径尚待业务确认；不得由实现自行补成已确认规则。';
const credit:Record<RequirementNode,NodePreset>={
 prepare:{knowledge:[k('scope','白金卡返现需求边界','已明确：白金卡客户在未来3个月的消费，额外获得0.5%返现。'+unresolved,'business-documents','用于澄清PRD范围与待确认项'),k('terms','返现术语与待确认清单','区分客户资格、消费交易、额外返现及活动期间。0.5%为额外比例；交易资格、活动时点和金额精度未定，应在PRD逐项记录问题与确认人。','business-documents','避免需求分析把未定口径当作事实')],skills:['ba-requirement-analysis','ba-acceptance-criteria'],skillSlot:'business-skills'},
 develop:{knowledge:[k('boundaries','营销与交易接口边界','按项目已关联代码与设计确认交易入账、营销评估和奖励记账接口；区分业务编排、资格判断和金额计算。接口签名、事务边界及重试策略以本任务确认设计和代码版本为准。','development-knowledge','帮助把确认PRD落实到可追踪设计与实现'),k('implementation','返现开发场景知识','将资格、期间和比例计算分离，金额与时间规则由确认PRD驱动；为边界、异常与重复请求提供单元测试。'+unresolved,'development-knowledge','给出实现检查点，不替代业务确认'),k('standards','交付代码与规范依据','复用仓库实际编码约定，登记设计、PR/提交和单元测试结果的同一代码版本；不得把源包中的通用规范当作项目已经批准的政策。','project-standards','约束版本追溯与项目规范核对')],skills:['arch-solution-design','dev-backend-service','dev-api-integration'],skillSlot:'development-skills'},
 verify:{knowledge:[k('verification','返现需求验证要点','验证白金卡资格、确认后的活动边界与额外0.5%；对未确认的日期、消费范围、限额、舍入及退款规则保留阻塞或待确认，不设置虚构预期。','verification-knowledge','将验证范围绑定当前需求与PRD'),k('quality','报告与问题闭环规范','功能、Review、安全报告均指向待验收代码版本，区分实际检查与预置结论；任一失败阻止验收，退回后必须重新检查，问题与复测保留可追踪引用。','project-standards','支持当前质量门禁而不伪造执行')],skills:['dev-code-reviewer','dev-unit-test','qa-integration-test','sec-scan-review'],skillSlot:'quality-skills'},
 accept:{knowledge:[k('acceptance','返现验收确认口径','Owner对照已确认PRD核对业务范围、功能/Review/安全报告与交付PR；未确认业务项和报告缺口明确记录，通过或退回由Owner决定。','acceptance-knowledge','提供本需求验收检查清单'),k('manifest','交付清单核对','核对PRD、设计、代码版本、三类报告、问题复测与Owner结论的同一引用链；验收通过后的会话收件不代表分析或能力演进已完成。','acceptance-knowledge','保持交付事实与后续Talent处理边界')],skills:['qa-uat-support'],skillSlot:'acceptance-skills'},
};
const teamTopics:Record<string,{title:string;focus:string}>={
 T104:{title:'加入团队后获取项目配置',focus:'加入团队后的资料与配置可见性、配置应用影响范围、首次与重复加入的行为边界'},
 T105:{title:'团队项目入口与项目切换',focus:'团队项目入口、所选项目范围、切换后的上下文更新与返回导航'},
 T106:{title:'项目规范与Skill可见性',focus:'项目规范和Skill的来源、版本、成员可见范围与采用边界'},
 T107:{title:'代码仓与本地工作目录关联',focus:'代码仓身份、本地目录核验、关联确认与不同项目目录隔离'},
 T108:{title:'调研外部需求系统接入范围',focus:'外部需求来源字段、接入范围、身份与权限边界、待确认接口和调研结论'},
};
/** Explicit new-task preparation: source facts are exactly the saved requirement, never another task's scenario. */
export function registeredTaskNodePreset(task:{title:string;description:string},node:RequirementNode):NodePreset{
 const stage={prepare:'需求澄清',develop:'功能开发',verify:'测试验证',accept:'需求验收'}[node];
 const guidance={prepare:'依据原始说明确认目标、范围、验收标准及待确认项；没有登记的业务口径必须保持待确认。',develop:'仅实现本需求已确认PRD；核对实际仓库和接口，设计、代码PR/提交与单元测试引用同一代码版本。',verify:'按本需求PRD、设计及代码版本准备功能、Review、安全检查；实际执行与预置检查必须分别标注，保留问题及复测结果。',accept:'对照本需求已确认PRD与交付清单核对报告和遗留问题；Owner明确通过或退回，不能由自动准备代替验收。'}[node];
 const slot=node==='prepare'?'business-documents':node==='develop'?'development-knowledge':node==='verify'?'verification-knowledge':'acceptance-knowledge';
 return{knowledge:[k('registered-requirement',task.title+' · '+stage+'依据','当前登记的原始需求：\n'+task.description+'\n\n本节点准备要点：'+guidance,slot,'本需求原文与当前节点准备标准；尚未确认、采用或执行')],skills:node==='prepare'?['ba-requirement-analysis','ba-acceptance-criteria']:node==='develop'?['arch-solution-design','dev-unit-test']:node==='verify'?['dev-code-reviewer','dev-unit-test','qa-integration-test','sec-scan-review']:['qa-uat-support'],skillSlot:node==='prepare'?'business-skills':node==='develop'?'development-skills':node==='verify'?'quality-skills':'acceptance-skills'};
}
export function nodePreset(projectId:string,taskId:string,node:RequirementNode):NodePreset|undefined{
 if(projectId==='carddemo'&&taskId==='MKT-OWNER-001'){const base=credit[node];return node==='develop'?{...base,knowledge:[k('explanation-page','返现说明页开发要点','说明页只陈述白金卡、未来3个月、额外0.5%和待确认事项；设计信息分组、可读性及边界提示，复用实际项目UI规范，不新增返现计算政策。','development-knowledge','对应说明页交付而非修改返现引擎')],skills:['arch-solution-design','dev-frontend-ui','dev-unit-test']}:{...base};}
 if(projectId==='carddemo'&&['DEMO-MKT-001','MKT-E2E-001','MKT-E2E-ACCEPT-001','MKT-OWNER-001'].includes(taskId))return credit[node];
 const topic=projectId==='teams'?teamTopics[taskId]:undefined;if(!topic)return;
 const names={prepare:'需求澄清',develop:'设计与开发',verify:'验证',accept:'验收'};
 const detail=node==='prepare'?`围绕${topic.focus}梳理目标、范围、用户操作和待确认项。原快照状态仅作来源，不代表本轮已经采用或重新确认。`:node==='develop'?`围绕${topic.focus}核对现有模块、接口与状态归属；先查原仓再提出方案，设计和代码引用必须可追踪。T108仅提供调研方法，不把调研记录冒充实现。`:node==='verify'?`围绕${topic.focus}设计范围隔离、正常/异常及重复操作检查；质量报告注明版本和实际/预置来源。没有本次执行记录就保持未验证。`:`对照${topic.title}的原需求及明确验收标准核对交付清单。历史验收事实保留，不据新建议生成Owner结论。`;
 return {knowledge:[k('task-focus',topic.title+' · '+names[node]+'要点',detail,node==='prepare'?'business-documents':node==='develop'?'development-knowledge':node==='verify'?'verification-knowledge':'acceptance-knowledge','仅适用于此任务当前节点')],skills:node==='prepare'?['ba-requirement-analysis','ba-acceptance-criteria']:node==='develop'?(taskId==='T108'?['arch-impact-analysis','arch-solution-design']:['arch-solution-design','dev-frontend-ui','dev-api-integration']):node==='verify'?['dev-code-reviewer','dev-unit-test','qa-integration-test','sec-scan-review']:['qa-uat-support'],skillSlot:node==='prepare'?'business-skills':node==='develop'?'development-skills':node==='verify'?'quality-skills':'acceptance-skills'};
}
