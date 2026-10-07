import test from 'node:test';
import assert from 'node:assert';
import { esc, stateLabel, summarize, toCsv } from '../web/lib.js';

const grid = {
  students: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
  works: [{ id: 'w1', title: '과제1' }, { id: 'w2', title: '과제 "2"' }],
  cells: {
    s1: { w1: { state: 'TURNED_IN', updated: '2026-10-01' }, w2: { state: 'TURNED_IN', updated: '2026-10-03' } },
    s2: { w1: { state: 'RETURNED', updated: '2026-10-02' }, w2: { state: 'CREATED', updated: '' } },
  },
};

test('esc escapes html', () => {
  assert.strictEqual(esc(`<b a="1">'&`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;');
  assert.strictEqual(esc(null), '');
});

test('stateLabel', () => {
  assert.strictEqual(stateLabel({ state: 'TURNED_IN' }), '제출');
  assert.strictEqual(stateLabel({ state: 'RETURNED' }), '반환됨');
  assert.strictEqual(stateLabel({ state: 'RECLAIMED_BY_STUDENT' }), '회수함');
  assert.strictEqual(stateLabel(undefined), '미제출');
});

test('summarize computes rate, missing, recent', () => {
  const s = summarize(grid);
  assert.strictEqual(s.rate, 75);
  assert.deepStrictEqual(s.missing, [{ name: 'B', miss: 1 }]);
  assert.deepStrictEqual(s.recent.map(r => r.updated), ['2026-10-03', '2026-10-02', '2026-10-01']);
  assert.strictEqual(summarize({ students: [], works: [], cells: {} }).rate, 0);
});

test('toCsv writes BOM, quotes, and falls back to state label', () => {
  const csv = toCsv(grid, { s1: { w1: '첫 줄\n둘째 "줄"' } });
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], '"학생","과제1","과제 ""2"""');
  assert.strictEqual(lines[1], '"A","첫 줄\n둘째 ""줄""","제출"');
  assert.strictEqual(lines[2], '"B","반환됨","미제출"');
});

test('toCsv neutralizes formula injection', () => {
  const csv = toCsv(grid, { s1: { w1: '=1+1' } });
  assert.ok(csv.includes(`"'=1+1"`));
});
