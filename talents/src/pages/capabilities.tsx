// 知识能力：按四类展示 Talents 提供的知识生成能力，点开卡片在右侧抽屉看一种能力的详细介绍和定义（engine.yaml）。
// 从这里新建任务时，在表单中选择任务属于团队还是哪个项目。也可以导入自定义能力：选择一个定义包，校验声明后
// 加入所选分类。演示只读取和校验声明，不执行其中的任何命令；初版不提供安装和卸载。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Collapse, Drawer, Select, Spin, Tag, Tooltip, Upload } from 'antd';
import { CheckCircleFilled, ImportOutlined, InboxOutlined } from '@ant-design/icons';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import { CapIcon, CardGrid, Fields, InfoTip, ItemCard, Section } from '../components/ui.tsx';
import type { Capability } from '../types.ts';
import { capabilityOf, engineOf, engineText, EXAMPLE, guessCategory, operationText, outputText, readEngine, sourceKind, type EngineDecl } from '../demo/engine.ts';
import { TaskForm } from './tasks.tsx';

export function Capabilities() {
  const { state: st, go, toast } = useTalents();
  const [creating, setCreating] = useState<string | null>(null), [opened, setOpened] = useState<string | null>(null), [importing, setImporting] = useState(false);
  const cap = opened ? st.capabilities.find(c => c.id === opened) : undefined;
  return <div className="page-stack">
    <PageHeader title="知识能力"
      actions={<Button icon={<ImportOutlined />} onClick={() => setImporting(true)}>导入能力</Button>} />
    {st.categories.map(cat => <Section key={cat.id} title={cat.name} info={cat.desc}>
      <CardGrid>{st.capabilities.filter(c => c.cat === cat.id).map(c =>
        <ItemCard key={c.id} icon={<CapIcon cap={c} />} title={c.name} subtitle={c.desc} onClick={() => setOpened(c.id)} extra={<CapTags c={c} />}
          actions={<Button size="small" onClick={() => setCreating(c.id)}>新建任务</Button>}>
          <Fields rows={[['输入', c.inputLabel], ['产出', c.output]]} />
        </ItemCard>)}</CardGrid>
    </Section>)}
    {cap && <CapabilityDetail cap={cap} onClose={() => setOpened(null)} onCreate={() => { setOpened(null); setCreating(cap.id); }} />}
    {importing && <ImportCapability onClose={() => setImporting(false)} onImported={id => { setImporting(false); setOpened(id); }} />}
    {creating && <TaskForm preset={{ cap: creating }} onClose={() => setCreating(null)} onCreated={(id, started, level) => {
      setCreating(null);
      go(levelHash(level, 'tasks', started ? { open: id } : {}));
      if (!started) toast('已创建任务');
    }} />}
  </div>;
}

/** 增量更新 when the capability declares an update (its rule in the tooltip); 已导入 for an imported one. */
const CapTags = ({ c }: { c: Capability }) => <span className="tags">
  {c.update && <Tooltip title={c.update}><Tag color="processing">增量更新</Tag></Tooltip>}{c.custom && <Tag>已导入</Tag>}</span>;

// ---------- Definition ----------
/** What engine.yaml declares: how the capability is built, updated and checked, and where it writes. */
function Definition({ e, text, builtin }: { e: EngineDecl; text: string; builtin?: boolean }) {
  const op = (o: EngineDecl['build'] | undefined) => o && <code className="cmd">{operationText(o)}</code>;
  return <div className="field"><span className="label">能力定义</span>
    <Fields rows={[
      ['ID', <code>{e.id}</code>], ['版本', <>{e.definitionVersion ?? '—'}{builtin && <Tag className="inline-tag">内置</Tag>}</>],
      ['执行方式', e.build.skill ? 'iCode Skill' : '命令'],
      ['构建', op(e.build)], ['更新', e.update ? op(e.update) : '—'],
      !!e.check && ['自检', op(e.check)],
      ['产物目录', outputText(e)], !!e.applications?.length && ['应用入口', e.applications!.map(a => a.name + '（MCP：' + [a.command, ...(a.args ?? [])].join(' ') + '）').join('；')],
    ]} />
    <Collapse size="small" items={[{ key: 'yaml', label: '查看 engine.yaml', children: <pre className="log yaml">{text}</pre> }]} />
  </div>;
}

