import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaleChunkError, reloadOnceForStaleChunk } from '../src/utils/staleChunk.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('recognises a file from an old deploy that no longer exists', () => {
  assert.equal(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/GisMap-BTWkK4iy.js')), true);
  assert.equal(isStaleChunkError(new TypeError('Importing a module script failed.')), true);   // Safari
  assert.equal(isStaleChunkError(new Error('error loading dynamically imported module')), true); // Firefox
  assert.equal(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isStaleChunkError(null), false);
});

test('reloads once, not again within a minute (no reload loop)', () => {
  const storage = memoryStorage();
  let reloads = 0;
  const reload = () => { reloads += 1; };
  assert.equal(reloadOnceForStaleChunk({ storage, reload, now: 1_000 }), true);
  assert.equal(reloadOnceForStaleChunk({ storage, reload, now: 30_000 }), false);
  assert.equal(reloads, 1);
  assert.equal(reloadOnceForStaleChunk({ storage, reload, now: 120_000 }), true);
  assert.equal(reloads, 2);
});

test('does not crash when storage is unavailable', () => {
  const storage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  let reloads = 0;
  assert.equal(reloadOnceForStaleChunk({ storage, reload: () => { reloads += 1; }, now: 1 }), false);
  assert.equal(reloads, 0);
});
