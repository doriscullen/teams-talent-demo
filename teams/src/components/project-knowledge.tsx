import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Segmented, Space, Spin, Tag } from 'antd';
import { marked } from 'marked';
import { getTalentsFile, getTalentsKnowledge } from '../api.js';
import { useDemo } from '../context.js';
import { FrameworkCard } from '../vendor/teams/components/page-layout.js';
import { talentLink } from './common.js';
import type { PublishedArtifact, PublishedFile } from '../../../shared/contracts.js';

const categoryNames: Record<string, string> = { index: '知识索引', doc: '文档知识提取', code: '代码知识挖掘', traj: '轨迹分析' };
const categoryOrder = ['doc', 'code', 'traj', 'index'];
const deliveryNames = { local: '同步到本地', cloud: '云端查询' };
const day = (value: string) => value.slice(0, 16).replace('T', ' ');

/** Renders one published file the way Talents shows it: markdown, a standalone HTML report, or plain text. */
function FileView({ artifact, file }: { artifact: PublishedArtifact; file: PublishedFile }) {
  const [content, setContent] = useState<string | null>(null), [failure, setFailure] = useState('');
  useEffect(() => {
    let live = true; setContent(null); setFailure('');
    getTalentsFile(artifact, file.path).then(value => { if (live) setContent(value.content); }).catch(error => { if (live) setFailure((error as Error).message); });
    return () => { live = false; };
  }, [artifact.id, artifact.version, file.path]);
  if (failure) return <Alert type="error" showIcon title="无法读取产物文件" description={failure} />;
  if (content === null) return <Spin size="small" />;
  if (file.type === 'markdown') return <div className="talents-markdown" dangerouslySetInnerHTML={{ __html: marked.parse(content, { async: false }) }} />;
  if (file.type === 'html') return <iframe className="talents-report" title={file.title} sandbox="" srcDoc={content} />;
  return <pre className="talents-plain">{content}</pre>;
}

function ArtifactDrawer({ artifact, onClose }: { artifact: PublishedArtifact; onClose: () => void }) {
  const [path, setPath] = useState(artifact.files[0]?.path);
  const file = artifact.files.find(item => item.path === path);
  return <Drawer className="talents-artifact-drawer" title={artifact.name} width={880} open onClose={onClose} destroyOnHidden>
    <Descriptions size="small" column={2} items={[
      { key: 'capability', label: '能力', children: artifact.capabilityName },
      { key: 'version', label: '版本', children: `v${artifact.version} · ${day(artifact.publishedAt)}` },
      { key: 'delivery', label: '交付方式', children: deliveryNames[artifact.delivery] },
      { key: 'note', label: '更新说明', children: artifact.note },
      ...(artifact.stats ?? []).map(([label, value]) => ({ key: label, label, children: value })),
    ]} />
    {artifact.kind === 'index'
      ? <><p className="muted">索引类知识通过 MCP 在线查询，开发者在 Talents 应用后由 iCode 直接调用。</p>{artifact.id === 'a-cg-java' && <Button href={talentLink('review', { projectId: artifact.projectId ?? undefined }) + '&id=' + encodeURIComponent(artifact.id)} target="_blank" rel="noreferrer">查看真实代码图谱</Button>}</>
      : <>{artifact.files.length > 1 && <Segmented className="talents-file-tabs" value={path} onChange={value => setPath(value as string)} options={artifact.files.map(item => ({ value: item.path, label: item.title }))} />}
        {file && <FileView artifact={artifact} file={file} />}</>}
  </Drawer>;
}

/** Knowledge Talents has published for this project, read by the Teams server from the shared data directory. */
export function ProjectKnowledge({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const { state, role } = useDemo();
  const [expanded, setExpanded] = useState(false), [opened, setOpened] = useState<PublishedArtifact | null>(null);
  const [artifacts, setArtifacts] = useState<PublishedArtifact[] | null>(null), [failure, setFailure] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setFailure('');
    getTalentsKnowledge(projectId).then(value => { if (live) setArtifacts(value.artifacts); }).catch(error => { if (live) setFailure((error as Error).message); });
    return () => { live = false; };
  }, [projectId, state.revision, attempt]);
  useEffect(() => setArtifacts(null), [projectId]);
  useEffect(() => { const refresh = () => setAttempt(value => value + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const loading = artifacts === null && !failure, ready = !!artifacts?.length;
  const status = loading ? '读取中' : failure ? '读取失败' : ready ? `已发布 ${artifacts!.length} 项` : '尚未发布';
  const groups = categoryOrder.concat([...new Set((artifacts ?? []).map(item => item.category))].filter(id => !categoryOrder.includes(id)))
    .map(id => ({ id, items: (artifacts ?? []).filter(item => item.category === id) })).filter(group => group.items.length);
  const content = <div className="project-knowledge talents-knowledge" data-knowledge-project={projectId}>
    {loading ? <Space><Spin size="small" /><span className="muted">正在读取 Talents 项目知识…</span></Space>
      : failure ? <Alert showIcon type="error" title="无法读取 Talents 项目知识" description={failure} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : ready ? groups.map(group => <section key={group.id} className="talents-knowledge-group"><h4>{categoryNames[group.id] ?? group.id}</h4>
        <div className="project-material-list">{group.items.map(artifact => <div className="project-material" key={artifact.id} data-artifact={artifact.id}><div>
          <strong>{artifact.name}</strong><p>{artifact.description}</p>
          <small>{artifact.capabilityName} · v{artifact.version} · 发布于 {day(artifact.publishedAt)}{artifact.note ? ' · ' + artifact.note : ''}</small>
        </div>{artifact.projectId === null && <Tag>团队知识</Tag>}<Tag>{deliveryNames[artifact.delivery]}</Tag><Button size="small" onClick={() => setOpened(artifact)}>查看</Button></div>)}</div></section>)
      : <><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Talents 尚未为此项目发布知识" /><p className="muted">Talents 读取本项目对接的代码仓与设计文档挖掘知识，Owner 审阅发布后在这里展示。</p></>}
    <Space wrap className="card-actions">
      <Button type={ready ? 'default' : 'primary'} href={talentLink('knowledge', { projectId, role })}>{role === 'owner' ? '在 Talents 挖掘知识' : '在 Talents 应用知识'}</Button>
      {!loading && <Button size="small" onClick={() => setAttempt(value => value + 1)}>刷新</Button>}
    </Space>
    {opened && <ArtifactDrawer artifact={opened} onClose={() => setOpened(null)} />}
  </div>;
  const card = <FrameworkCard title="项目知识" action={<Tag color={ready && !failure ? 'green' : undefined}>{status}</Tag>}>{content}</FrameworkCard>;
  if (!compact) return card;
  return <div className="overview-knowledge-summary" data-knowledge-summary={projectId}>
    <strong>项目知识</strong><Tag color={ready && !failure ? 'green' : undefined}>{status}</Tag><span className="muted">{failure ? 'Talents 知识读取失败' : ready ? `${artifacts!.length} 项 Talents 产物` : '来自 Talents 发布'}</span><Button size="small" onClick={() => setExpanded(true)}>查看知识</Button>
    {failure && <Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>}
    <Drawer className="project-knowledge-drawer" title="项目知识" width={760} open={expanded} onClose={() => setExpanded(false)} destroyOnHidden>{card}</Drawer>
  </div>;
}