// ---------- Detail ----------
function CapabilityDetail({ cap, onClose, onCreate }: { cap: Capability; onClose(): void; onCreate(): void }) {
  const { state: st, update, toast } = useTalents();
  const { modal } = App.useApp();
  const e = engineOf(cap), text = engineText(cap);
  const used = st.tasks.some(t => t.cap === cap.id) || st.artifacts.some(a => a.cap === cap.id);
  const remove = () => modal.confirm({ title: '移除能力“' + cap.name + '”？', okText: '移除', okButtonProps: { danger: true }, cancelText: '取消',
    content: '移除后，这个能力不再出现在知识能力中，也不能再新建任务。',
    onOk: () => { update(d => { d.capabilities = d.capabilities.filter(c => c.id !== cap.id); }); onClose(); toast('已移除能力'); } });
  return <Drawer open width={600} onClose={onClose} title={<div><div className="caption">{st.categories.find(c => c.id === cap.cat)?.name}</div><div className="title-row">{cap.name}<CapTags c={cap} /></div></div>}
    footer={<div className="drawer-foot">
      {cap.custom && <Tooltip title={used ? '有任务或产物使用这个能力，先删除这些任务' : ''}><Button danger disabled={used} onClick={remove}>移除能力</Button></Tooltip>}
      <span className="spacer" />
      <Button type="primary" onClick={onCreate}>新建任务</Button>
    </div>}>
    <div className="form-body">
      <p className="lead">{cap.desc}</p>
      <div className="field"><span className="label">输入</span><p>{cap.detail.input}</p></div>
      {cap.detail.abilities.length > 0 && <div className="field"><span className="label">核心能力</span>
        <div className="cap-abilities">{cap.detail.abilities.map(([name, text], i) => <div key={name} className="cap-ability">
          <span className="cap-ability-index">{i + 1}</span><div><b>{name}</b><div className="caption">{text}</div></div>
        </div>)}</div>
      </div>}
      <div className="field"><span className="label">输出</span><p>{cap.detail.output}</p></div>
      {e && text && <Definition e={e} text={text} builtin={!cap.custom} />}
    </div>
  </Drawer>;
}

// ---------- Import ----------
interface Picked { name: string; files: string[]; text: string | null }
/** Checks a definition package like Talents' registration: only engine.yaml, README.md, scripts/ and skills/ at the
 *  root, a valid declaration, and an id not taken; stops at the first problem. */
function check(st: { capabilities: Capability[] }, p: Picked): { engine?: EngineDecl; error?: string; checks: string[] } {
  const checks: string[] = [];
  const odd = p.files.map(f => f.split('/')[0]).find(top => !['engine.yaml', 'README.md', 'scripts', 'skills', '.DS_Store'].includes(top));
  if (odd) return { checks, error: '根目录只能包含 engine.yaml、README.md、scripts/ 和 skills/，发现了不支持的“' + odd + '”' };
  if (p.text == null) return { checks, error: '定义包里没有 engine.yaml' };
  checks.push('目录结构符合要求');
  const read = readEngine(p.text);
  if ('error' in read) return { checks, error: read.error };
  checks.push('engine.yaml 有效');
  const e = read.engine;
  const refs = [e.build, e.update, e.install, e.uninstall, e.check].flatMap(o => (o?.args ?? []).filter(a => a.startsWith('${package.root}/')).map(a => a.slice('${package.root}/'.length)));
  const missing = p.files.length > 1 ? refs.find(r => !p.files.includes(r)) : undefined;
  if (missing) return { checks, error: '声明引用的包内文件不存在：' + missing };
  if (refs.length) checks.push('引用的包内文件存在');
  if (st.capabilities.some(c => c.id === e.id)) return { checks, error: '已经有 ID 为“' + e.id + '”的能力，不能重复导入' };
  checks.push('ID 可用');
  if (!sourceKind(e)) return { checks, error: '演示只支持输入来源为代码仓（repositories）、文档集（documents）或会话（sessions）的能力' };
  return { engine: e, checks };
}

