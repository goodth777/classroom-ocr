// Surveys, quizzes and replies for teaching classes. Quiz answers never leave the server:
// students get questions without `answer`, and their results are graded here.
const MAX_FORM_JSON_ = 30000;
const FORM_KINDS_ = { survey: '📊 새 설문 · ', quiz: '🎯 새 퀴즈 · ', reply: '✅ 회신 요청 · ' };

const parse_ = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const formOut_ = f => ({
  id: f.id, classId: f.classId, kind: f.kind, title: f.title, desc: f.desc, due: f.due, studentIds: f.studentIds,
  questions: parse_(f.questions, []), settings: parse_(f.settings, {}), status: f.status, created: f.created, updated: f.updated, sent: f.sent,
});
// Due is Korea local time 'YYYY-MM-DDTHH:mm'; compare as text against "now" in the same form.
const kstNow_ = () => Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm");
const isOpen_ = f => f.status === 'live' && (!f.due || kstNow_() <= f.due);
const formTargets_ = f => {
  const t = f.studentIds ? new Set(String(f.studentIds).split(',')) : null;
  return rows_('Students').filter(s => s.classId === f.classId && (!t || t.has(s.id)));
};
const voter_ = (formId, studentId) => hash_(formId + ':' + studentId);
function myResponse_(f, studentId) {
  const anon = !!parse_(f.settings, {}).anon;
  return rows_('Responses').find(r => r.formId === f.id && (anon ? r.voter === voter_(f.id, studentId) : r.studentId === studentId));
}

// What a student may see of a quiz result, by the form's reveal setting.
function revealFor_(f, resp) {
  if (!resp || f.kind !== 'quiz') return null;
  const s = parse_(f.settings, {});
  const reveal = s.reveal || 'now';
  const over = f.status === 'closed' || (f.due && kstNow_() > f.due);
  if (reveal === 'none' || (reveal === 'after' && !over)) return { hidden: true };
  const g = grade(parse_(f.questions, []), parse_(resp.answers, {}), parse_(resp.manual, {}));
  if (reveal === 'score') return { score: g.score, max: g.max, pending: g.pending };
  const keys = {};
  parse_(f.questions, []).forEach(q => { if (q.answer !== undefined) keys[q.id] = q.answer; });
  return { score: g.score, max: g.max, pending: g.pending, per: g.per, keys: keys };
}

// ---------- student ----------

// Part of "me": a light list only (no questions).
function studentForms_(who) {
  const sid = who.student.id;
  return rows_('Forms').filter(f => f.classId === who.cls.id && f.status !== 'draft' && formTargets_(f).some(s => s.id === sid)).map(f => {
    const r = myResponse_(f, sid);
    const res = revealFor_(f, r);
    return { id: f.id, kind: f.kind, title: f.title, due: f.due, status: isOpen_(f) ? 'live' : 'closed', n: parse_(f.questions, []).length,
      anon: !!parse_(f.settings, {}).anon, done: !!r, submitted: r ? r.submitted : '', result: res && !res.hidden ? { score: res.score, max: res.max, pending: res.pending } : null };
  });
}

function form_(req, who) {
  const f = rows_('Forms').find(x => x.id === req.id && x.classId === who.cls.id && x.status !== 'draft');
  if (!f || !formTargets_(f).some(s => s.id === who.student.id)) throw err_('설문을 찾을 수 없어요.', 'notfound');
  const out = formOut_(f);
  out.questions = out.questions.map(q => { const c = Object.assign({}, q); delete c.answer; return c; });
  out.open = isOpen_(f);
  const r = myResponse_(f, who.student.id);
  out.mine = r ? { answers: parse_(r.answers, {}), submitted: r.submitted } : null;
  out.result = revealFor_(f, r);
  return out;
}

function answer_(req, who) {
  const answers = req.answers || {};
  if (JSON.stringify(answers).length > MAX_FORM_JSON_) throw err_('답이 너무 길어요.');
  return withLock_(() => {
    const f = rows_('Forms').find(x => x.id === req.formId && x.classId === who.cls.id);
    if (!f || !formTargets_(f).some(s => s.id === who.student.id)) throw err_('설문을 찾을 수 없어요.', 'notfound');
    if (!isOpen_(f)) throw err_('마감된 설문이에요.', 'bad');
    const qs = parse_(f.questions, []);
    const empty = qs.find(q => q.required && (answers[q.id] === undefined || answers[q.id] === '' || (Array.isArray(answers[q.id]) && !answers[q.id].length)));
    if (empty) throw err_(`"${empty.title}"에 답해 주세요.`, 'bad');
    const prev = myResponse_(f, who.student.id);
    if (prev && f.kind === 'quiz') throw err_('퀴즈는 한 번만 낼 수 있어요.', 'bad');
    const anon = !!parse_(f.settings, {}).anon;
    const g = f.kind === 'quiz' ? grade(qs, answers, {}) : null;
    const row = { formId: f.id, studentId: anon ? '' : who.student.id, voter: anon ? voter_(f.id, who.student.id) : '',
      answers: JSON.stringify(answers), score: g ? g.score : '', manual: prev ? prev.manual : '', submitted: now_() };
    if (prev) { Object.assign(prev, row); update_('Responses', prev._row, prev); }
    else append_('Responses', Object.assign({ id: newId_() }, row));
    bump_(f.classId);
    return { submitted: row.submitted, result: revealFor_(f, prev || row) };
  });
}

