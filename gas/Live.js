// Live classroom activities. While one runs, everything lives in CacheService (a read or write takes a few ms,
// a sheet takes ~0.3s): the state per class and one entry per student (each student writes only their own,
// so no lock is needed). Ending an activity saves it to the Lives sheet.
// ponytail: cache entries last 6h (CacheService maximum); an activity left open longer than that is lost.

const LIVE_TTL_ = 21600;
const LIVE_TYPES_ = { vote: '📊 투표', word: '☁️ 단어 구름', text: '💬 한 줄 의견', light: '🚦 이해도 신호등', quiz: '🎯 함께 푸는 퀴즈' };

const lc_ = () => CacheService.getScriptCache();
const liveGet_ = classId => parse_(lc_().get('live:' + classId), null);
const livePut_ = st => lc_().put('live:' + st.classId, JSON.stringify(st), LIVE_TTL_);
const lvaKey_ = (id, sid) => 'lva:' + id + ':' + sid;
const classSids_ = classId => rows_('Students').filter(s => s.classId === classId).map(s => s.id);

function liveAnswers_(st) {
  const sids = classSids_(st.classId);
  const got = sids.length ? lc_().getAll(sids.map(s => lvaKey_(st.id, s))) : {};
  const ans = {};
  sids.forEach(s => { const v = got[lvaKey_(st.id, s)]; if (v) ans[s] = JSON.parse(v); });
  return ans;
}

// ---------- teacher ----------

function liveStart_(req) {
  const type = req.type;
  if (!LIVE_TYPES_[type]) throw err_('알 수 없는 활동이에요.');
  const cls = rows_('Classes').find(c => c.id === req.classId);
  if (!cls) throw err_('클래스를 찾을 수 없어요.', 'notfound');
  const old = liveGet_(cls.id);
  if (old) liveSave_(old);
  const st = { id: newId_(), classId: cls.id, type, q: String(req.q || '').slice(0, 200), anon: !!req.anon, show: !!req.show, hidden: [], started: now_() };
  if (type === 'vote') {
    st.options = (req.options || []).map(o => String(o).trim().slice(0, 60)).filter(Boolean).slice(0, 6);
    if (st.options.length < 2) throw err_('보기를 두 개 이상 넣어 주세요.');
  }
  if (type === 'quiz') {
    const f = rows_('Forms').find(x => x.id === req.formId && x.classId === cls.id && x.kind === 'quiz');
    if (!f) throw err_('퀴즈를 찾을 수 없어요.', 'notfound');
    const qs = parse_(f.questions, []).filter(q => q.type === 'mc' && (q.options || []).length >= 2 && q.answer !== undefined && q.answer !== null && q.answer !== '')
      .map(q => ({ title: q.title, options: q.options.slice(0, 6), answer: +q.answer }));
    if (!qs.length) throw err_('정답이 있는 객관식 문항이 없어요.');
    st.q = f.title;
    st.quiz = { formId: f.id, title: f.title, qs, i: 0, phase: 'ask', limit: [10, 20, 30, 60].includes(+req.limit) ? +req.limit : 20 };
  }
  livePut_(st);
  if (req.push) notifyStudents_(classSids_(cls.id), 'ann', { title: '지금 수업 활동 · ' + LIVE_TYPES_[type], body: st.q, url: '#/live', tag: 'live' });
  return liveView_({ classId: cls.id });
}

function liveView_(req) {
  const st = liveGet_(req.classId);
  if (!st) return { st: null };
  return { st, sum: liveSummary(st, liveAnswers_(st)) };
}

function liveCtl_(req) {
  const st = liveGet_(req.classId);
  if (!st) throw err_('진행 중인 활동이 없어요.', 'notfound');
  const op = req.op;
  if (st.type === 'quiz' && (op === 'reveal' || op === 'next')) {
    const z = st.quiz;
    if (op === 'reveal') z.phase = 'reveal';
    else if (z.i < z.qs.length - 1) { z.i++; z.phase = 'ask'; }
    else z.phase = 'end';
  } else if (op === 'hide') {
    st.hidden.push(String(req.arg || '').slice(0, 100));
  } else if (op === 'show') {
    st.show = !st.show;
  } else if (op === 'reset' && st.type === 'light') {
    const ans = liveAnswers_(st), put = {};
    Object.keys(ans).forEach(sid => { delete ans[sid].v; put[lvaKey_(st.id, sid)] = JSON.stringify(ans[sid]); });
    if (Object.keys(put).length) lc_().putAll(put, LIVE_TTL_);
  } else throw err_('알 수 없는 요청이에요.');
  livePut_(st);
  return liveView_(req);
}

// Saves the activity with its final result and the students' names (none when anonymous).
function liveSave_(st) {
  const sum = liveSummary(st, liveAnswers_(st));
  const names = {};
  if (!st.anon || st.type === 'quiz') rows_('Students').filter(s => s.classId === st.classId).forEach(s => { names[s.id] = s.name; });
  let data = JSON.stringify({ st, sum, names });
  if (data.length > 45000) data = JSON.stringify({ st, sum: Object.assign({}, sum, { items: (sum.items || []).slice(0, 150), words: (sum.words || []).slice(0, 150) }), names }).slice(0, 49000);
  withLock_(() => append_('Lives', { id: st.id, classId: st.classId, type: st.type, title: st.q, data, started: st.started, ended: now_() }));
  lc_().remove('live:' + st.classId);
}

function liveEnd_(req) {
  const st = liveGet_(req.classId);
  if (st) liveSave_(st);
  return { st: null };
}

const lives_ = req => rows_('Lives').filter(l => l.classId === req.classId).map(l => ({ id: l.id, type: l.type, title: l.title, started: l.started, ended: l.ended })).reverse();
function liveRec_(req) {
  const l = rows_('Lives').find(x => x.id === req.id && x.classId === req.classId);
  if (!l) throw err_('기록을 찾을 수 없어요.', 'notfound');
  return parse_(l.data, null);
}
function liveRecDel_(req) {
  return withLock_(() => { deleteRows_('Lives', rows_('Lives').filter(x => x.id === req.id && x.classId === req.classId)); return lives_(req); });
}

// ---------- student ----------

function live_(req, who) {
  const st = liveGet_(who.cls.id);
  if (!st) return null;
  const mine = parse_(lc_().get(lvaKey_(st.id, who.student.id)), {});
  return livePublic(st, st.show ? liveSummary(st, liveAnswers_(st)) : null, mine);
}

function liveAns_(req, who) {
  const st = liveGet_(who.cls.id);
  if (!st || st.id !== req.id) throw err_('끝난 활동이에요.', 'gone');
  const key = lvaKey_(st.id, who.student.id);
  const mine = parse_(lc_().get(key), {});
  const e = liveApply(st, mine, req.op, req.v, now_());
  if (e) throw err_(e);
  lc_().put(key, JSON.stringify(mine), LIVE_TTL_);
  return livePublic(st, st.show ? liveSummary(st, liveAnswers_(st)) : null, mine);
}
