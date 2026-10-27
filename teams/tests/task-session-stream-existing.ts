// Read-only audit of existing native executions. This script never starts iCode or writes business/session files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createTaskSessionStream, visibleSessionText } from '../server/task-session-stream.js';
import type { DemoState } from '../src/domain.js';
import type { RequirementNode } from '../src/delivery-requirements.js';

const runtime = resolve(process.argv[2] ?? '.local/state/teams'), out = resolve('test-results/task-session-stream');
const statePath = join(runtime, 'state.json'), stateBytes = await readFile(statePath), state: DemoState = JSON.parse(stateBytes.toString());
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const observe = createTaskSessionStream(runtime), scopes = [];
const taskIds = ['MKT-E2E-001', 'MKT-E2E-ACCEPT-001'];
const originals = new Map<string, string>();
for (const taskId of taskIds) {
  assert.ok(state.workspace.deliveryRequirements?.some(task => task.id === taskId), 'Expected existing task is absent');
  for (const nodeId of ['prepare', 'develop', 'verify', 'accept'] as RequirementNode[]) {
    const query = { projectId: 'carddemo', taskId, nodeId };
    let response = await observe(state, 'owner', query); const ids = new Set<string>(), counts = { users: 0, replies: 0 };
    const sessionId = response.selectedSessionId;
    for (;;) {
      for (const turn of response.turns) {
        const nativeRoot=join(runtime,'work-contexts',turn.runId+'.native','session-root','sessions',turn.sessionId.replaceAll('-','').slice(0,12));
        const native=JSON.parse(await readFile(join(nativeRoot,'session.json'),'utf8'));
        for(const projected of [...(turn.user?[turn.user]:[]),...turn.replies]){const message=native.state.messages.find((m:any)=>(m.message_id??m.additional_properties?._chrys_analytics_item_id??m.additional_properties?._group?.id)===projected.id);assert.ok(message);assert.equal(projected.text,visibleSessionText(message.contents.filter((p:any)=>p.type==='text'&&typeof p.text==='string').map((p:any)=>p.text).join('\n')));}
        assert.ok(!ids.has(turn.id)); ids.add(turn.id); counts.users += turn.user ? 1 : 0; counts.replies += turn.replies.length; assert.equal(turn.nodeId, nodeId); assert.equal(turn.sessionId, sessionId); assert.equal(turn.round, 1, 'model/tool cycles must not create user rounds'); }
      if (!response.hasMore) break;
      response = await observe(state, 'owner', { ...query, sessionId: sessionId!, cursor: response.cursor! });
    }
    if (response.cursor) { const repeat = await observe(state, 'owner', { ...query, sessionId: sessionId!, cursor: response.cursor }); assert.equal(repeat.turns.length, 0); assert.equal(repeat.reset, false); }
    for (const session of response.sessions) for (const run of session.runIds) {
      const root = join(runtime, 'work-contexts', run + '.native', 'session-root', 'sessions', session.id.replaceAll('-', '').slice(0, 12));
      for (const name of ['session.json', 'trajectory/events.jsonl']) { const path = join(root, name), sha = digest(await readFile(path)); if (originals.has(path)) assert.equal(sha, originals.get(path)); else originals.set(path, sha); }
    }
    scopes.push({ taskId, nodeId, sessionId, statuses: response.sessions.map(session => session.status), turns: ids.size, counts, repeatedPollNewTurns: 0 });
  }
}
for (const [path, sha] of originals) assert.equal(digest(await readFile(path)), sha);
assert.equal(digest(await readFile(statePath)), digest(stateBytes));
assert.ok(scopes.some(scope => scope.counts.users > 0)); assert.ok(scopes.some(scope => scope.counts.replies > 0));
await mkdir(out, { recursive: true });
const result = { at: new Date().toISOString(), mode: 'existing-native-session-read-only', newModelExecution: false, businessWrites: 0, originalFilesUnchanged: originals.size, stateUnchanged: true, scopes };
await writeFile(join(out, 'existing-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