// ---------- teacher ----------

function forms_(req) {
  const counts = {};
  rows_('Responses').forEach(r => { counts[r.formId] = (counts[r.formId] || 0) + 1; });
  return rows_('Forms').filter(f => f.classId === req.classId).map(f => Object.assign(formOut_(f), { responses: counts[f.id] || 0, targets: formTargets_(f).length }));
}

function formPut_(req) {
  const f = req.form || {};
  const questions = JSON.stringify(f.questions || []), settings = JSON.stringify(f.settings || {});
  if (!f.id || questions.length > MAX_FORM_JSON_ || !FORM_KINDS_[f.kind]) throw err_('설문을 저장하지 못했어요.');
  const cls = rows_('Classes').find(c => c.id === f.classId);
  if (!cls) throw err_('클래스를 찾을 수 없어요.', 'notfound');
  // teaching classes make quizzes and replies, homeroom classes surveys and replies (older surveys stay editable)
  const allowed = cls.kind === 'homeroom' ? ['survey', 'reply'] : ['quiz', 'reply'];
  const existing = rows_('Forms').find(x => x.id === f.id);
  if (allowed.indexOf(f.kind) < 0 && !(existing && existing.kind === f.kind)) throw err_('이 클래스에서는 만들 수 없는 종류예요.');
  const updated = String(f.updated || now_());
  return withLock_(() => {
    const row = rows_('Forms').find(x => x.id === f.id);
    const vals = { kind: f.kind, title: String(f.title || '').slice(0, 200), desc: String(f.desc || '').slice(0, 2000), due: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.due || '') ? f.due : '',
      studentIds: f.studentIds ? targetIds_(f.classId, String(f.studentIds).split(',')) : '', questions: questions, settings: settings, updated: updated };
    if (row) {
      if (String(row.updated) >= updated) return row.updated; // a late, older autosave
      Object.assign(row, vals);
      update_('Forms', row._row, row);
      if (row.status !== 'draft') bump_(row.classId);
    } else {
      append_('Forms', Object.assign({ id: f.id, classId: f.classId, status: 'draft', created: now_(), sent: '' }, vals));
    }
    return updated;
  });
}

function setStatus_(id, status) {
  return withLock_(() => {
    const f = rows_('Forms').find(x => x.id === id);
    if (!f) throw err_('설문을 찾을 수 없어요.', 'notfound');
    f.status = status;
    if (status === 'live' && !f.sent) f.sent = now_();
    f.updated = now_();
    update_('Forms', f._row, f);
    bump_(f.classId);
    return f;
  });
}

function formSend_(req) {
  const f = setStatus_(req.id, 'live');
  notifyStudents_(formTargets_(f).map(s => s.id), 'ann', { title: FORM_KINDS_[f.kind] + f.title, body: f.desc || '', url: '#/f/' + f.id, tag: 'f-' + f.id });
  return formOut_(f);
}
const formClose_ = req => formOut_(setStatus_(req.id, 'closed'));

function formDel_(req) {
  return withLock_(() => {
    const f = rows_('Forms').find(x => x.id === req.id);
    if (!f) return true;
    deleteRows_('Responses', rows_('Responses').filter(r => r.formId === f.id));
    deleteRows_('Forms', [f]);
    bump_(f.classId);
    return true;
  });
}

// Responses with grading details; anonymous forms come back without names.
function responses_(req) {
  const f = rows_('Forms').find(x => x.id === req.formId);
  if (!f) throw err_('설문을 찾을 수 없어요.', 'notfound');
  const qs = parse_(f.questions, []);
  return rows_('Responses').filter(r => r.formId === f.id).map(r => {
    const answers = parse_(r.answers, {}), manual = parse_(r.manual, {});
    const g = f.kind === 'quiz' ? grade(qs, answers, manual) : null;
    return { id: r.id, studentId: r.studentId, answers: answers, manual: manual, submitted: r.submitted,
      score: g ? g.score : null, max: g ? g.max : null, pending: g ? g.pending : false, per: g ? g.per : null };
  });
}

function grade_(req) {
  return withLock_(() => {
    const r = rows_('Responses').find(x => x.id === req.responseId);
    if (!r) throw err_('응답을 찾을 수 없어요.', 'notfound');
    const f = rows_('Forms').find(x => x.id === r.formId);
    const manual = Object.assign(parse_(r.manual, {}), req.manual || {});
    const g = grade(parse_(f.questions, []), parse_(r.answers, {}), manual);
    r.manual = JSON.stringify(manual);
    r.score = g.score;
    update_('Responses', r._row, r);
    bump_(f.classId);
    return { score: g.score, max: g.max, pending: g.pending, per: g.per };
  });
}

// Push to target students who have not answered yet (named forms only).
function formNudge_(req) {
  const f = rows_('Forms').find(x => x.id === req.id);
  if (!f) throw err_('설문을 찾을 수 없어요.', 'notfound');
  const done = new Set(rows_('Responses').filter(r => r.formId === f.id).map(r => r.studentId));
  const anon = !!parse_(f.settings, {}).anon;
  const ids = formTargets_(f).map(s => s.id).filter(id => anon ? !myResponse_(f, id) : !done.has(id));
  notifyStudents_(ids, 'ann', { title: '⏰ 아직 안 냈어요 · ' + f.title, body: f.due ? '마감 ' + f.due.replace('T', ' ') : '', url: '#/f/' + f.id, tag: 'f-' + f.id });
  return ids.length;
}
