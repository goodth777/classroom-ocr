// Teacher-side statistics for a form, computed from the responses already on the device (no server round trip).
// response: { studentId, answers: {qid: value}, score?, max?, per?: {qid: {ok}} }

const round1 = x => Math.round(x * 10) / 10;
const key = t => String(t).toLowerCase().replace(/\s+/g, '');

export function summarize(form, responses) {
  const n = responses.length;
  const items = form.questions.map(q => {
    const vals = responses.map(r => (r.answers || {})[q.id]).filter(v => v !== undefined && v !== null && v !== '');
    if (q.type === 'mc' || q.type === 'cb') {
      const counts = (q.options || []).map(() => 0);
      vals.forEach(v => (Array.isArray(v) ? v : [v]).forEach(i => { if (counts[+i] !== undefined) counts[+i]++; }));
      return { q, kind: 'bars', counts, answered: vals.length };
    }
    if (q.type === 'scale') {
      const counts = [0, 0, 0, 0, 0];
      vals.forEach(v => { if (counts[+v - 1] !== undefined) counts[+v - 1]++; });
      const sum = vals.reduce((s, v) => s + +v, 0);
      return { q, kind: 'scale', counts, avg: vals.length ? round1(sum / vals.length) : 0, answered: vals.length };
    }
    // short / long: group answers that read the same
    const groups = [];
    const at = {};
    vals.forEach(v => {
      const t = String(v).trim();
      if (!t) return;
      const k = key(t);
      if (at[k] === undefined) { at[k] = groups.length; groups.push({ text: t, n: 0 }); }
      groups[at[k]].n++;
    });
    groups.sort((a, b) => b.n - a.n);
    return { q, kind: 'text', groups, answered: vals.length };
  });
  const out = { n, items };
  if (form.kind === 'quiz') {
    const scored = responses.filter(r => typeof r.score === 'number');
    const hist = {};
    scored.forEach(r => { hist[r.score] = (hist[r.score] || 0) + 1; });
    const rate = {};
    form.questions.forEach(q => {
      if (q.type === 'scale') return;
      const judged = responses.filter(r => r.per && r.per[q.id] && r.per[q.id].ok !== null && r.per[q.id].ok !== undefined);
      rate[q.id] = judged.length ? judged.filter(r => r.per[q.id].ok).length / judged.length : null;
    });
    out.quiz = {
      avg: scored.length ? round1(scored.reduce((s, r) => s + r.score, 0) / scored.length) : 0,
      max: scored.length ? scored[0].max : form.questions.filter(q => q.type !== 'scale').reduce((s, q) => s + (+q.points || 1), 0),
      hist, rate,
    };
  }
  return out;
}

// Target students who have not answered (anonymous forms have no names, so callers show only the count).
export function missing(form, roster, responses) {
  const targets = form.studentIds ? new Set(String(form.studentIds).split(',')) : null;
  const done = new Set(responses.map(r => r.studentId));
  return roster.filter(s => (!targets || targets.has(s.id)) && !done.has(s.id));
}
