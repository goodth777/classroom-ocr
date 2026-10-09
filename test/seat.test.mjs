import test from 'node:test';
import assert from 'node:assert';
import { blankLayout, neighbours, toggleDesk, resize, unplaced, arrange } from '../web/seatlogic.js';

const seeded = seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ids = n => Array.from({ length: n }, (_, i) => 's' + i);

test('neighbours: up/down/left/right desks only, aisle splits pairs', () => {
  const L = blankLayout(2, 4);
  assert.deepStrictEqual(neighbours(L, 1).sort(), [0, 2, 5]);
  L.pairs = true; // columns (0,1) | (2,3)
  assert.deepStrictEqual(neighbours(L, 1).sort(), [0, 5]);
  assert.deepStrictEqual(neighbours(L, 2).sort(), [3, 6]);
  L.desks[0] = false;
  assert.deepStrictEqual(neighbours(L, 1), [5]);
});

test('toggleDesk off drops the seat assignment and pin', () => {
  let L = blankLayout(1, 3);
  L.assign = { 1: 's1' }; L.fixed = [1];
  L = toggleDesk(L, 1);
  assert.strictEqual(L.desks[1], false);
  assert.deepStrictEqual(L.assign, {});
  assert.deepStrictEqual(L.fixed, []);
  assert.strictEqual(toggleDesk(L, 1).desks[1], true);
});

test('resize keeps (row, col) positions and drops what falls outside', () => {
  let L = blankLayout(2, 3);
  L.assign = { 0: 'a', 5: 'b' }; L.desks[4] = false;
  L = resize(L, 2, 2);
  assert.deepStrictEqual(L.assign, { 0: 'a' });
  assert.deepStrictEqual(L.desks, [true, true, true, false]);
  L = resize(L, 3, 2);
  assert.strictEqual(L.desks.length, 6);
  assert.strictEqual(L.desks[5], true);
});

test('unplaced lists students without a seat', () => {
  const L = blankLayout(1, 2); L.assign = { 0: 's0' };
  assert.deepStrictEqual(unplaced(L, ids(3)), ['s1', 's2']);
});

test('arrange keeps pinned seats and seats everyone when desks suffice', () => {
  const L = blankLayout(4, 5); L.assign = { 0: 's0', 7: 's7' }; L.fixed = [0];
  const r = arrange(L, ids(18), {}, seeded(1));
  assert.strictEqual(r.assign[0], 's0');
  assert.strictEqual(Object.keys(r.assign).length, 18);
  assert.strictEqual(new Set(Object.values(r.assign)).size, 18);
  assert.deepStrictEqual(r.unseated, []);
});

test('arrange avoids the same seat as the base layout', () => {
  const L = blankLayout(5, 6);
  const base = {}; ids(30).forEach((s, i) => { base[i] = s; });
  for (let k = 1; k <= 20; k++) {
    const r = arrange(L, ids(30), base, seeded(k));
    assert.strictEqual(r.same, 0);
    Object.entries(r.assign).forEach(([i, s]) => assert.notStrictEqual(base[i], s));
  }
});

test('arrange keeps apart pairs off neighbouring desks', () => {
  const L = blankLayout(5, 6); L.apart = [['s0', 's1'], ['s2', 's3'], ['s4', 's5']];
  for (let k = 1; k <= 20; k++) {
    const r = arrange(L, ids(28), {}, seeded(k));
    assert.strictEqual(r.apartFail, 0);
    const at = Object.fromEntries(Object.entries(r.assign).map(([i, s]) => [s, +i]));
    L.apart.forEach(([a, b]) => assert.ok(!neighbours(L, at[a]).includes(at[b])));
  }
});

test('arrange reports students who cannot sit', () => {
  const L = blankLayout(2, 2);
  const r = arrange(L, ids(6), {}, seeded(3));
  assert.strictEqual(Object.keys(r.assign).length, 4);
  assert.strictEqual(r.unseated.length, 2);
});

test('arrange relaxes same-seat when it cannot be avoided', () => {
  const L = blankLayout(1, 2); L.assign = { 1: 's1' }; L.fixed = [1];
  const r = arrange(L, ['s0', 's1'], { 0: 's0', 1: 's1' }, seeded(2));
  assert.strictEqual(r.assign[0], 's0');
  assert.strictEqual(r.same, 1);
});
