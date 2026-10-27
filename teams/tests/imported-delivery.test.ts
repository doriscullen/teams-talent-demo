import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryStages, importedStage, importedSelectedStage } from '../src/imported-delivery.js';
import type { Presentation } from '../src/api.js';
const snapshot = JSON.parse(readFileSync(new URL('../fixtures/teams-project.json', import.meta.url), 'utf8')) as Presentation['teamsProject'];
test('imported four-stage adapter retains every exact original node without mutation', () => {
  const before = JSON.stringify(snapshot);
  for (const task of snapshot.tasks) {
    const mapped = deliveryStages.flatMap(id => importedStage(task, id).nodes);
    assert.equal(mapped.length, task.nodes.length);
    assert.equal(new Set(mapped.map(node => node.id)).size, task.nodes.length);
    for (const node of task.nodes) assert.deepEqual(mapped.find(item => item.id === node.id), node);
  }
  assert.equal(JSON.stringify(snapshot), before);
});
test('parallel test preparation and research remain source facts, with missing verification explicit', () => {
  const requirement = snapshot.tasks.find(task => task.id === 'T104')!;
  assert.deepEqual(importedStage(requirement, 'prepare').nodes.map(node => node.id), ['clarify', 'design', 'review']);
  assert.equal(importedStage(requirement, 'verify').primary!.id, 'test');
  assert.equal(importedStage(requirement, 'verify').status, '未执行');
  assert.ok(importedStage(requirement, 'verify').outputs.some(node => node.id === 'prep'));
  const research = snapshot.tasks.find(task => task.id === 'T108')!;
  assert.deepEqual(importedStage(research, 'develop').nodes.map(node => node.id), ['research', 'proposal']);
  assert.equal(importedStage(research, 'verify').status, '来源未提供');
  assert.equal(importedStage(research, 'verify').primary, undefined);
});
test('source deep links map to a real stage and unknown tasks nodes are never replaced silently', () => {
  const task = snapshot.tasks.find(item => item.id === 'T104')!;
  assert.equal(importedSelectedStage(task, 'review'), 'prepare');
  assert.equal(importedSelectedStage(task, 'prep'), 'verify');
  assert.equal(importedSelectedStage(task, 'build'), 'develop');
  assert.equal(importedSelectedStage(task, null, 'review'), 'prepare');
  assert.equal(importedSelectedStage(task, 'verify'), 'verify');
  assert.equal(importedSelectedStage(task, 'unknown-node'), undefined);
});
