// Live classroom activities (vote, word cloud, one-line opinions, understanding lights, paced quiz).
// Pure functions only: the server (Live.js), the tests and the preview mock all use them.
// st  = activity state { id, type, q, options, anon, show, hidden, quiz: { qs: [{title, options, answer}], i, phase, limit } }
// ans = { studentId: { v, w: [], t, at, qz: { i: { c, ms } } } }   (each student writes only their own entry)

const liveKey = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

// Faster right answers score more: 1000 at once, 500 at the last moment, 0 when wrong.
function quizPoints(ok, ms, limitMs) {
  if (!ok) return 0;
  return Math.round(500 + 500 * Math.max(0, 1 - Math.max(0, +ms || 0) / (limitMs || 20000)));
}

// One student's quiz total over the questions already revealed.
function quizTotal(st, d) {
  const z = st.quiz;
  let total = 0;
  for (let i = 0; i < z.qs.length; i++) {
    if (i > z.i || (i === z.i && z.phase === 'ask')) break;
    const a = d && d.qz && d.qz[i];
    if (a) total += quizPoints(+a.c === +z.qs[i].answer, a.ms, z.limit * 1000);
  }
  return total;
}

// What the teacher's screen shows. Anonymous activities drop every student id.
function liveSummary(st, ans) {
  const ids = Object.keys(ans || {});
  const hidden = new Set((st.hidden || []).map(liveKey));
  const out = { type: st.type };
  if (st.type === 'vote') {
    out.counts = (st.options || []).map(() => 0);
    ids.forEach(id => { const v = ans[id].v; if (v !== undefined && v !== null && out.counts[+v] !== undefined) out.counts[+v]++; });
    out.n = out.counts.reduce((a, b) => a + b, 0);
  } else if (st.type === 'word') {
    const at = {}, words = [];
    let n = 0;
    ids.forEach(id => {
      const w = ans[id].w || [];
      if (w.length) n++;
      w.forEach(x => {
        const k = liveKey(x);
        if (!k || hidden.has(k)) return;
        if (at[k] === undefined) { at[k] = words.length; words.push({ w: String(x).trim(), n: 0 }); }
        words[at[k]].n++;
      });
    });
    out.words = words.sort((a, b) => b.n - a.n);
    out.n = n;
  } else if (st.type === 'text') {
    out.items = ids.filter(id => ans[id].t && !hidden.has(liveKey(ans[id].t))).map(id => ({ t: ans[id].t, sid: st.anon ? '' : id, at: ans[id].at || '' }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
    out.n = ids.filter(id => ans[id].t).length;
  } else if (st.type === 'light') {
    out.counts = [0, 0, 0];
    out.who = {};
    ids.forEach(id => { const v = ans[id].v; if (v === 0 || v === 1 || v === 2) { out.counts[v]++; if (!st.anon) out.who[id] = v; } });
    out.n = out.counts.reduce((a, b) => a + b, 0);
  } else if (st.type === 'quiz') {
    const z = st.quiz;
    out.per = z.qs.map((q, i) => {
      const counts = q.options.map(() => 0);
      ids.forEach(id => { const a = ans[id].qz && ans[id].qz[i]; if (a && counts[+a.c] !== undefined) counts[+a.c]++; });
      return { counts, n: counts.reduce((a, b) => a + b, 0), answer: +q.answer };
    });
    out.score = {};
    ids.forEach(id => { out.score[id] = quizTotal(st, ans[id]); });
    out.n = (out.per[z.i] || { n: 0 }).n;
  }
  return out;
}

// What one student's phone shows. Quiz answers stay hidden until the question is revealed.
function livePublic(st, sum, mine) {
  mine = mine || {};
  const out = { id: st.id, type: st.type, q: st.q, options: st.options || [], show: !!st.show, anon: !!st.anon,
    mine: { v: mine.v, w: mine.w || [], t: mine.t || '' } };
  if (st.show && sum) {
    if (st.type === 'vote') out.result = { counts: sum.counts, n: sum.n };
    if (st.type === 'word') out.result = { words: sum.words.slice(0, 30), n: sum.n };
    if (st.type === 'text') out.result = { items: sum.items.map(x => ({ t: x.t })), n: sum.n };
  }
  if (st.type === 'quiz') {
    const z = st.quiz, q = z.qs[z.i] || { title: '', options: [] };
    const a = mine.qz && mine.qz[z.i];
    out.quiz = { title: z.title, i: z.i, n: z.qs.length, phase: z.phase, limit: z.limit, q: q.title, options: q.options, mine: a ? { c: +a.c } : null };
    if (z.phase !== 'ask') {
      out.quiz.answer = +q.answer;
      out.quiz.pts = a ? quizPoints(+a.c === +q.answer, a.ms, z.limit * 1000) : 0;
      out.quiz.total = quizTotal(st, mine);
    }
  }
  return out;
}

// Applies one student action to their own entry. Returns an error message, or '' when done. `now` is an ISO time.
function liveApply(st, mine, op, v, now) {
  if (op === 'v' && (st.type === 'vote' || st.type === 'light')) {
    const n = st.type === 'light' ? 3 : (st.options || []).length;
    if (!(Number.isInteger(+v) && +v >= 0 && +v < n)) return '다시 골라 주세요.';
    mine.v = +v;
  } else if (op === 'w' && st.type === 'word') {
    const w = String(v || '').trim().slice(0, 20);
    if (!w) return '단어를 써 주세요.';
    mine.w = mine.w || [];
    if (mine.w.length >= 3) return '단어는 3번까지 보낼 수 있어요.';
    mine.w.push(w);
  } else if (op === 't' && st.type === 'text') {
    const t = String(v || '').trim().slice(0, 100);
    if (!t) return '의견을 써 주세요.';
    mine.t = t;
    mine.at = now;
  } else if (op === 'qz' && st.type === 'quiz') {
    const z = st.quiz, i = +(v && v.i);
    if (i !== z.i || z.phase !== 'ask') return '이미 넘어간 문제예요.';
    mine.qz = mine.qz || {};
    if (mine.qz[i]) return '';
    const c = +v.c;
    if (!(Number.isInteger(c) && c >= 0 && c < z.qs[i].options.length)) return '다시 골라 주세요.';
    mine.qz[i] = { c, ms: Math.max(0, Math.min(z.limit * 1000, Math.round(+v.ms || 0))) };
  } else return '지금은 할 수 없어요.';
  return '';
}

if (typeof module !== 'undefined') module.exports = { quizPoints, quizTotal, liveSummary, livePublic, liveApply };
