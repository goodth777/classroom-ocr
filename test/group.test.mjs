import test from 'node:test';
import assert from 'node:assert';
import { makeGroups } from '../web/grouplogic.js';

const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ids = n => Array.from({ length: n }, (_, i) => 's' + i);
const groupOf = (gs, id) => gs.findIndex(g => g.includes(id));

test('makeGroups by size balances groups and keeps everyone once', () => {
  const g = makeGroups(ids(26), { size: 4 }, [], [], seeded(1));
  assert.strictEqual(g.length, 7); // 26 / 4 → 7 groups of 3-4
  assert.ok(g.every(x => x.length >= 3 && x.length <= 4));
  assert.strictEqual(new Set(g.flat()).size, 26);
});

test('makeGroups by count spreads students evenly', () => {
  const g = makeGroups(ids(25), { count: 6 }, [], [], seeded(2));
  assert.strictEqual(g.length, 6);
  assert.deepStrictEqual(g.map(x => x.length).sort(), [4, 4, 4, 4, 4, 5]);
});

test('makeGroups keeps apart pairs apart and together pairs together', () => {
  const apart = [['s0', 's1'], ['s2', 's3'], ['s4', 's5']];
  const together = [['s6', 's7'], ['s8', 's9']];
  for (let k = 1; k <= 30; k++) {
    const g = makeGroups(ids(24), { size: 4 }, apart, together, seeded(k));
    apart.forEach(([a, b]) => assert.notStrictEqual(groupOf(g, a), groupOf(g, b)));
    together.forEach(([a, b]) => assert.strictEqual(groupOf(g, a), groupOf(g, b)));
  }
});
