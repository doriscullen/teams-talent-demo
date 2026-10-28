import type { Role } from './domain.js';

export interface SystemRuntime { app: 'teams'; teamsOrigin: string; talentOrigin: string }
export interface SystemLinkContext { projectId?: string; requirementId?: string; taskId?: string; role?: Role }
export function systemRuntime(): SystemRuntime {
  const element = document.getElementById('demo-system-runtime');
  if (!element?.textContent) throw new Error('缺少系统地址配置，请通过应用服务打开页面');
  const value = JSON.parse(element.textContent) as SystemRuntime;
  for (const origin of [value.teamsOrigin, value.talentOrigin]) {
    const url = new URL(origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.origin !== origin) throw new Error('系统地址无效');
  }
  if (value.app !== 'teams' || value.teamsOrigin === value.talentOrigin) throw new Error('Teams 与 Talents 必须使用独立地址');
  return value;
}
export function currentSystemContext(): Required<Pick<SystemLinkContext, 'projectId' | 'role'>> & Pick<SystemLinkContext, 'requirementId' | 'taskId'> {
  const search = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.split('?')[1]);
  const projectId = hash.get('project') ?? search.get('project') ?? 'carddemo';
  const taskId = hash.get('task') ?? search.get('task') ?? undefined;
  const requestedRole = search.get('demo-role');
  return { projectId, taskId, role: requestedRole === 'member' || requestedRole === 'owner' ? requestedRole : localStorage.getItem('carddemo-role') === 'member' ? 'member' : 'owner', requirementId: hash.get('requirement') ?? search.get('requirement') ?? (projectId === 'carddemo' ? 'DEMO-MKT-001' : projectId === 'teams' && taskId ? 'REQ-' + taskId : undefined) };
}
function teamsSystemLink(page: string, supplied: SystemLinkContext = {}) {
  const current = currentSystemContext();
  const context = { ...current, ...supplied };
  if (supplied.projectId && supplied.projectId !== current.projectId) {
    if (!supplied.requirementId) context.requirementId = supplied.projectId === 'carddemo' ? 'DEMO-MKT-001' : undefined;
    if (!supplied.taskId) context.taskId = undefined;
  }
  const [path, query] = page.replace(/^#\/?/, '').split('?');
  const hash = new URLSearchParams(query);
  if (hash.has('project') && hash.get('project') !== context.projectId) {
    if (!hash.has('requirement')) context.requirementId = hash.get('project') === 'carddemo' ? 'DEMO-MKT-001' : undefined;
    context.taskId = undefined;
  }
  if (!hash.has('project')) hash.set('project', context.projectId);
  if (!hash.has('requirement') && context.requirementId) hash.set('requirement', context.requirementId);
  if (!hash.has('task') && context.taskId) hash.set('task', context.taskId);
  const url = new URL('/teams', systemRuntime().teamsOrigin);
  url.searchParams.set('demo-role', context.role);
  url.hash = '/' + path + '?' + hash;
  return url.toString();
}
export const teamsLink = (page: string, context?: SystemLinkContext) => teamsSystemLink(page, context);
/** Talents is a separate app used by the owner to mine knowledge and submit PRs. Old Talent page names map to the closest Talents page. */
export function talentLink(page: string, supplied: SystemLinkContext = {}) {
  const context = { ...currentSystemContext(), ...supplied };
  const name = page.replace(/^#\/?/, '').split('?')[0];
  const target = name === 'knowledge' ? 'review' : ['sessions', 'evolution'].includes(name) ? 'tasks' : name;
  const url = new URL('/talents', systemRuntime().talentOrigin);
  url.searchParams.set('role', 'owner');
  url.hash = '/' + target + '?project=' + encodeURIComponent(context.projectId);
  return url.toString();
}
