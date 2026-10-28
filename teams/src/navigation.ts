import type { Role } from './domain.js';
import type { PageDefinition } from './vendor/teams/page-registry.js';

const common: PageDefinition[] = [
  { id: 'home', route: 'home', title: '工作台', groupId: 'personal', icon: 'home' },
  { id: 'agent', route: 'agent', title: 'Agent 管理', groupId: 'personal', icon: 'agent' },
  { id: 'projects', route: 'projects', title: '项目', groupId: 'team', icon: 'projects' },
  { id: 'team', route: 'team', title: '团队', groupId: 'team', icon: 'members' },
  { id: 'team-work', route: 'team-work', title: '任务追溯', groupId: 'team', icon: 'insights' },
  { id: 'resources', route: 'resources', title: '资源市场', groupId: 'shared', icon: 'appstore' },
  { id: 'subscriptions', route: 'subscriptions', title: '我的订阅', groupId: 'shared', icon: 'subscriptions' },
  { id: 'publications', route: 'publications', title: '我的发布', groupId: 'shared', icon: 'publications' },
  { id: 'talent', route: 'talent', title: 'Talents', groupId: 'custom', icon: 'appstore' },
];
export function teamsPages(role: Role): PageDefinition[] {
  return role === 'member' ? common : [...common.slice(0, 4),
    { id: 'connections', route: 'connections', title: '企业连接', groupId: 'team', icon: 'appstore' },
    ...common.slice(4)];
}
export const isOwnerPage = (path: string) => ['connections', 'organization', 'trace-monitor'].includes(path);
