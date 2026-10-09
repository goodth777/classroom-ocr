// Pure helpers (no Apps Script services) so node:test can check them.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function makeCode(rand) {
  rand = rand || Math.random;
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

function makePin(rand) {
  rand = rand || Math.random;
  return String(Math.floor(rand() * 10000)).padStart(4, '0');
}

// Pasted rows "학번 이름" (5-digit student id, e.g. 20812 = grade 2, class 8, no. 12) or the older "번호 이름",
// from Excel/NEIS; header and junk rows are skipped, the first row for an id or number wins.
function parseRoster(text) {
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

// How a pasted roster lands on a class that may already have students (older rows have no 학번):
// fill = give an existing student this 학번 (only when the name is unique), ask = same name twice, add = new rows.
// resolve: {학번: studentId | 'new'} — the teacher's answers to earlier "ask" cases.
function planRoster(rows, existing, resolve) {
  resolve = resolve || {};
  const plan = { fill: [], ask: [], add: [], skip: 0 };
  const taken = new Set();
  rows.forEach(r => {
    if (!r.sno) {
      if (existing.some(e => +e.number === r.number && !e.sno)) plan.skip++; else plan.add.push(r);
      return;
    }
    if (existing.some(e => e.sno === r.sno)) { plan.skip++; return; }
    if (resolve[r.sno] === 'new') { plan.add.push(r); return; }
    if (resolve[r.sno]) { plan.fill.push({ id: resolve[r.sno], sno: r.sno }); taken.add(resolve[r.sno]); return; }
    const same = existing.filter(e => e.name === r.name && !e.sno && !taken.has(e.id));
    if (same.length === 1) { plan.fill.push({ id: same[0].id, sno: r.sno }); taken.add(same[0].id); }
    else if (same.length > 1) plan.ask.push({ sno: r.sno, name: r.name, candidates: same.map(e => e.id) });
    else plan.add.push(r);
  });
  return plan;
}

// Late once past 23:59:59 Korea time on the due date.
function isLate(submittedAt, due) {
  if (!due) return false;
  return Date.parse(submittedAt) > Date.parse(due + 'T23:59:59+09:00');
}

// An assignment with no studentIds goes to the whole class.
function targetsOf(a) {
  const ids = String(a.studentIds || '').split(',').filter(Boolean);
  return ids.length ? ids : null;
}
function isTarget(a, studentId) {
  const t = targetsOf(a);
  return !t || t.indexOf(studentId) >= 0;
}

const PREVIEW_CHARS = 60;

// 학번 order first (rows without one fall back to their number).
const bySno = (a, b) => String(a.sno || '').localeCompare(String(b.sno || '')) || +a.number - +b.number;

// Teacher table: students by number, assignments by creation, one cell per submission.
function buildGrid(students, assignments, submissions) {
  const cells = {};
  submissions.forEach(s => {
    (cells[s.studentId] = cells[s.studentId] || {})[s.assignmentId] = {
      state: 'TURNED_IN',
      late: !!s.late,
      updated: s.submittedAt,
      subId: s.id,
      // Only the start of the text: full texts come from the "texts" route when a cell or CSV needs them,
      // so the teacher view stays small as submissions pile up over the semester.
      preview: String(s.text || '').slice(0, PREVIEW_CHARS),
      photos: s.photoIds ? String(s.photoIds).split(',').length : 0,
    };
  });
  return {
    students: students.map(s => ({ id: s.id, number: +s.number, name: s.name, sno: s.sno || '' })).sort(bySno),
    works: assignments.map(a => ({ id: a.id, title: a.title, created: a.created, due: a.due || '', description: a.description || '', targets: targetsOf(a) }))
      .sort((a, b) => String(a.created).localeCompare(String(b.created))),
    cells,
  };
}

// Short answers match when letters agree: case, all whitespace and edge punctuation are ignored.
function normShort(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

// Quiz scoring. Long answers count only once the teacher scores them (manual[qid]); scale is never scored.
function grade(questions, answers, manual) {
  manual = manual || {};
  const per = {};
  let score = 0, max = 0, pending = false;
  questions.forEach(q => {
    if (q.type === 'scale') return;
    const pts = +q.points || 1, a = answers[q.id];
    let ok = false;
    if (q.type === 'mc') ok = a !== undefined && a !== null && a !== '' && +a === +q.answer;
    else if (q.type === 'cb') {
      const want = (q.answer || []).map(Number).sort().join(','), got = (Array.isArray(a) ? a : []).map(Number).sort().join(',');
      ok = want !== '' && want === got;
    } else if (q.type === 'short') ok = (q.answer || []).some(x => normShort(x) !== '' && normShort(x) === normShort(a));
    else if (q.type === 'long') ok = String(a == null ? '' : a).trim() === '' ? false : manual[q.id] === undefined ? null : +manual[q.id] >= pts; // a blank essay is simply 0
    const got = q.type === 'long' ? (manual[q.id] === undefined ? 0 : Math.max(0, Math.min(pts, +manual[q.id]))) : (ok ? pts : 0);
    if (ok === null) pending = true;
    per[q.id] = { got, max: pts, ok };
    score += got;
    max += pts;
  });
  return { score, max, pending, per };
}

if (typeof module !== 'undefined') module.exports = { makeCode, makePin, parseRoster, isLate, buildGrid, isTarget, targetsOf, normShort, grade, planRoster };
