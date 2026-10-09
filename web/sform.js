// Student: answer a survey / quiz / reply. Loaded only when a form is opened.
// Questions are kept on the device after the first open; answers go through the outbox, so "제출됨" shows at once.
import { quiet } from './api.js';
import { store } from './store.js';
import { render, $, toast, loading, currentNav, isCurrent } from './ui.js';
import { esc } from './lib.js';
import * as outbox from './outbox.js';

const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const KIND = { survey: ['설문', 'sv-k-s'], quiz: ['퀴즈', 'sv-k-q'], reply: ['회신', 'sv-k-r'] };
const dueText = d => (d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 ${d.slice(11, 16)}까지` : '');
const stamp = iso => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

export async function formView(id) {
  const n = currentNav();
  let f = lsGet('form:' + id);
  if (f) draw(f); else loading('page');
  try {
    const fresh = await quiet('form', { id });
    if (!isCurrent(n)) return;
    lsSet('form:' + id, fresh);
    const same = f && JSON.stringify(f) === JSON.stringify(fresh);
    f = fresh;
    if (!same && !document.activeElement?.closest('.sv-ans-in')) draw(f);
  } catch (e) {
    if (!f) throw e;
  }
}

function sending(id) { return outbox.forAssignment('f:' + id); }

function draw(f) {
  const q0 = sending(f.id);
  const done = !!f.mine || !!q0;
  const locked = !f.open || (f.kind === 'quiz' && done);
  const draft = lsGet('fdraft:' + f.id);
  const ans = draft || (f.mine && f.mine.answers) || (q0 && q0.payload.answers) || {};
  const [label] = KIND[f.kind];
  const head = `<header class="topbar"><a href="#/home" class="iconbtn" aria-label="뒤로">‹</a><div class="t"><small>${label}${f.due ? ` · ${dueText(f.due)}` : ''}</small><b>${esc(f.title)}</b></div></header>`;
  const titleCard = `<article class="sv-card sv-title sv-top-${f.kind}"><h2>${esc(f.title)}</h2>${f.desc ? `<p>${esc(f.desc)}</p>` : ''}</article>`;
  const anon = f.kind === 'survey' && f.settings && f.settings.anon ? '<div class="sv-anon">🕶️ 익명 설문이에요. 선생님은 누가 냈는지 볼 수 없어요.</div>' : '';
  const status = q0 ? `<div class="sv-sent ${q0.status === 'fail' ? 'fail' : ''}">${q0.status === 'fail' ? '⚠️ 보내지 못했어요 · <button type="button" data-retry>다시 보내기</button>' : '⏳ 선생님께 보내는 중… 앱을 닫아도 이어서 보내요'}</div>`
    : f.mine ? `<div class="sv-sent ok">✓ ${stamp(f.mine.submitted)}에 냈어요${!locked ? ' · 마감 전까지 고쳐서 다시 낼 수 있어요' : ''}</div>` : !f.open ? '<div class="sv-sent">마감된 설문이에요</div>' : '';

  if (f.kind === 'reply') {
    const q = f.questions[0];
    render(`<div id="svf">${head}${titleCard}${status}
      <div class="sv-rbtns big">${q.options.map((o, i) => `<button type="button" class="sv-rbtn ${+ans[q.id] === i && !empty(ans[q.id]) ? 'on' : ''}" data-reply="${i}" ${locked ? 'disabled' : ''}>${+ans[q.id] === i && !empty(ans[q.id]) ? '✓ ' : ''}${esc(o)}</button>`).join('')}</div></div>`);
    $('#svf').onclick = e => {
      if (e.target.closest('[data-retry]')) return outbox.retry(q0.id);
      const b = e.target.closest('[data-reply]');
      if (!b || locked) return;
      submit(f, { [q.id]: +b.dataset.reply });
    };
    return;
  }

  const res = f.result;
  const resultCard = res && !res.hidden && res.max !== undefined ? `<article class="sv-card sv-score"><b>${res.score}<span> / ${res.max}</span></b><small>${res.pending ? '장문 문항은 선생님이 채점 중이에요' : '점수'}</small></article>`
    : res && res.hidden ? '<article class="sv-card sv-score"><small>결과는 선생님이 나중에 공개해요</small></article>'
      : f.kind === 'quiz' && q0 ? '<article class="sv-card sv-score"><small>채점 중…</small></article>' : '';
  const answered = f.questions.filter(q => !empty(ans[q.id])).length;

  render(`<div id="svf">${head}<div class="sv-prog"><i style="width:${f.questions.length ? answered / f.questions.length * 100 : 0}%"></i></div>
    ${titleCard}${anon}${status}${resultCard}
    ${f.questions.map((q, i) => qHtml(q, i, ans[q.id], locked, res)).join('')}
    ${locked ? '' : `<button type="button" class="sv-submit" id="svSubmit">${f.mine ? '다시 제출하기' : '제출하기'}</button>`}</div>`);

  const root = $('#svf');
  const save = () => lsSet('fdraft:' + f.id, ans);
  const prog = () => { $('.sv-prog i').style.width = (f.questions.filter(q => !empty(ans[q.id])).length / f.questions.length * 100) + '%'; };
  root.oninput = e => {
    const t = e.target.closest('[data-text]');
    if (!t) return;
    ans[t.dataset.text] = t.value;
    save(); prog();
  };
  root.onclick = e => {
    if (e.target.closest('[data-retry]')) return outbox.retry(q0.id);
    if (locked) return;
    const b = e.target.closest('[data-pick]');
    if (b) {
      const q = f.questions.find(x => x.id === b.dataset.q), i = +b.dataset.pick;
      if (q.type === 'cb') { const s = new Set(ans[q.id] || []); s.has(i) ? s.delete(i) : s.add(i); ans[q.id] = [...s].sort(); }
      else ans[q.id] = i;
      b.closest('.sv-card').querySelectorAll('[data-pick]').forEach(x => {
        const k = +x.dataset.pick;
        x.classList.toggle('on', q.type === 'cb' ? ans[q.id].includes(k) : +ans[q.id] === k);
      });
      b.closest('.sv-card').classList.remove('need');
      save(); prog();
      return;
    }
    if (e.target.closest('#svSubmit')) {
      const miss = f.questions.find(q => q.required && empty(typeof ans[q.id] === 'string' ? ans[q.id].trim() : ans[q.id]));
      if (miss) {
        const card = root.querySelector(`[data-card="${miss.id}"]`);
        card.classList.add('need');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return toast('필수 문항에 답해 주세요');
      }
      if (f.kind === 'quiz' && !confirm('퀴즈는 한 번만 낼 수 있어요. 제출할까요?')) return;
      submit(f, ans);
    }
  };
}

function qHtml(q, i, v, locked, res) {
  const per = res && res.per && res.per[q.id];
  const key = res && res.keys && res.keys[q.id];
  const mark = per ? (per.ok === true ? `<span class="sv-ok">✓ ${per.got}/${per.max}</span>` : per.ok === false ? `<span class="sv-no">✗ ${per.got}/${per.max}</span>` : '<span class="sv-wait">채점 중</span>') : '';
  const title = `<div class="sv-q">${i + 1}. ${esc(q.title)}${q.required ? ' <em>*</em>' : ''} ${mark}${q.type === 'cb' ? '<small>해당하는 것을 모두 고르세요</small>' : ''}${q.type === 'scale' && (q.lo || q.hi) ? `<small>1 ${esc(q.lo || '')} · 5 ${esc(q.hi || '')}</small>` : ''}</div>`;
  let body;
  if (q.type === 'mc' || q.type === 'cb') {
    const sel = q.type === 'cb' ? (v || []).map(Number) : empty(v) ? [] : [+v];
    const keys = key === undefined ? [] : Array.isArray(key) ? key.map(Number) : [+key];
    body = q.options.map((o, k) => {
      const on = sel.includes(k);
      const cls = keys.length ? (keys.includes(k) ? 'right' : on ? 'wrong' : '') : '';
      return `<button type="button" class="sv-pick ${q.type === 'cb' ? 'cb' : ''} ${on ? 'on' : ''} ${cls}" data-q="${q.id}" data-pick="${k}" ${locked ? 'disabled' : ''}><span class="sv-mk"></span>${esc(o)}</button>`;
    }).join('');
  } else if (q.type === 'scale') {
    body = `<div class="sv-scale-pick">${[1, 2, 3, 4, 5].map(k => `<button type="button" class="${+v === k ? 'on' : ''}" data-q="${q.id}" data-pick="${k}" ${locked ? 'disabled' : ''}>${k}</button>`).join('')}</div>`;
  } else {
    const field = q.type === 'long'
      ? `<textarea class="sv-ans-in" rows="4" data-text="${q.id}" placeholder="내 답변" ${locked ? 'disabled' : ''}>${esc(v || '')}</textarea>`
      : `<input class="sv-ans-in" data-text="${q.id}" value="${esc(v || '')}" placeholder="내 답변" ${locked ? 'disabled' : ''}>`;
    body = field + (key && key.length ? `<div class="sv-key">정답: ${esc(key.join(' · '))}</div>` : '');
  }
  return `<article class="sv-card" data-card="${q.id}">${title}${body}</article>`;
}

async function submit(f, answers) {
  const clean = {};
  Object.entries(answers).forEach(([k, v]) => { if (!empty(typeof v === 'string' ? v.trim() : v)) clean[k] = typeof v === 'string' ? v.trim() : v; });
  await outbox.enqueue({ assignmentId: 'f:' + f.id, title: f.title, action: 'answer', payload: { formId: f.id, answers: clean } });
  lsSet('fdraft:' + f.id, null);
  // home list shows it as done at once
  const me = store.cache('me');
  const it = me && (me.forms || []).find(x => x.id === f.id);
  if (it) { it.done = true; it.submitted = new Date().toISOString(); store.setCache('me', me); }
  toast(f.kind === 'reply' ? '회신했어요 ✓' : '제출했어요. 선생님께 보내는 중이에요');
  draw(f);
}

// When the answer reaches the server: keep its result and redraw if this form is on screen.
addEventListener('outbox', e => {
  const { item, state, result } = e.detail;
  if (item.action !== 'answer' || state !== 'ok') return;
  const id = item.payload.formId;
  const f = lsGet('form:' + id);
  if (f) {
    f.mine = { answers: item.payload.answers, submitted: result.submitted };
    f.result = result.result;
    lsSet('form:' + id, f);
  }
  const me = store.cache('me');
  const it = me && (me.forms || []).find(x => x.id === id);
  if (it) {
    it.done = true;
    it.submitted = result.submitted;
    it.result = result.result && !result.result.hidden ? { score: result.result.score, max: result.result.max, pending: result.result.pending } : null;
    store.setCache('me', me);
  }
  if (f && location.hash === '#/f/' + id && document.getElementById('svf')) draw(f);
});
