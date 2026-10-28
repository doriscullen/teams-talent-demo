// Writes the snapshot Teams exports in its initial state to shared/seed/teams/, the committed fallback
// Talents reads before Teams has ever started. Rerun after changing what the snapshot contains.
// Usage: npm run seed:shared
import { join } from 'node:path';
import { readFixtures } from '../server/http-shared.js';
import { teamsSnapshot } from '../server/shared-data.js';
import { atomicJson } from '../server/store.js';
import { sharedSeedDir } from '../server/config.js';
import { initialState } from '../src/domain.js';
import { createSourcePluginCatalog } from '../src/source-plugins.js';
import { sharedPaths } from '../../shared/contracts.js';

const fixtures = await readFixtures();
const snapshot = { ...teamsSnapshot(initialState(), fixtures, createSourcePluginCatalog(fixtures)), exportedAt: '2026-10-27T04:59:01.892Z' };
await atomicJson(join(sharedSeedDir, sharedPaths.teamsSnapshot), snapshot);
console.log(`wrote ${sharedPaths.teamsSnapshot}: ${snapshot.projects.length} 个项目，${snapshot.sessions.length} 个会话`);
