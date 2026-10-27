import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/main.tsx'], bundle: true, outdir: 'dist', format: 'esm', sourcemap: true, minify: true, target: ['chrome120'], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info' });
await writeFile('dist/index.html', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>iCode Teams · Credit Card</title><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
// 开发会话轨迹：构建内嵌的 trace-monitor（Vue + Element Plus），产物输出到 dist/trace-monitor
const traceRoot = 'trace-monitor';
const viteBin = join(process.cwd(), traceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
if (existsSync(viteBin)) await promisify(execFile)(process.execPath, [viteBin, 'build'], { cwd: traceRoot });
else console.warn('跳过 trace-monitor 构建：请先在 teams/trace-monitor 执行 npm ci');
