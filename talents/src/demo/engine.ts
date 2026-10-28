// Capability definition packages. In Talents a capability (an "engine") is a package whose engine.yaml declares
// its inputs, outputs and how to build, update, install, uninstall and check it. The demo reads and checks the
// declaration like Talents does, but never runs any of it.
import type { Capability, Param } from '../types.ts';
import { content } from '../content.ts';

// ---------- YAML ----------
// The subset engine.yaml uses: block mappings and sequences, flow sequences and mappings, quoted and plain
// scalars, | and > block scalars, comments. Anchors, aliases and tags are refused, as Talents does.
export type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };
export class YamlError extends Error { constructor(message: string, readonly line?: number) { super(message); } }

function stripComment(text: string) {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ''; else if (c === '\\' && quote === '"') i++; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}
/** Splits a flow collection's body on top-level commas. */
function splitFlow(body: string) {
  const parts: string[] = []; let depth = 0, quote = '', start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = ''; else if (c === '\\' && quote === '"') i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ',' && !depth) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  parts.push(body.slice(start));
  return parts.map(p => p.trim()).filter(Boolean);
}
const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-[\]{}][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;

export function parseYaml(source: string): Yaml {
  const lines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const indentOf = (s: string) => s.length - s.trimStart().length;
  const blank = (s: string) => /^\s*(#.*)?$/.test(s);
  const skip = () => { while (i < lines.length && blank(lines[i])) i++; };
  const scalar = (text: string, line: number): Yaml => {
    if (/^[&*!]/.test(text)) throw new YamlError('不支持锚点、别名或类型标签', line);
    if (text.startsWith('[') || text.startsWith('{')) {
      const close = text.startsWith('[') ? ']' : '}';
      if (!text.endsWith(close)) throw new YamlError('括号没有闭合', line);
      const parts = splitFlow(text.slice(1, -1));
      if (close === ']') return parts.map(p => scalar(p, line));
      const out: Record<string, Yaml> = {};
      parts.forEach(p => { const m = KEY.exec(p); if (!m) throw new YamlError('无法解析：' + p, line); out[unquote(m[1], line)] = scalar((m[2] ?? '').trim(), line); });
      return out;
    }
    if (text.startsWith('"') || text.startsWith("'")) return unquote(text, line);
    if (text === '' || text === '~' || text === 'null') return null;
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return text;
  };
  const unquote = (text: string, line: number) => {
    if (text.startsWith('"')) { if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw new YamlError('引号没有闭合', line); return JSON.parse(text) as string; }
    if (text.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(text)) throw new YamlError('引号没有闭合', line); return text.slice(1, -1).replace(/''/g, "'"); }
    return text;
  };
  const blockScalar = (parent: number, fold: boolean) => {
    const body: string[] = [];
    while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > parent)) body.push(lines[i++]);
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const indent = Math.min(...body.filter(l => l.trim()).map(indentOf));
    const text = body.map(l => l.slice(indent));
    return (fold ? text.join(' ').replace(/ ?\n ?/g, '\n') : text.join('\n')) + '\n';
  };
  const value = (rest: string, indent: number, line: number): Yaml => {
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(indent, rest[0] === '>');
    if (rest) return scalar(rest, line);
    skip();
    if (i < lines.length) {
      const next = indentOf(lines[i]), text = lines[i].slice(next);
      if (next > indent || (next === indent && /^-( |$)/.test(text))) return block(next);
    }
    return null;
  };
  const mapping = (indent: number) => {
    const out: Record<string, Yaml> = {};
    for (skip(); i < lines.length; skip()) {
      const at = indentOf(lines[i]);
      if (at < indent) break;
      if (at > indent) throw new YamlError('缩进不一致', i + 1);
      const text = stripComment(lines[i].slice(at));
      if (/^-( |$)/.test(text)) break;
      const m = KEY.exec(text);
      if (!m) throw new YamlError('无法解析：' + text, i + 1);
      const key = unquote(m[1], i + 1), line = i + 1;
      if (key in out) throw new YamlError('重复的键 ' + key, line);
      if (key === '<<') throw new YamlError('不支持合并键', line);
      i++;
      out[key] = value((m[2] ?? '').trim(), at, line);
    }
    return out;
  };
  const sequence = (indent: number) => {
    const out: Yaml[] = [];
    for (skip(); i < lines.length; skip()) {
      const at = indentOf(lines[i]);
      if (at !== indent) { if (at > indent) throw new YamlError('缩进不一致', i + 1); break; }
      const text = stripComment(lines[i].slice(at));
      if (!/^-( |$)/.test(text)) break;
      const rest = text.slice(1).trimStart(), line = i + 1;
      if (!rest) { i++; out.push(block(indent + 1)); continue; }
      // "- key: value" starts a mapping indented where its key is.
      if (KEY.test(rest) && !/^["'[{]/.test(rest)) { const inner = at + (text.length - rest.length); lines[i] = ' '.repeat(inner) + rest; out.push(mapping(inner)); continue; }
      i++; out.push(scalar(rest, line));
    }
    return out;
  };
  function block(indent: number): Yaml {
    skip();
    if (i >= lines.length) return null;
    return /^-( |$)/.test(stripComment(lines[i].slice(indentOf(lines[i])))) ? sequence(indentOf(lines[i])) : mapping(indentOf(lines[i]));
  }
  skip();
  if (i >= lines.length) throw new YamlError('文件是空的');
  if (/^(%|---)/.test(lines[i])) throw new YamlError('不支持 YAML 指令或多文档', i + 1);
  const root = block(0);
  skip();
  if (i < lines.length) throw new YamlError('无法解析：' + lines[i].trim(), i + 1);
  return root;
}

// ---------- Declaration ----------
export interface Operation {
  command?: string; args?: string[]; cwd?: string; description?: string;
  skill?: { name: string; defaultPrompt?: string };
  platforms?: Record<string, { command: string; args?: string[] }>;
}
export interface InputDecl { type: string; items?: { type: string }; required?: boolean; minItems?: number; maxItems?: number }
export interface EngineDecl {
  schemaVersion: 1; id: string; name: string; description?: string; definitionVersion?: string;
  input?: Record<string, InputDecl>; output: Record<string, { relativeTo?: string; path: string }>;
  build: Operation; update?: Operation; autoSync?: { supported: boolean; description?: string };
  applications?: { name: string; type: string; command: string; args?: string[] }[];
  install?: Operation; uninstall?: Operation; check?: Operation;
}
const TOP = ['schemaVersion', 'id', 'name', 'description', 'definitionVersion', 'input', 'output', 'build', 'update', 'autoSync', 'applications', 'install', 'uninstall', 'check'];
const isMap = (v: unknown): v is Record<string, Yaml> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reads engine.yaml and checks it like Talents' registration does, stopping at the first error. */
export function readEngine(text: string): { engine: EngineDecl } | { error: string } {
  let doc: Yaml;
  try { doc = parseYaml(text); }
  catch (e) { return { error: 'engine.yaml' + (e instanceof YamlError && e.line ? ' 第 ' + e.line + ' 行' : '') + '：' + (e as Error).message }; }
  const fail = (field: string, message: string) => ({ error: 'engine.yaml 的 ' + field + '：' + message });
  if (!isMap(doc)) return { error: 'engine.yaml 的顶层必须是映射' };
  const unknown = Object.keys(doc).find(k => !TOP.includes(k));
  if (unknown) return fail(unknown, '协议不认识这个字段');
  if (doc.schemaVersion !== 1) return fail('schemaVersion', '必须是 1');
  if (typeof doc.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(doc.id)) return fail('id', '必填，小写字母开头，只能有小写字母、数字和连字符');
  if (typeof doc.name !== 'string' || !doc.name.trim()) return fail('name', '必填');
  if (doc.input != null && !isMap(doc.input)) return fail('input', '必须是映射');
  for (const [name, decl] of Object.entries(doc.input ?? {})) {
    if (!isMap(decl) || typeof decl.type !== 'string') return fail('input.' + name, '缺少 type');
    if (decl.type === 'array' && !(isMap(decl.items) && typeof decl.items.type === 'string')) return fail('input.' + name + '.items', '数组必须声明元素类型');
  }
  if (!isMap(doc.output) || !Object.keys(doc.output).length) return fail('output', '必填，至少声明一个产物目录');
  for (const [name, out] of Object.entries(doc.output)) if (!isMap(out) || typeof out.path !== 'string') return fail('output.' + name, '缺少 path');
  for (const key of ['build', 'update', 'install', 'uninstall', 'check']) {
    const op = doc[key];
    if (op == null) { if (key === 'build') return fail('build', '必填'); continue; }
    if (!isMap(op)) return fail(key, '必须是映射');
    const skill = isMap(op.skill) && typeof op.skill.name === 'string';
    if (!skill && typeof op.command !== 'string' && !isMap(op.platforms)) return fail(key, '需要 command，或 skill.name');
    if (typeof op.command === 'string' && /[\s/\\:]/.test(op.command)) return fail(key + '.command', '只写程序名，不能带路径或参数');
  }
  if (doc.applications != null && (!Array.isArray(doc.applications) || !doc.applications.length)) return fail('applications', '填写时必须是非空列表');
  const app = (doc.applications as Yaml[] | undefined)?.findIndex(a => !isMap(a) || a.type !== 'mcp' || typeof a.command !== 'string');
  if (app !== undefined && app >= 0) return fail('applications[' + app + ']', '只支持 type: mcp，并且需要 command');
  return { engine: doc as unknown as EngineDecl };
}

// ---------- Presenting a declaration ----------
const PLATFORM = 'macos';
/** The command line an operation runs on this machine, or the Skill it loads. */
export function operationText(op: Operation | undefined) {
  if (!op) return '';
  if (op.skill) return 'iCode Skill：' + op.skill.name;
  const run = op.command ? op : op.platforms?.[PLATFORM] ?? Object.values(op.platforms ?? {})[0];
  return run?.command ? [run.command, ...(run.args ?? [])].map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ') : '';
}
export const isSkill = (e: EngineDecl) => !!e.build.skill;
export function outputText(e: EngineDecl) {
  return Object.values(e.output).map(o => (o.relativeTo === 'repository' ? '代码仓内 ' : o.relativeTo === 'managed' ? 'Talents 管理的目录 ' : '') + o.path).join('；');
}

/** Source inputs the demo task form knows how to pick; everything else is a parameter. */
const SOURCE_INPUTS = ['repositories', 'repositorySet', 'documents', 'sessions', 'pullRequests'];
export function sourceKind(e: EngineDecl): Capability['input'] | null {
  const input = e.input ?? {};
  if (input.sessions) return 'sessions';
  if (input.repositories || input.repositorySet) return input.pullRequests ? 'repo+pr' : 'repo';
  if (input.documents) return 'docs';
  return null;
}
export function params(e: EngineDecl): Param[] {
  return Object.entries(e.input ?? {}).filter(([name]) => !SOURCE_INPUTS.includes(name)).map(([name, d]) => ({
    name, type: (['string', 'number', 'integer', 'boolean', 'array'].includes(d.type) ? d.type : 'string') as Param['type'], required: !!d.required,
  }));
}
/** The category an imported capability most likely belongs to, preselected in the import form. */
export function guessCategory(e: EngineDecl) {
  const kind = sourceKind(e);
  if (kind === 'sessions') return 'traj';
  if (e.applications?.length) return 'index';
  if (kind === 'docs') return 'doc';
  return 'code';
}

/** The capability card and task form of an imported package. */
export function capabilityOf(e: EngineDecl, text: string, cat: string): Capability {
  const kind = sourceKind(e)!;
  const inputLabel = { repo: '1 个代码仓', docs: '1 个文档集', sessions: '1 到多个团队会话', 'repo+pr': '1 个代码仓和若干 PR', 'repo+snippet': '1 个代码仓和代码片段' }[kind];
  const out = outputText(e), mcp = !!e.applications?.length;
  const extra = params(e).map(p => p.name + (p.required ? '（必填）' : '（可选）')).join('、');
  return {
    id: e.id, cat, name: e.name, desc: e.description ?? '', input: kind, inputLabel,
    output: mcp ? '索引（MCP 查询）' : '产物目录', outputPath: Object.values(e.output)[0].path, mcp,
    update: e.update ? '支持，按声明的 update 增量更新' : undefined, noUpdate: e.update ? undefined : '未声明 update，每次运行重新构建',
    skill: isSkill(e), prompt: e.build.skill?.defaultPrompt?.split('\n')[0],
    detail: { input: '必须提供 ' + inputLabel + (extra ? '；参数：' + extra : '') + '。', abilities: [], output: out + (mcp ? '；Agent 通过 MCP「' + e.applications![0].name + '」查询。' : '。') },
    version: e.definitionVersion, custom: true, engine: text, params: params(e),
  };
}

/** The engine.yaml behind a capability: imported ones carry it, built-ins ship it in content/engines/. */
export function engineText(c: Capability) { return c.engine ?? content('engines/' + c.id + '/engine.yaml'); }
export function engineOf(c: Capability): EngineDecl | null {
  const text = engineText(c), read = text ? readEngine(text) : null;
  return read && 'engine' in read ? read.engine : null;
}

// ---------- The example package ----------
export const EXAMPLE = {
  folder: 'db-schema-engine',
  files: ['engine.yaml', 'README.md', 'scripts/run.py', 'scripts/schema_reader.py', 'scripts/mcp_server.py'],
  text: () => content('engines/examples/db-schema/engine.yaml') ?? '',
};
