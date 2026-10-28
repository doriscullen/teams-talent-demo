// 知识能力：按四类展示 Talents 提供的知识生成能力。从这里新建任务时，在表单中选择任务属于团队还是哪个项目。
import { useState } from 'react';
import { Button } from 'antd';
import { PageHeader } from '../vendor/teams/components/page-layout.tsx';
import { useTalents } from '../store.tsx';
import { levelHash } from '../navigation.ts';
import { CapIcon, CardGrid, Fields, ItemCard, Section } from '../components/ui.tsx';
import { TaskForm } from './tasks.tsx';

export function Capabilities() {
  const { state: st, go, toast } = useTalents();
  const [creating, setCreating] = useState<string | null>(null);
  return <div className="page-stack">
    <PageHeader title="知识能力" description="每种能力把一类来源变成 Agent 用得上的知识。能力负责首次构建；支持更新的能力，在来源变化后只处理变化的部分。" />
    {st.categories.map(cat => <Section key={cat.id} title={cat.name} note={cat.desc}>
      <CardGrid>{st.capabilities.filter(c => c.cat === cat.id).map(c => {
        const used = st.tasks.filter(t => t.cap === c.id).length;
        return <ItemCard key={c.id} icon={<CapIcon cap={c} />} title={c.name} subtitle={c.desc}
          caption={used ? used + ' 个任务在用' : '尚未使用'} actions={<Button size="small" onClick={() => setCreating(c.id)}>新建任务</Button>}>
          <Fields rows={[['输入', c.inputLabel], ['产出', c.output], ['更新', c.update ?? <span className="ui-note">不支持，{c.noUpdate ?? '每次运行重新构建'}</span>]]} />
        </ItemCard>;
      })}</CardGrid>
    </Section>)}
    {creating && <TaskForm preset={{ cap: creating }} onClose={() => setCreating(null)} onCreated={(id, started, level) => {
      setCreating(null);
      go(levelHash(level, 'tasks', started ? { open: id } : {}));
      if (!started) toast('已创建任务');
    }} />}
  </div>;
}
