import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { root, selectedServices, serviceHealth } from './services.mjs';
// Never kill a listener merely because it occupies a configured port.
const launching = selectedServices();
for (const service of launching) {
  if (await serviceHealth(service)) throw new Error(service.id + ' 已在当前目录运行；请先用 stop 停止已核验的服务，或使用另一个端口');
}
const children = launching.map(service => spawn(process.execPath, ['--import', 'tsx', join(root, service.entry)], { cwd: root, stdio: 'inherit' }));
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) if (child.exitCode === null) child.kill('SIGTERM'); }
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
for (const child of children) { child.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); }); child.on('exit', code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } }); }
