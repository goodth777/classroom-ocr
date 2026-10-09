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

// Pasted rows "번호<tab|comma|spaces>이름" from Excel/NEIS; header and junk rows are skipped, first number wins.
function parseRoster(text) {
  const seen = {};
  const out = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = /^\s*(\d{1,3})\s*[\t,]?\s*(.+?)\s*$/.exec(line);
    if (!m || seen[m[1]]) return;
    seen[m[1]] = true;
    out.push({ number: +m[1], name: m[2] });
  });
  return out;
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
    students: students.map(s => ({ id: s.id, number: +s.number, name: s.name })).sort((a, b) => a.number - b.number),
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
    else if (q.type === 'long') ok = manual[q.id] === undefined ? null : +manual[q.id] >= pts;
    const got = q.type === 'long' ? (manual[q.id] === undefined ? 0 : Math.max(0, Math.min(pts, +manual[q.id]))) : (ok ? pts : 0);
    if (ok === null) pending = true;
    per[q.id] = { got, max: pts, ok };
    score += got;
    max += pts;
  });
  return { score, max, pending, per };
}

if (typeof module !== 'undefined') module.exports = { makeCode, makePin, parseRoster, isLate, buildGrid, isTarget, targetsOf, normShort, grade };
