import test from 'node:test';
import assert from 'node:assert';
import { esc, stateLabel, summarize, toCsv, dDay, dueLabel } from '../web/lib.js';

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
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], '"학생","과제1","과제 ""2"""');
  assert.strictEqual(lines[1], '"A","첫 줄\n둘째 ""줄""","제출"');
  assert.strictEqual(lines[2], '"B","반환됨","미제출"');
});

test('toCsv neutralizes formula injection', () => {
  const csv = toCsv(grid, { s1: { w1: '=1+1' } });
  assert.ok(csv.includes(`"'=1+1"`));
});

test('summarize reports change in rate versus 7 days ago', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  const g = {
    students: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
    works: [{ id: 'w1', title: 'old', created: '2026-09-01T00:00:00Z' }, { id: 'w2', title: 'new', created: '2026-10-08T00:00:00Z' }],
    cells: {
      s1: { w1: { state: 'TURNED_IN', updated: '2026-09-02T00:00:00Z' }, w2: { state: 'TURNED_IN', updated: '2026-10-09T00:00:00Z' } },
      s2: { w1: { state: 'TURNED_IN', updated: '2026-10-05T00:00:00Z' } },
    },
  };
  // now: 3/4 = 75%; a week ago only w1 existed and s1 had turned it in: 1/2 = 50%.
  assert.strictEqual(summarize(g, now).delta, 25);
  assert.strictEqual(summarize({ students: [], works: [], cells: {} }, now).delta, null);
});

test('dDay counts calendar days to a due date in Korea time', () => {
  const now = Date.parse('2026-10-07T15:30:00Z'); // 10월 8일 00:30 KST
  assert.strictEqual(dDay('2026-10-09', now), 1);
  assert.strictEqual(dDay('2026-10-08', now), 0);
  assert.strictEqual(dDay('2026-10-06', now), -2);
  assert.strictEqual(dDay('', now), null);
});

test('dueLabel formats month, day and weekday', () => {
  assert.strictEqual(dueLabel('2026-10-09'), '10월 9일(금)');
  assert.strictEqual(dueLabel(''), '');
});

test('lib parseRoster matches the server copy', async () => {
  const { parseRoster } = await import('../web/lib.js');
  const { createRequire } = await import('node:module');
  const core = createRequire(import.meta.url)('../gas/Core.js');
  const text = '번호\t이름\n1\t강수아\n2, 김민준\n\n 3  박지호 \n3\t중복\nabc\t무시\n12\tJohn Kim';
  assert.deepStrictEqual(parseRoster(text), core.parseRoster(text));
});

test('summarize and toCsv skip students outside an assignment target', async () => {
  const { summarize, toCsv } = await import('../web/lib.js');
  const g = {
    students: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }],
    works: [{ id: 'w1', title: '전체', targets: null }, { id: 'w2', title: '일부', targets: ['s2'] }],
    cells: { s2: { w2: { state: 'TURNED_IN', updated: '2026-10-01' } } },
  };
  const s = summarize(g);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.done, 1);
  assert.deepStrictEqual(s.missing, [{ name: 'A', miss: 1 }, { name: 'B', miss: 1 }]);
  const lines = toCsv(g, {}).slice(1).split('\r\n');
  assert.strictEqual(lines[1], '"A","미제출","–"');
});
