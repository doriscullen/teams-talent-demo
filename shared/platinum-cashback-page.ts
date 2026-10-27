/** Explicit scenario selection, not keyword inference or an automatic adoption decision. */
export const platinumCashbackPage = {
  id: 'platinum-cashback-page-v1', projectId: 'carddemo', title: '白金卡消费返现权益说明页',
  artifactId: 'a-platinum-cashback-page', version: 1,
  description: '在信用卡详情中增加“消费返现权益”入口，白金卡客户可查看活动说明，非白金卡不展示入口。只确定白金卡、未来3个月、额外0.5%；页面展示适用客户/期限/比例，并区分已确认与待确认。日期起算、消费范围、上限、舍入、到账时间、退款口径待定。仅做权益入口和说明页，不改实际返现计算/入账。需求澄清形成PRD，后续设计代码/测试报告按现有四节点合同。',
  manifest: 'platinum-cashback-page/provenance.json',
  files: {
    rules: 'platinum-cashback-page/权益展示规则.md', questions: 'platinum-cashback-page/待确认清单.md',
    implementation: 'platinum-cashback-page/现有模块与UI参考.md', acceptance: 'platinum-cashback-page/验收用例.md',
  },
} as const;
export type ScenarioNode = 'prepare' | 'develop' | 'verify' | 'accept';
type KnowledgeSelection = { file: keyof typeof platinumCashbackPage.files; slot: string; reason: string };
export const platinumCashbackPageNodes: Record<ScenarioNode, { knowledge: KnowledgeSelection[]; skills: string[]; skillSlot: string }> = {
  prepare: { knowledge: [
    { file: 'rules', slot: 'business-documents', reason: '核对权益说明页的确认边界与排除范围' },
    { file: 'questions', slot: 'business-documents', reason: '在 PRD 中登记未决政策和资格字段缺口' },
    { file: 'implementation', slot: 'business-documents', reason: '用实际卡片详情结构约束方案可行性' },
  ], skills: ['ba-requirement-analysis','ba-acceptance-criteria'], skillSlot: 'business-skills' },
  develop: { knowledge: [
    { file: 'rules', slot: 'development-knowledge', reason: '限制本次只实现入口与说明展示' },
    { file: 'implementation', slot: 'development-knowledge', reason: '复用实际静态 Web 模块和已存在接口' },
    { file: 'questions', slot: 'development-knowledge', reason: '防止实现中补造未确认政策或等级字段' },
  ], skills: ['arch-solution-design','dev-frontend-ui','dev-unit-test'], skillSlot: 'development-skills' },
  verify: { knowledge: [
    { file: 'acceptance', slot: 'verification-knowledge', reason: '形成资格、文案、异常和不触发资金操作的检查' },
    { file: 'rules', slot: 'verification-knowledge', reason: '核对实现与确认范围一致' },
    { file: 'questions', slot: 'verification-knowledge', reason: '对未决政策不设置虚构测试预期' },
  ], skills: ['dev-code-reviewer','dev-unit-test','qa-integration-test','sec-scan-review'], skillSlot: 'quality-skills' },
  accept: { knowledge: [
    { file: 'acceptance', slot: 'acceptance-knowledge', reason: 'Owner 对照交付物与检查报告逐项确认' },
    { file: 'rules', slot: 'acceptance-knowledge', reason: '核对权益说明没有扩大到计算或入账' },
    { file: 'questions', slot: 'acceptance-knowledge', reason: '明确遗留事项、解决依据或退回原因' },
  ], skills: ['qa-uat-support'], skillSlot: 'acceptance-skills' },
};
export function matchesPlatinumCashbackPage(projectId:string,task:{id:string;title:string}){
  return projectId===platinumCashbackPage.projectId && /^REQ-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id) && task.title===platinumCashbackPage.title;
}
