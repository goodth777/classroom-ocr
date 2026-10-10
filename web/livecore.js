// Live activity results, computed on the teacher's screen from the answers in the database (pure, no DOM).
// st  = activity { id, type, q, options, anon, hidden, quiz: { qs: [{title, options, answer}], keys: {i: answer}, limit } }
//       (quiz.qs — with the answers — exists only on the teacher's device; keys holds the answers revealed so far)
// ans = { studentId: { v, w: ['..'], t, at, qz: { i: { c, ms } } } }

const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
// the database returns {0: a, 1: b} as an array, and an array with gaps as an object
export const list = x => (x == null ? [] : Object.values(x));

// Faster right answers score more: 1000 at once, 500 at the last moment, 0 when wrong.
export function quizPoints(ok, ms, limitMs) {
  if (!ok) return 0;
  return Math.round(500 + 500 * Math.max(0, 1 - Math.max(0, +ms || 0) / (limitMs || 20000)));
}

// One student's total over the revealed questions.
export function quizTotal(keys, limit, entry) {
  let total = 0;
  Object.keys(keys || {}).forEach(i => {
    const a = entry && entry.qz && entry.qz[i];
    if (a && keys[i] !== null && keys[i] !== undefined) total += quizPoints(+a.c === +keys[i], a.ms, limit * 1000);
  });
  return total;
}

export function liveSummary(st, ans) {
  const ids = Object.keys(ans || {});
  const hidden = new Set(list(st.hidden).map(norm));
  const out = { type: st.type };
  if (st.type === 'vote' || st.type === 'light') {
    out.counts = (st.type === 'light' ? [0, 1, 2] : list(st.options)).map(() => 0);
    out.who = {};
    ids.forEach(id => {
      const v = ans[id].v;
      if (typeof v === 'number' && out.counts[v] !== undefined) { out.counts[v]++; if (!st.anon) out.who[id] = v; }
    });
    out.n = out.counts.reduce((a, b) => a + b, 0);
  } else if (st.type === 'word') {
    const at = {}, words = [];
    let n = 0;
    ids.forEach(id => {
      const w = list(ans[id].w);
      if (w.length) n++;
      w.forEach(x => {
        const k = norm(x);
        if (!k || hidden.has(k)) return;
        if (at[k] === undefined) { at[k] = words.length; words.push({ w: String(x).trim(), n: 0 }); }
        words[at[k]].n++;
      });
    });
    out.words = words.sort((a, b) => b.n - a.n);
    out.n = n;
  } else if (st.type === 'text') {
    out.items = ids.filter(id => ans[id].t && !hidden.has(norm(ans[id].t))).map(id => ({ t: ans[id].t, sid: st.anon ? '' : id, at: ans[id].at || 0 }))
      .sort((a, b) => a.at - b.at);
    out.n = ids.filter(id => ans[id].t).length;
  } else if (st.type === 'quiz') {
    const z = st.quiz;
    out.per = z.qs.map((q, i) => {
      const counts = q.options.map(() => 0);
      ids.forEach(id => { const a = ans[id].qz && ans[id].qz[i]; if (a && counts[+a.c] !== undefined) counts[+a.c]++; });
      return { counts, n: counts.reduce((a, b) => a + b, 0), answer: +q.answer };
    });
    out.score = {};
    ids.forEach(id => { out.score[id] = quizTotal(z.keys, z.limit, ans[id]); });
    out.n = (out.per[z.i] || { n: 0 }).n;
  }
  return out;
}

// What students may see when the teacher turns on "학생 화면에 결과".
export function publicResult(sum) {
  if (sum.type === 'vote') return { counts: sum.counts, n: sum.n };
  if (sum.type === 'word') return { words: sum.words.slice(0, 30), n: sum.n };
  if (sum.type === 'text') return { items: sum.items.slice(-60).map(x => ({ t: x.t })), n: sum.n };
  return null;
}
