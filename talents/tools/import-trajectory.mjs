// Imports a trajectory diagnosis report (the single-file HTML the diagnosis engine writes) as Talents content:
// the report itself, and report.json with what the review page needs (overview and the improvement suggestions).
// Usage: node tools/import-trajectory.mjs <report.html> <topic>
// The report is served by the Talents service rather than bundled into the page (see tools/bundle-content.mjs).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [source, topic] = process.argv.slice(2);
if (!source || !topic) throw new Error('用法：node tools/import-trajectory.mjs <report.html> <topic>');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'trajectory', topic);
const html = readFileSync(source, 'utf8');
const data = JSON.parse(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null');
if (!data?.improvements) throw new Error('不是轨迹诊断报告：缺少 report-data');

const list = value => Array.isArray(value) ? value : value ? [value] : [];
const suggestions = data.improvements.map(i => ({
  id: i.id, kind: i.kind, title: i.title, priority: i.priority,
  background: i.narrative?.background ?? '', observation: i.narrative?.observation ?? '', goal: i.narrative?.goal ?? '',
  change: i.change_summary ?? '', risks: list(i.risks), validation: list(i.validation_steps),
  // The skill is named by source_id; its file changes are the main text plus the supporting changes.
  skill: i.kind === 'skill' ? i.source_id : undefined,
  files: [{ path: i.kind === 'skill' ? 'SKILL.md' : '', before: i.before, after: i.after },
    ...list(i.supporting_changes).map(c => ({ path: c.path.replace(new RegExp('^' + i.source_id + '/'), ''), before: c.before, after: c.after, reason: c.reason }))],
}));
mkdirSync(dir, { recursive: true });
copyFileSync(source, join(dir, '轨迹诊断报告.html'));
writeFileSync(join(dir, 'report.json'), JSON.stringify({
  title: data.overview.title, summary: data.overview.summary, generatedAt: data.generated_at,
  chains: data.chains.length, suggestions,
}, null, 2) + '\n');
console.log(`imported ${topic}: ${suggestions.length} 条建议（${suggestions.map(s => s.kind).join('、')}）`);
