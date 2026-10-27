import type { DemoState } from './domain.js';

export type Presence = '未使用' | '离线' | '在线空闲' | '执行中' | '等待人工处理';
export interface DemoInstance { id: string; state: Presence; task: string; project: string }
export interface DemoMember { id: string; name: string; used: boolean; today: boolean; lastActive: string; tokens: number; instances: DemoInstance[] }
export function teamUsage(state: DemoState): DemoMember[] {
  const current: Presence = state.stage === 'developing' ? '执行中' : ['failed', 'returned'].includes(state.stage) ? '等待人工处理' : '在线空闲';
  return [
    { id: 'lin', name: '林悦', used: true, today: true, lastActive: '刚刚', tokens: 42000, instances: [{ id: 'IC-DEMO-01', state: '在线空闲', task: '等待发起作业', project: state.workspace.project.name }] },
    { id: 'chen', name: '陈晨', used: true, today: true, lastActive: state.context ? '刚刚' : '今天 09:12', tokens: state.context ? 168000 : 12000, instances: [{ id: 'IC-DEMO-02', state: current, task: state.assigned ? '信用卡消费返现' : '等待需求分配', project: state.workspace.project.name }, { id: 'IC-DEMO-03', state: '离线', task: '历史代码阅读', project: state.workspace.project.name }] },
    { id: 'su', name: '苏晴', used: true, today: true, lastActive: '刚刚', tokens: 96000, instances: [{ id: 'IC-DEMO-04', state: '执行中', task: '账单查询接口回归', project: '账户服务维护' }] },
    { id: 'yang', name: '杨帆', used: true, today: true, lastActive: '2 分钟前', tokens: 64000, instances: [{ id: 'IC-DEMO-05', state: '等待人工处理', task: '确认接口变更范围', project: '账户服务维护' }] },
    { id: 'zhao', name: '赵宁', used: true, today: false, lastActive: '昨天 17:38', tokens: 0, instances: [{ id: 'IC-DEMO-06', state: '离线', task: '无运行作业', project: state.workspace.project.name }] },
    { id: 'wang', name: '王晓', used: false, today: false, lastActive: '尚无记录', tokens: 0, instances: [] },
  ];
}
export function presence(member: DemoMember): Presence {
  if (!member.used) return '未使用';
  for (const status of ['执行中', '等待人工处理', '在线空闲', '离线'] as const) if (member.instances.some(i => i.state === status)) return status;
  return '离线';
}
export function usageSummary(members: DemoMember[]) {
  const people = [...new Map(members.map(m => [m.id, m])).values()];
  return { total: people.length, used: people.filter(m => m.used).length, today: people.filter(m => m.today).length,
    online: people.filter(m => m.instances.some(i => ['在线空闲', '执行中', '等待人工处理'].includes(i.state))).length,
    running: people.filter(m => m.instances.some(i => i.state === '执行中')).length,
    tokens: people.reduce((sum, m) => sum + m.tokens, 0) };
}
