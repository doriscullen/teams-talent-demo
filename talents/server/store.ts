import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeDir } from './config.ts';
import { HttpError, type TalentsState } from './model.ts';
import { SEED_VERSION, seedState } from './seed.ts';

export async function atomicText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  const file = await open(tmp, 'wx', 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
}
export async function atomicJson(path: string, value: unknown) { await atomicText(path, JSON.stringify(value, null, 2) + '\n'); }

/** Seed artifacts whose names changed after demo data was stored: index artifacts are named for what they are. */
const RENAMED: Record<string, [string, string]> = {
  'a-cg-java': ['carddemo-java-1025 CodeGraph', 'carddemo-java-1025 代码图谱'],
  'a-docidx': ['信用卡营销交付文档 RAG 检索', '信用卡营销交付文档检索索引'],
};
const renamed = (a: TalentsState['artifacts'][number]) => RENAMED[a.id]?.[0] === a.name ? { ...a, name: RENAMED[a.id][1] } : a;

/** Talents-owned state in <state dir>/state.json. Every change is revision-checked and written atomically. */
export class Store {
  state!: TalentsState;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly path = join(runtimeDir, 'state.json')) {}
  async init() {
    let stored: TalentsState | null = null;
    try { stored = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (stored && stored.schemaVersion === 1 && stored.seedVersion === SEED_VERSION && Number.isInteger(stored.revision) && Array.isArray(stored.artifacts)) {
      // Categories and built-in capabilities describe what Talents offers, not demo progress: always take the
      // current ones. Capabilities imported during the demo are kept.
      const { categories, capabilities } = seedState();
      this.state = { ...stored, categories, capabilities: [...capabilities, ...(stored.capabilities ?? []).filter(c => c.custom)], artifacts: stored.artifacts.map(renamed) }; return;
    }
    if (stored) {
      // Demo data from an older seed: keep a copy, then start from the current seed.
      const backup = this.path.replace(/\.json$/, '') + '.seed-' + (stored.seedVersion ?? 'unknown') + '.json';
      await atomicJson(backup, stored);
      console.log('Talents 演示数据来自旧版本，已备份到 ' + backup + ' 并恢复初始数据');
    }
    this.state = seedState();
    await atomicJson(this.path, this.state);
  }
  /** Runs `operation` on the current state when `revision` matches, then stores the result with the next revision. */
  mutate(revision: number | null, operation: (state: TalentsState) => TalentsState) {
    const next = this.queue.then(async () => {
      if (revision !== null && revision !== this.state.revision) throw new HttpError('数据已在另一页面更新，请刷新后重试', 409);
      const state = { ...operation(this.state), revision: this.state.revision + 1 };
      await atomicJson(this.path, state); this.state = state; return state;
    });
    this.queue = next.catch(() => undefined); return next;
  }
  reset() { return this.mutate(null, () => seedState()); }
}
