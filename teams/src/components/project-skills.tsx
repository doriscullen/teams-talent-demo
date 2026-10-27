import { displayText } from '../display-text.js';
import { useState, type ReactNode } from 'react';
import { Alert, Button, Empty, Pagination, Space, Tabs, Tag } from 'antd';
import { useDemo } from '../context.js';
import { userSkillExamples } from '../project-skill-examples.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { resourceSubscriptions } from '../resource-sharing.js';
import { SkillApplication } from './skill-application.js';
import type { DemoState, Role } from '../domain.js';
import { getResourceContent, type Presentation } from '../api.js';

export interface ProjectSkillEntry {
  name: string;
  description: string;
  version: string;
  source: string;
  path: string;
  displayPath?: string;
  content?: string;
}

export function userSkillsFor(state: DemoState, data: Presentation, role: Role): ProjectSkillEntry[] {
  const subscriptions = new Map(resourceSubscriptions(state, role).map(item => [item.id, item]));
  const entries = new Map<string, ProjectSkillEntry>(userSkillExamples.map(skill => [skill.id, { ...skill, version: skill.id === 'teams-collaboration' ? 'cli-v1' : 'v1', source: skill.id === 'teams-collaboration' ? '本地接入 · Skill 与 CLI' : '用户 Skill', path: skill.id === 'teams-collaboration' ? data.localPaths.collaborationSkill : '', content: skill.id === 'teams-collaboration' ? skill.content.replace('teams/skills/teams-demo-collaboration/SKILL.md', data.localPaths.collaborationSkill).replace('teams/scripts/teams-demo.mjs', data.localPaths.cli) : skill.content }]));
  for (const skill of data.skills) {
    const subscription = subscriptions.get(skill.name);
    if (subscription?.sha256) entries.set(skill.name, { ...skill, version: subscription.version, source: '当前用户订阅 · 固定版本', content: data.skillContents[skill.name] });
  }
  return [...entries.values()];
}

/** Reuses the Teams project-content name/description/path rows and its user/project scope vocabulary. */
export function ProjectSkills({ projectName, skills, projectFooter }: { projectName: string; skills: ProjectSkillEntry[]; projectFooter?: ReactNode }) {
  const { role, showText, data, state, navigate } = useDemo();
  const [scope, setScope] = useState('project'), [page, setPage] = useState(1);
  const [reading, setReading] = useState(''), [readError, setReadError] = useState('');
  const userName = role === 'owner' ? '林悦' : '陈晨';
  const subscriptions = new Map(resourceSubscriptions(state, role).map(item => [item.id, item]));
  const userSkills = userSkillsFor(state, data, role);
  const entries = scope === 'project' ? skills : userSkills;
  const range = scope === 'project' ? `项目级 · 仅 ${projectName}` : `用户级 · 当前用户 ${userName}，跨项目可用`;
  const open = async (skill: ProjectSkillEntry) => {
    setReadError(''); setReading(skill.name);
    try {
      const subscription = scope === 'user' ? subscriptions.get(skill.name) : undefined;
      const content = subscription?.sha256 ? (await getResourceContent(role, { resourceId: skill.name, version: subscription.version, sha256: subscription.sha256 })).content : skill.content;
      if (!content) throw new Error('当前清单未附带该 Skill 的完整正文。');
      showText(skill.name + ' · Skill 说明', [
    `名称：${skill.name}`, `用途：${skill.description}`, `版本：${displayText(skill.version)}`, `来源：${displayText(skill.source)}`, `作用范围：${range}`,
    ...(skill.path ? [`资料路径：${skill.path}`] : []),
    '', subscriptions.get(skill.name)?.sha256 ? '当前用户已订阅此资源。应用到 iCode 是独立操作，请以应用回执中的路径与发现核验结果为准；运行中的会话是否重新加载需另行确认。' : scope === 'user' ? skill.source.startsWith('本地接入') ? '本地 Skill 和 CLI 已提供；iCode 启动材料明确引用文件和读取命令，当前会话实际加载需会话确认。' : '尚未读取本机用户 Skill 目录；安装、工具发现和实际加载均未核验。' : '项目已有资源可在需求澄清中采用；本机应用与会话加载需另行核验。',
    '', content,
  ].join('\n'));
    } catch (cause) { setReadError((cause as Error).message); }
    finally { setReading(''); }
  };
  return <div className="project-skills" role="region" aria-label="项目可用 Skill">
    <FrameworkCard title="项目可用 Skill">
      <Tabs size="small" activeKey={scope} onChange={value => { setScope(value); setPage(1); }} items={[{ key: 'project', label: `项目 Skill · ${skills.length}` }, { key: 'user', label: `用户 Skill · ${userSkills.length}` }]} />
      <div className="project-skill-scope"><span>{range}</span>{scope === 'user' && <Tag>用户资源</Tag>}</div>
      {readError && <Alert type="error" title="Skill 正文读取失败" description={readError} />}
      <div className="project-skill-list">{entries.slice((page - 1) * 5, page * 5).map(skill => <div className="project-skill-row" key={skill.name}>
        <div><strong>{skill.name}</strong><p>{skill.description}</p><div className="project-skill-meta"><span>{displayText(skill.version)} · {displayText(skill.source)}</span>{skill.path && <code title={skill.path}>{skill.displayPath ?? skill.path}</code>}</div></div>
        <Space wrap><Button size="small" loading={reading === skill.name} aria-label={'查看 Skill：' + skill.name} onClick={() => void open(skill)}>查看说明</Button>{!!subscriptions.get(skill.name)?.sha256 && <SkillApplication resourceId={skill.name} version={subscriptions.get(skill.name)!.version} sha256={subscriptions.get(skill.name)!.sha256} />}</Space>
      </div>)}</div>
      {!entries.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未关联项目 Skill" />}
      <Pagination size="small" responsive hideOnSinglePage current={page} pageSize={5} total={entries.length} showSizeChanger={false} onChange={setPage} />
      {scope === 'project' && projectFooter}
      <p className="muted project-skill-note">此处展示项目已有资源与当前用户资源；本次采用以需求澄清中的选择与冻结记录为准。Office 用户 Skill 仅保留能力说明，不属于市场的 {data.skills.length} 项 Skill。</p><Button size="small" onClick={() => navigate('subscriptions')}>查看我的订阅</Button>
    </FrameworkCard>
  </div>;
}