function ImportCapability({ onClose, onImported }: { onClose(): void; onImported(id: string): void }) {
  const { state: st, update, toast } = useTalents();
  const [picked, setPicked] = useState<Picked | null>(null), [checking, setChecking] = useState(false), [cat, setCat] = useState<string | null>(null);
  const result = useMemo(() => picked && !checking ? check(st, picked) : null, [picked, checking, st]), e = result?.engine;
  useEffect(() => { setCat(result?.engine ? guessCategory(result.engine) : null); }, [result]);
  const pick = (p: Picked) => { setPicked(p); setChecking(true); setTimeout(() => setChecking(false), 1100); };
  // A folder (every file, engine.yaml at its root) or engine.yaml alone.
  const readFiles = async (files: File[]) => {
    const rel = files.map(f => ({ f, path: (f.webkitRelativePath || f.name).split('/').slice(f.webkitRelativePath ? 1 : 0).join('/') }));
    const yaml = rel.find(x => x.path === 'engine.yaml' || x.path === 'engine.yml');
    pick({ name: files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : files[0].name, files: rel.map(x => x.path), text: yaml ? await yaml.f.text() : null });
  };
  const confirm = () => {
    const c = capabilityOf(e!, picked!.text!, cat!);
    update(d => { d.capabilities.push(c); });
    toast('已导入能力“' + c.name + '”');
    onImported(c.id);
  };
  const batch = useRef<File[]>([]);
  const uploadProps = (directory: boolean) => ({
    showUploadList: false, multiple: directory, directory, accept: directory ? undefined : '.yaml,.yml',
    beforeUpload: (file: File, list: File[]) => {
      // Upload calls this once per file; read the whole selection once.
      if (batch.current !== list) { batch.current = list; void readFiles(list); }
      return false;
    },
  });
  let body: ReactNode;
  if (!picked) body = <>
    <Upload.Dragger {...uploadProps(true)} className="import-drop">
      <p className="ant-upload-drag-icon"><InboxOutlined /></p>
      <p>选择或拖入定义包文件夹</p>
    </Upload.Dragger>
    <div className="import-alt"><Upload {...uploadProps(false)}><Button size="small">选择 engine.yaml</Button></Upload>
      <Button size="small" type="link" onClick={() => pick({ name: EXAMPLE.folder, files: EXAMPLE.files, text: EXAMPLE.text() })}>使用示例</Button></div>
  </>;
  else body = <>
    <div className="pick-summary"><span><b>{picked.name}</b> <span className="section-count">{picked.files.length} 个文件</span></span><Button size="small" onClick={() => setPicked(null)}>重新选择</Button></div>
    {checking ? <Spin size="small" /> : <>
      <ul className="check-list">{result!.checks.map(c => <li key={c}><CheckCircleFilled /> {c}</li>)}</ul>
      {result!.error && <Alert type="error" showIcon title={result!.error} />}
      {e && <>
        <div><h3 className="block-title">{e.name}</h3>{e.description && <p className="lead">{e.description}</p>}</div>
        <div className="field"><span className="label">分类</span><Select value={cat} onChange={setCat} options={st.categories.map(c => ({ value: c.id, label: c.name }))} /></div>
        <Definition e={e} text={picked.text!} />
        <Alert type="warning" showIcon title={<>只导入你信任的能力包 <InfoTip>构建和更新会执行包内脚本和声明的命令，进程以 Talents 服务的权限运行。</InfoTip></>} />
      </>}
    </>}
  </>;
  return <Drawer open width={600} onClose={onClose} title={<>导入能力 <InfoTip>定义包根目录包含 engine.yaml，可选 README.md、scripts/、skills/。engine.yaml 声明输入、产物目录，以及构建、更新和自检的方式。</InfoTip></>}
    footer={<div className="drawer-foot"><span className="spacer" />
      <Button onClick={onClose}>取消</Button><Button type="primary" disabled={!e || !cat} onClick={confirm}>导入</Button></div>}>
    <div className="form-body">
      {body}
    </div>
  </Drawer>;
}
