const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENT[c]);

export const DONE = new Set(['TURNED_IN', 'RETURNED']);

const LABEL = { TURNED_IN: '제출', RETURNED: '반환됨', RECLAIMED_BY_STUDENT: '회수함' };
export const stateLabel = cell => LABEL[cell && cell.state] || '미제출';

export function summarize(grid) {
  let done = 0;
  const recent = [];
  const missing = [];
  grid.students.forEach(s => {
    const row = grid.cells[s.id] || {};
    let miss = 0;
    grid.works.forEach(w => {
      const c = row[w.id];
      if (c && DONE.has(c.state)) {
        done++;
        recent.push({ student: s.name, work: w.title, updated: c.updated || '' });
      } else miss++;
    });
    if (miss) missing.push({ name: s.name, miss });
  });
  const total = grid.students.length * grid.works.length;
  missing.sort((a, b) => b.miss - a.miss);
  recent.sort((a, b) => b.updated.localeCompare(a.updated));
  return { rate: total ? Math.round((done / total) * 100) : 0, missing, recent: recent.slice(0, 5) };
}

export function toCsv(grid, texts) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['학생', ...grid.works.map(w => w.title)],
    ...grid.students.map(s => [
      s.name,
      ...grid.works.map(w => (texts[s.id] || {})[w.id] ?? stateLabel((grid.cells[s.id] || {})[w.id])),
    ]),
  ];
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
