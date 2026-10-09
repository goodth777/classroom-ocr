const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENT[c]);

export const DONE = new Set(['TURNED_IN', 'RETURNED']);

// works[].targets: null = whole class, else the student ids the assignment was given to.
export const assigned = (w, sid) => !w.targets || w.targets.includes(sid);

const LABEL = { TURNED_IN: '제출', RETURNED: '반환됨', RECLAIMED_BY_STUDENT: '회수함' };
export const stateLabel = cell => LABEL[cell && cell.state] || '미제출';

const WEEK = 7 * 864e5;

// rate now, plus delta in percentage points versus 7 days ago (null when nothing existed then),
// rebuilt from creation and submission times so no history needs storing.
export function summarize(grid, now = Date.now()) {
  let done = 0, prevDone = 0, prevTotal = 0;
  const recent = [];
  const missing = [];
  const weekAgo = now - WEEK;
  grid.students.forEach(s => {
    const row = grid.cells[s.id] || {};
    let miss = 0;
    grid.works.forEach(w => {
      if (!assigned(w, s.id)) return;
      const c = row[w.id];
      const existed = w.created && Date.parse(w.created) <= weekAgo;
      if (existed) prevTotal++;
      if (c && DONE.has(c.state)) {
        done++;
        if (existed && c.updated && Date.parse(c.updated) <= weekAgo) prevDone++;
        recent.push({ student: s.name, work: w.title, updated: c.updated || '' });
      } else miss++;
    });
    if (miss) missing.push({ name: s.name, miss });
  });
  const total = grid.students.reduce((n, s) => n + grid.works.filter(w => assigned(w, s.id)).length, 0);
  const rate = total ? Math.round((done / total) * 100) : 0;
  missing.sort((a, b) => b.miss - a.miss);
  recent.sort((a, b) => b.updated.localeCompare(a.updated));
  return {
    rate, done, total, missing, recent: recent.slice(0, 5),
    delta: prevTotal ? rate - Math.round((prevDone / prevTotal) * 100) : null,
  };
}

// Days from today (Korea time) to 'YYYY-MM-DD'; negative once past, null without a date.
export function dDay(due, now = Date.now()) {
  if (!due) return null;
  const today = new Date(now + 9 * 36e5).toISOString().slice(0, 10);
  return Math.round((Date.parse(due) - Date.parse(today)) / 864e5);
}

export function dueLabel(due) {
  if (!due) return '';
  const d = new Date(due + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${'일월화수목금토'[d.getUTCDay()]})`;
}

export function toCsv(grid, texts) {
  // A leading ' stops spreadsheets from evaluating =, +, -, @ cells as formulas.
  const q = v => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const rows = [
    ['학생', ...grid.works.map(w => w.title)],
    ...grid.students.map(s => [
      s.name,
      ...grid.works.map(w => (!assigned(w, s.id) ? '–' : (texts[s.id] || {})[w.id] ?? stateLabel((grid.cells[s.id] || {})[w.id]))),
    ]),
  ];
  return '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
}

// ponytail: same rules as parseRoster in gas/Core.js (GAS can't share modules); test/lib.test.mjs keeps them in step.
// Used only to preview "N명을 읽었어요" before sending the paste to the server.
export function parseRoster(text) {
  const seen = {};
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = /^\s*(\d{5}|\d{1,3})(?!\d)\s*[\t,]?\s*(.+?)\s*$/.exec(line);
    if (!m) return;
    const key = m[1].length === 5 ? 's' + m[1] : 'n' + +m[1];
    if (seen[key]) return;
    seen[key] = true;
    out.push(m[1].length === 5 ? { sno: m[1], number: +m[1].slice(3), name: m[2] } : { number: +m[1], name: m[2] });
  });
  return out;
}

// Short Korea-time label for a message/notice: "09:02" today, "어제 21:42", else "10/6".
export function when(iso, now = Date.now()) {
  const k = t => new Date(t + 9 * 36e5);
  const d = k(Date.parse(iso));
  const days = Math.round((Date.parse(k(now).toISOString().slice(0, 10)) - Date.parse(d.toISOString().slice(0, 10))) / 864e5);
  const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return days <= 0 ? hm : days === 1 ? `어제 ${hm}` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
