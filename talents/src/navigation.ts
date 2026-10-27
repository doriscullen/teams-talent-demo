// Pages of the two entries. 管理员端 is the Teams owner (mines and publishes knowledge); 开发者端 is a Teams
// member (applies it). The sidebar shows the current entry's pages, and opening a page switches to its entry.
// 团队 and each project are levels: each has its own sources, knowledge tasks and artifacts, shown as tabs.
import type { PageDefinition } from './vendor/teams/page-registry.ts';
import type { Role } from './types.ts';

export interface TalentsPage extends PageDefinition { role: Role }
export const pages: TalentsPage[] = [
  { id: 'team', route: 'team', title: '团队', role: 'admin', groupId: 'team', icon: 'members' },
  { id: 'projects', route: 'projects', title: '项目', role: 'admin', groupId: 'team', icon: 'projects' },
  { id: 'capabilities', route: 'capabilities', title: '知识能力', role: 'admin', groupId: 'team', icon: 'appstore' },
  { id: 'knowledge', route: 'knowledge', title: '项目知识', role: 'dev', groupId: 'personal', icon: 'subscriptions' },
  { id: 'local', route: 'local', title: '本地索引', role: 'dev', groupId: 'personal', icon: 'insights' },
];
export const home: Record<Role, string> = { admin: 'projects', dev: 'knowledge' };
export const roleLabel: Record<Role, string> = { admin: '管理员端', dev: '开发者端' };
/** Teams links to #/dev-knowledge for the developer's project knowledge. */
const aliases: Record<string, string> = { 'dev-knowledge': 'knowledge' };

export const levelTabs = [{ key: 'review', label: '产物管理' }, { key: 'tasks', label: '知识任务' }, { key: 'sources', label: '来源' }] as const;
export type LevelTab = typeof levelTabs[number]['key'];
/** A tab of a level: #/projects?project=<id>&tab=<tab>, or #/team?tab=<tab> for the team; extra parameters follow. */
export function levelHash(pid: string | null, tab: LevelTab = 'review', extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...(pid ? { project: pid } : {}), ...(tab === 'review' ? {} : { tab }), ...extra }).toString();
  return '#/' + (pid ? 'projects' : 'team') + (query ? '?' + query : '');
}

export interface Route { page: TalentsPage; params: Record<string, string> }
/** #/<page>?<params>; an unknown page is null and the caller falls back to the entry's home.
 *  Teams links to #/review?project=<id> and #/tasks?project=<id>: a tab name opens that tab of the project. */
export function parseHash(hash: string): { page: TalentsPage | null; params: Record<string, string> } {
  const [name, query] = hash.replace(/^#\/?/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (levelTabs.some(t => t.key === name)) return { page: pages.find(p => p.id === (params.project ? 'projects' : 'team'))!, params: { ...params, tab: name } };
  const id = aliases[name] ?? name;
  return { page: pages.find(p => p.id === id) ?? null, params };
}
