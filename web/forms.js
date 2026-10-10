// Teacher: surveys, quizzes and replies for a teaching class. Loaded only when the 설문 tab opens.
// Edits are saved on the device at once and sent to the server 2 s later; nothing waits for Apps Script.
import { call, quiet } from './api.js';
import { render, $, toast } from './ui.js';
import { esc } from './lib.js';
import { fa } from './fa.js';
import { summarize, missing } from './formlogic.js';
import { uploadFile, chipsHtml, MAX_FILES } from './attach.js';

const SYNC_MS = 2000;
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const qid = () => 'q' + Math.random().toString(36).slice(2, 8);

const KIND = {
  survey: { label: '설문', icon: 'square-poll-horizontal', cls: 'sv-k-s', blurb: '의견·정보를 모아요.' },
  quiz: { label: '퀴즈', icon: 'graduation-cap', cls: 'sv-k-q', blurb: '정답·배점으로 자동 채점해요.' },
  reply: { label: '회신', icon: 'reply', cls: 'sv-k-r', blurb: '버튼 한 번으로 끝나는 확인.' },
};
const TYPES = [['mc', '객관식', 'circle-dot'], ['cb', '체크박스', 'square-check'], ['short', '단답형', 'grip-lines'], ['long', '장문형', 'align-left'], ['scale', '척도 (1~5)', 'ellipsis']];
const REVEAL = [['now', '제출 즉시 점수+정답'], ['after', '마감 후 공개'], ['score', '점수만'], ['none', '안 보여 줌']];
const REPLY = { ok: ['확인했어요'], yn: ['예', '아니요'] };
const kindChip = k => `<span class="sv-kind ${KIND[k].cls}">${fa(KIND[k].icon)}${KIND[k].label}</span>`;
const dueText = d => (d ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 ${d.slice(11, 16)} 마감` : '마감 없음');
const nowKst = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 16);
const isOver = f => f.status === 'closed' || (f.due && nowKst() > f.due);

let ctx = null;
let F = null; // { cls, list, fetched, sync: {id: ''|'wait'|'fail'}, resp: {formId: []}, warned: {} }
const timers = {};

// ---------- data ----------

function load(cls) {
  F = { cls: cls.id, list: lsGet('forms:' + cls.id) || [], fetched: false, sync: {}, resp: {}, warned: {} };
}
const saveList = () => lsSet('forms:' + F.cls, F.list);
const byId = id => F.list.find(f => f.id === id);

async function fetchList() {
  const cls = F.cls;
  let rows;
  try { rows = await quiet('forms', { classId: cls }); } catch { return; }
  if (!F || F.cls !== cls) return;
  // keep local edits that the server has not seen yet
  const merged = rows.map(r => { const l = byId(r.id); return l && l.updated > r.updated ? { ...r, ...l } : r; });
  F.list.filter(l => !rows.some(r => r.id === l.id) && l.local).forEach(l => { merged.push(l); scheduleSave(l.id); });
  const changed = JSON.stringify(merged) !== JSON.stringify(F.list);
  F.list = merged;
  saveList();
  if (changed && !document.querySelector('dialog[open]') && !document.activeElement?.closest('.sv-builder')) redraw();
}

function commit(f, { draw = false } = {}) {
  f.updated = new Date().toISOString();
  const i = F.list.findIndex(x => x.id === f.id);
  if (i < 0) F.list.unshift(f); else F.list[i] = f;
  saveList();
  scheduleSave(f.id);
  if (draw) redraw(); else paintSync(f.id);
}

function scheduleSave(id) {
  F.sync[id] = 'wait';
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => pushForm(id), SYNC_MS);
  paintSync(id);
}

async function pushForm(id) {
  const f = byId(id);
  if (!f) return;
  clearTimeout(timers[id]);
  const { responses, targets, local, ...form } = f;
  try {
    await quiet('formPut', { form });
    if (byId(id) && byId(id).updated === f.updated) { F.sync[id] = ''; byId(id).local = false; saveList(); }
  } catch { F.sync[id] = 'fail'; }
  paintSync(id);
}

function paintSync(id) {
  const el = document.getElementById('svSync');
  if (!el || el.dataset.id !== id) return;
  const s = F.sync[id];
  el.className = 'sv-sync ' + (s || '');
  el.innerHTML = s === 'fail' ? `${fa('circle-exclamation')} 저장 대기 · 연결되면 보내요` : s === 'wait' ? '저장 중…' : `${fa('check')} 자동 저장됨`;
}

// ---------- routing ----------

let route = { sub: '', sub2: '' };
function redraw() { formsView(ctx, route.sub, route.sub2); }

export function formsView(c, sub = '', sub2 = '') {
  ctx = c;
  route = { sub, sub2 };
  if (!F || F.cls !== c.cls.id) load(c.cls);
  if (!F.fetched) { F.fetched = true; fetchList(); }
  if (sub === 'new') return drawChooser();
  const f = sub && byId(sub);
  if (f) return sub2 === 'a' ? drawResponses(f) : drawBuilder(f);
  drawList();
}

const go = h => { location.hash = `#/t/${F.cls}/forms${h}`; };
const paint = (body, actions = '') => { render(ctx.frame(body, actions)); ctx.after(); };

// ---------- list ----------

let listFilter = 'all';
let picking = null; // Set of selected form ids while in "선택" mode

function drawList() {
  const state = f => (f.status === 'draft' ? ['draft', '초안'] : isOver(f) ? ['closed', '마감'] : ['live', '진행 중']);
  const all = F.list.slice().sort((a, b) => String(b.created || b.updated).localeCompare(String(a.created || a.updated)));
  const rows = all.filter(f => listFilter === 'all' || state(f)[0] === listFilter);
  const count = k => all.filter(f => state(f)[0] === k).length;
  const bar = `<div class="sv-listbar"><div class="seg2 sv-filter">${[['all', '전체', all.length], ['draft', '초안', count('draft')], ['live', '진행 중', count('live')], ['closed', '마감', count('closed')]]
      .map(([k, t, n]) => `<button type="button" data-filter="${k}" class="${listFilter === k ? 'on' : ''}">${t} <small>${n}</small></button>`).join('')}</div><span class="sp"></span>
    ${picking ? `<button type="button" class="btn" id="svPickAll">${rows.length && rows.every(f => picking.has(f.id)) ? '전체 해제' : '전체 선택'}</button>
      <button type="button" class="btn sv-danger" id="svPickDel" ${picking.size ? '' : 'disabled'}>${fa('trash-can')}선택 삭제 (${picking.size})</button>
      <button type="button" class="btn" id="svPickOff">취소</button>`
    : `<button type="button" class="btn" id="svPickOn" ${all.length ? '' : 'disabled'}>${fa('square-check')}선택</button>`}</div>`;
  const row = f => {
    const [st, label] = state(f);
    const tot = f.targets || (ctx.v.roster || []).length || 0, n = f.responses || 0;
    const meta = [dueText(f.due), f.settings && f.settings.anon ? '익명' : '', `${(f.questions || []).length}문항`].filter(Boolean).join(' · ');
    const inner = `${picking ? `<span class="sv-check ${picking.has(f.id) ? 'on' : ''}">${fa('check')}</span>` : ''}${kindChip(f.kind)}
      <div class="sv-row-t"><b>${esc(f.title || '제목 없음')}</b><small>${esc(meta)}</small></div>
      <div class="sv-row-n"><span><b>${n}</b>/${tot}명 냄</span><span class="sv-bar"><i style="width:${tot ? Math.min(100, n / tot * 100) : 0}%"></i></span></div>
      <span class="sv-st ${st}">${label}</span>`;
    return picking
      ? `<button type="button" class="sv-row picking ${picking.has(f.id) ? 'sel' : ''}" data-pick="${f.id}">${inner}</button>`
      : `<a class="sv-row" href="#/t/${F.cls}/forms/${f.id}${f.status === 'draft' ? '' : '/a'}">${inner}</a>`;
  };
  paint(`${bar}<section class="sv-list">${rows.map(row).join('') || `<div class="sv-empty">${fa('square-poll-horizontal')}<p>${all.length ? '이 조건에 맞는 항목이 없어요.' : `아직 만든 것이 없어요.<br>오른쪽 위 "새로 만들기"로 ${ctx.cls.kind === 'homeroom' ? '설문·회신' : '퀴즈·회신'}을 만들어 보세요.`}</p></div>`}</section>`,
  `<a class="btn primary" href="#/t/${F.cls}/forms/new">${fa('plus')}새로 만들기</a>`);
  $('.sv-listbar').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.filter) { listFilter = b.dataset.filter; if (picking) picking.clear(); }
    else if (b.id === 'svPickOn') picking = new Set();
    else if (b.id === 'svPickOff') picking = null;
    else if (b.id === 'svPickAll') { const allOn = rows.every(f => picking.has(f.id)); rows.forEach(f => (allOn ? picking.delete(f.id) : picking.add(f.id))); }
    else if (b.id === 'svPickDel') return deletePicked();
    drawList();
  };
  if (picking) $('.sv-list').onclick = e => {
    const r = e.target.closest('[data-pick]');
    if (!r) return;
    picking.has(r.dataset.pick) ? picking.delete(r.dataset.pick) : picking.add(r.dataset.pick);
    drawList();
  };
}

// Gone from the screen at once; the server deletes behind.
function deletePicked() {
  const ids = [...picking];
  const withAnswers = F.list.filter(f => ids.includes(f.id)).reduce((n, f) => n + (f.responses || 0), 0);
  if (!confirm(`${ids.length}개를 지울까요?${withAnswers ? `\n받은 응답 ${withAnswers}개도 함께 지워져요.` : ''}`)) return;
  F.list = F.list.filter(f => !ids.includes(f.id));
  saveList();
  ids.forEach(id => { clearTimeout(timers[id]); quiet('formDel', { id }).catch(() => {}); });
  picking = null;
  toast(`${ids.length}개를 지웠어요`);
  drawList();
}

// ---------- new: pick a kind ----------

function blank(kind) {
  const base = { id: newId(), classId: F.cls, kind, desc: '', due: '', studentIds: '', status: 'draft', created: new Date().toISOString(), local: true };
  if (kind === 'reply') return { ...base, title: '확인해 주세요', settings: { reply: 'ok' }, questions: [{ id: 'r', type: 'mc', title: '확인', required: true, options: REPLY.ok.slice() }] };
  return { ...base, title: kind === 'quiz' ? '새 퀴즈' : '새 설문', settings: kind === 'quiz' ? { reveal: 'now' } : { anon: false },
    questions: [{ id: qid(), type: 'mc', title: '', required: true, options: ['선택지 1', '선택지 2'], points: 1 }] };
}

// Teaching classes: quiz + reply. Homeroom classes: survey + reply.
const kindsFor = cls => (cls.kind === 'homeroom' ? ['survey', 'reply'] : ['quiz', 'reply']);

function drawChooser() {
  const ITEMS = {
    survey: ['객관식·체크박스·단답·장문·척도', '익명으로 받기 가능', '요약 그래프 · CSV'],
    quiz: ['객관식·체크박스·단답 자동 채점', '장문은 직접 채점', '점수표 · 문항별 정답률'],
    reply: ['확인했어요 / 예·아니요 / 직접 선택지', '안 한 학생 바로 보기', '가정통신문 확인 등'],
  };
  const card = (k, items) => `<button type="button" class="sv-kc" data-kind="${k}"><span class="sv-kc-ic ${KIND[k].cls}">${fa(KIND[k].icon)}</span><b>${KIND[k].label}</b><p>${KIND[k].blurb}</p><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></button>`;
  paint(`<section class="sv-chooser"><h2>무엇을 만들까요?</h2><div class="sv-cards two">
    ${kindsFor(ctx.cls).map(k => card(k, ITEMS[k])).join('')}
  </div></section>`, `<a class="btn" href="#/t/${F.cls}/forms">취소</a>`);
  $('.sv-cards').onclick = e => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    const f = blank(b.dataset.kind);
    commit(f);
    go('/' + f.id);
  };
}

// ---------- builder ----------

function header(f, tab) {
  const n = f.responses || 0, tot = f.targets || (ctx.v.roster || []).length;
  return `<div class="sv-head"><a class="sv-back" href="#/t/${F.cls}/forms" aria-label="목록">${fa('chevron-left')}</a>${kindChip(f.kind)}
    <h2>${esc(f.title || '제목 없음')}</h2><span class="sp"></span>
    ${f.kind === 'quiz' && tab === 'q' ? `<button type="button" class="btn" id="svLive" title="학생에게 보내지 않아도 돼요">${fa('chalkboard-user')}수업에서 함께 풀기</button>` : ''}
    <nav class="seg2 sv-tabs"><a href="#/t/${F.cls}/forms/${f.id}" class="${tab === 'q' ? 'on' : ''}">질문</a><a href="#/t/${F.cls}/forms/${f.id}/a" class="${tab === 'a' ? 'on' : ''}">응답 ${n}/${tot}</a></nav></div>`;
}

function setbar(f) {
  const roster = ctx.v.roster || [];
  const target = f.studentIds ? `${String(f.studentIds).split(',').length}명` : `클래스 전체 (${roster.length}명)`;
  const total = f.questions.filter(q => q.type !== 'scale').reduce((s, q) => s + (+q.points || 1), 0);
  const act = f.status === 'draft'
    ? `<button type="button" class="btn primary" id="svSend">${fa('paper-plane')}학생에게 보내기</button>`
    : isOver(f) ? `<button type="button" class="btn" id="svReopen">${fa('rotate')}다시 열기</button>`
      : `<button type="button" class="btn" id="svClose">${fa('lock')}지금 마감</button>`;
  return `<div class="sv-setbar">
    <button type="button" class="sv-it" id="svTarget">${fa('users')}대상: ${target}</button>
    <label class="sv-it">${fa('calendar-check')}마감 <input type="datetime-local" id="svDue" value="${esc(f.due || '')}"></label>
    ${f.kind === 'survey' ? `<label class="sv-it">${fa('user-secret')}익명으로 받기 <input type="checkbox" class="sv-sw" id="svAnon" ${f.settings.anon ? 'checked' : ''} ${f.status !== 'draft' ? 'disabled' : ''}></label>` : ''}
    ${f.kind === 'quiz' ? `<label class="sv-it">${fa('eye')}결과 <select id="svReveal">${REVEAL.map(([v, t]) => `<option value="${v}" ${f.settings.reveal === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><span class="sv-it">${fa('star')}총 ${total}점</span>` : ''}
    <span class="sp"></span><span id="svSync" data-id="${f.id}"></span>
    <button type="button" class="btn sv-del" id="svDel" aria-label="삭제">${fa('trash-can')}</button>${act}</div>`;
}

function optRow(f, q, i, o) {
  const quiz = f.kind === 'quiz';
  const isAns = quiz && (q.type === 'mc' ? +q.answer === i && q.answer !== undefined && q.answer !== null : q.type === 'cb' && (q.answer || []).includes(i));
  const mark = q.type === 'cb' ? 'sv-box' : 'sv-dot';
  return `<div class="sv-opt ${isAns ? 'ans' : ''}"><span class="${mark}"></span><input data-opt="${i}" value="${esc(o)}" aria-label="선택지 ${i + 1}">
    ${quiz ? `<button type="button" data-key="${i}" class="sv-keybtn ${isAns ? 'on' : ''}" aria-label="정답으로 표시">${fa('check')}${isAns ? ' 정답' : ''}</button>` : ''}
    <button type="button" data-delopt="${i}" class="sv-x" aria-label="선택지 지우기">${fa('xmark')}</button></div>`;
}

function qCard(f, q, k) {
  const quiz = f.kind === 'quiz';
  let body = '';
  if (q.type === 'mc' || q.type === 'cb') body = (q.options || []).map((o, i) => optRow(f, q, i, o)).join('') + `<button type="button" class="sv-addopt" data-addopt>${fa('plus')} 선택지 추가</button>`;
  else if (q.type === 'short') body = `<div class="sv-ph">단답형 답</div>${quiz ? `<label class="sv-keys">${fa('square-check')}정답 <input data-keys value="${esc((q.answer || []).join(', '))}" placeholder="쉼표로 여러 개 (띄어쓰기·대소문자 무시)"></label>` : ''}`;
  else if (q.type === 'long') body = `<div class="sv-ph long">장문형 답</div>${quiz ? `<p class="sv-hint">${fa('pen')} 학생별 응답에서 직접 채점해요.</p>` : ''}`;
  else body = `<div class="sv-scale"><input data-lo value="${esc(q.lo || '')}" placeholder="1 이름표 (예: 전혀 아니다)"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><input data-hi value="${esc(q.hi || '')}" placeholder="5 이름표 (예: 매우 그렇다)"></div>`;
  const pts = quiz && q.type !== 'scale' ? `<label class="sv-pts">배점 <input type="number" min="0" max="100" data-pts value="${+q.points || 1}"></label>` : '';
  return `<article class="sv-card" data-q="${k}">
    <div class="att-row">${chipsHtml(q.attach, 'q' + k)}</div>
    <div class="sv-qh"><input class="sv-qt" data-title value="${esc(q.title)}" placeholder="질문"><select data-type aria-label="문항 종류">${TYPES.filter(([t]) => !(quiz && t === 'scale')).map(([t, n]) => `<option value="${t}" ${q.type === t ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${body}
    <div class="sv-qf">${pts}<span class="sp"></span>
      <button type="button" data-move="-1" aria-label="위로">${fa('arrow-up')}</button><button type="button" data-move="1" aria-label="아래로">${fa('arrow-down')}</button>
      <label class="sv-attbtn" aria-label="사진·파일 첨부">${fa('paperclip')}<input type="file" multiple hidden data-attach="q${k}"></label>
      <button type="button" data-dup aria-label="복사">${fa('copy')}</button><button type="button" data-delq aria-label="문항 삭제">${fa('trash-can')}</button>
      <label class="sv-req">필수 <input type="checkbox" class="sv-sw" data-req ${q.required ? 'checked' : ''}></label></div>
  </article>`;
}

function replyCard(f) {
  const mode = f.settings.reply || 'ok';
  const q = f.questions[0];
  return `<article class="sv-card"><div class="sv-lab">학생 버튼</div>
    <div class="seg2 sv-reply" id="svReply">${[['ok', '확인했어요'], ['yn', '예 / 아니요'], ['custom', '직접 선택지']].map(([v, t]) => `<button type="button" data-reply="${v}" class="${mode === v ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${mode === 'custom' ? `<div data-q="0">${(q.options || []).map((o, i) => optRow(f, q, i, o)).join('')}<button type="button" class="sv-addopt" data-addopt>${fa('plus')} 선택지 추가</button></div>`
      : `<div class="sv-rbtns">${q.options.map(o => `<span class="sv-rbtn">${esc(o)}</span>`).join('')}</div>`}
  </article>`;
}

function drawBuilder(f) {
  const cards = f.kind === 'reply' ? replyCard(f) : f.questions.map((q, k) => qCard(f, q, k)).join('');
  paint(`${header(f, 'q')}${setbar(f)}
    <section class="sv-builder"><div class="sv-col">
      <article class="sv-card sv-title sv-top-${f.kind}"><input class="sv-tt" id="svTitle" value="${esc(f.title)}" placeholder="제목"><textarea id="svDesc" rows="2" placeholder="안내 (선택) · 주소를 쓰면 링크가 돼요">${esc(f.desc)}</textarea>
        <div class="att-row">${chipsHtml(f.settings.attach, 't')}<label class="att-pick small">${fa('paperclip')} 사진·파일 첨부<input type="file" multiple hidden data-attach="t"></label></div></article>
      ${cards}
      ${f.kind === 'reply' ? '' : `<button type="button" class="sv-addq" id="svAddQ">${fa('circle-plus')} 문항 추가</button>`}
    </div></section>
    <dialog class="sheet" id="svDlg"></dialog>`);
  paintSync(f.id);
  bindBuilder(f);
}

// Changing questions that already have answers can break them: ask once per form per session.
function okToRestructure(f) {
  if (f.status === 'draft' || !(f.responses > 0) || F.warned[f.id]) return true;
  if (!confirm('이미 낸 답이 있어요. 문항을 바꾸면 기존 답과 맞지 않을 수 있어요. 계속할까요?')) return false;
  F.warned[f.id] = true;
  return true;
}

// Uploads run while the teacher keeps editing; the chip list redraws when each file is in.
async function attachFiles(f, key, files) {
  const list = key === 't' ? (f.settings.attach ||= []) : (f.questions[+key.slice(1)].attach ||= []);
  const room = MAX_FILES - list.length;
  if (room <= 0) return toast(`첨부는 ${MAX_FILES}개까지예요`);
  const pick = [...files].slice(0, room);
  toast(`${pick.length}개 올리는 중…`);
  for (const file of pick) {
    try { list.push(await uploadFile(file)); commit(f, { draw: !document.activeElement?.closest('.sv-col input, .sv-col textarea') }); }
    catch (e) { toast(e.message); }
  }
  toast('첨부했어요');
  if (route.sub === f.id && !route.sub2) drawBuilder(f);
}

function bindBuilder(f) {
  const col = $('.sv-col');
  col.addEventListener('change', e => {
    const inp = e.target.closest('[data-attach]');
    if (inp && inp.files.length) { attachFiles(f, inp.dataset.attach, inp.files); inp.value = ''; }
  });
  const q = el => f.questions[+el.closest('[data-q]').dataset.q];
  const structural = fn => { if (!okToRestructure(f)) return drawBuilder(f); fn(); commit(f, { draw: true }); };
  $('#svTitle').oninput = e => { f.title = e.target.value; commit(f); };
  $('#svDesc').oninput = e => { f.desc = e.target.value; commit(f); };
  $('#svDue').onchange = e => { f.due = e.target.value; commit(f); };
  if ($('#svAnon')) $('#svAnon').onchange = e => { f.settings = { ...f.settings, anon: e.target.checked }; commit(f); };
  if ($('#svReveal')) $('#svReveal').onchange = e => { f.settings = { ...f.settings, reveal: e.target.value }; commit(f); };
  col.oninput = e => {
    const t = e.target;
    if (t.matches('[data-title]')) { q(t).title = t.value; commit(f); }
    else if (t.matches('[data-opt]')) { q(t).options[+t.dataset.opt] = t.value; commit(f); }
    else if (t.matches('[data-keys]')) { q(t).answer = t.value.split(',').map(s => s.trim()).filter(Boolean); commit(f); }
    else if (t.matches('[data-pts]')) { q(t).points = Math.max(0, +t.value || 0); commit(f); }
    else if (t.matches('[data-lo]')) { q(t).lo = t.value; commit(f); }
    else if (t.matches('[data-hi]')) { q(t).hi = t.value; commit(f); }
  };
  col.onchange = e => {
    const t = e.target;
    if (t.matches('[data-type]')) structural(() => { const x = q(t); x.type = t.value; if ((x.type === 'mc' || x.type === 'cb') && !(x.options || []).length) x.options = ['선택지 1', '선택지 2']; delete x.answer; });
    else if (t.matches('[data-req]')) { q(t).required = t.checked; commit(f); }
  };
  col.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.unattach) {
      const [key, i] = b.dataset.unattach.split(':');
      const list = key === 't' ? f.settings.attach : f.questions[+key.slice(1)].attach;
      list.splice(+i, 1);
      return commit(f, { draw: true });
    }
    if (b.id === 'svAddQ') return structural(() => f.questions.push({ id: qid(), type: 'mc', title: '', required: true, options: ['선택지 1', '선택지 2'], points: 1 }));
    if (b.dataset.reply) {
      const mode = b.dataset.reply;
      return structural(() => { f.settings = { ...f.settings, reply: mode }; f.questions[0].options = mode === 'custom' ? (f.questions[0].options || []).slice() : REPLY[mode].slice(); });
    }
    const card = b.closest('[data-q]');
    if (!card) return;
    const k = +card.dataset.q, x = f.questions[k];
    if (b.dataset.addopt !== undefined) structural(() => x.options.push(`선택지 ${x.options.length + 1}`));
    else if (b.dataset.delopt !== undefined) {
      if (x.options.length <= 1) return toast('선택지는 하나 이상 있어야 해요');
      const i = +b.dataset.delopt;
      structural(() => {
        x.options.splice(i, 1);
        if (x.type === 'mc' && x.answer !== undefined) x.answer = +x.answer === i ? undefined : +x.answer > i ? +x.answer - 1 : +x.answer;
        if (x.type === 'cb' && x.answer) x.answer = x.answer.filter(a => a !== i).map(a => (a > i ? a - 1 : a));
      });
    } else if (b.dataset.key !== undefined) {
      const i = +b.dataset.key;
      if (x.type === 'mc') x.answer = +x.answer === i && x.answer !== undefined ? undefined : i;
      else { const s = new Set(x.answer || []); s.has(i) ? s.delete(i) : s.add(i); x.answer = [...s].sort(); }
      commit(f, { draw: true });
    } else if (b.dataset.move) {
      const to = k + +b.dataset.move;
      if (to < 0 || to >= f.questions.length) return;
      structural(() => { [f.questions[k], f.questions[to]] = [f.questions[to], f.questions[k]]; });
    } else if (b.dataset.dup !== undefined) structural(() => f.questions.splice(k + 1, 0, { ...JSON.parse(JSON.stringify(x)), id: qid() }));
    else if (b.dataset.delq !== undefined) {
      if (f.questions.length <= 1) return toast('문항은 하나 이상 있어야 해요');
      structural(() => f.questions.splice(k, 1));
    }
  };
  $('#svTarget').onclick = () => openTargets(f);
  $('#svDel').onclick = () => {
    if (!confirm(`"${f.title}"을(를) 지울까요?${f.responses ? ' 받은 응답도 함께 지워져요.' : ''}`)) return;
    F.list = F.list.filter(x => x.id !== f.id);
    saveList();
    clearTimeout(timers[f.id]);
    quiet('formDel', { id: f.id }).catch(() => {});
    go('');
  };
  if ($('#svSend')) $('#svSend').onclick = () => setStatus(f, 'live');
  // Plays this quiz live (수업 도구 → 함께 푸는 퀴즈), which reads it from the server: save the latest edits first.
  if ($('#svLive')) $('#svLive').onclick = async () => {
    const playable = f.questions.filter(q => q.type === 'mc' && (q.options || []).length >= 2 && q.answer !== undefined && q.answer !== null && q.answer !== '');
    if (!playable.length) return toast('정답을 표시한 객관식 문항이 있어야 함께 풀 수 있어요');
    const b = $('#svLive');
    b.disabled = true;
    b.innerHTML = `${fa('floppy-disk')}저장 중…`;
    if (F.sync[f.id] || f.local) await pushForm(f.id);
    if (F.sync[f.id] === 'fail') {
      b.disabled = false;
      b.innerHTML = `${fa('chalkboard-user')}수업에서 함께 풀기`;
      return toast('아직 저장하지 못했어요. 인터넷을 확인하고 다시 눌러 주세요');
    }
    lsSet('quizPick:' + F.cls, f.id);
    location.hash = `#/t/${F.cls}/tools/quiz`;
  };
  if ($('#svClose')) $('#svClose').onclick = () => { if (confirm('지금 마감할까요? 더 이상 답을 받지 않아요.')) setStatus(f, 'closed'); };
  if ($('#svReopen')) $('#svReopen').onclick = () => { if (f.due && nowKst() > f.due) return toast('마감 시간을 먼저 뒤로 바꿔 주세요'); setStatus(f, 'live'); };
}

// Sending/closing shows at once; the server call (which also pushes notifications) runs behind.
async function setStatus(f, status) {
  if (status === 'live' && f.kind !== 'reply' && f.questions.some(x => !String(x.title).trim())) return toast('제목이 빈 문항이 있어요');
  if (status === 'live' && f.kind === 'quiz' && f.questions.some(x => (x.type === 'mc' && (x.answer === undefined || x.answer === null)) || (x.type === 'cb' && !(x.answer || []).length) || (x.type === 'short' && !(x.answer || []).length))) {
    if (!confirm('정답을 표시하지 않은 문항이 있어요. 그 문항은 0점이 돼요. 보낼까요?')) return;
  }
  const prev = f.status;
  f.status = status;
  commit(f, { draw: true });
  if (status === 'live' && prev === 'draft') toast('학생에게 보냈어요. 알림이 함께 가요');
  try {
    await pushForm(f.id);
    await quiet(status === 'live' ? 'formSend' : 'formClose', { id: f.id });
  } catch (e) {
    f.status = prev;
    commit(f, { draw: true });
    toast(`바꾸지 못했어요. ${e.message}`);
  }
}

function openTargets(f) {
  const roster = (ctx.v.roster || []).slice().sort((a, b) => a.number - b.number);
  const chosen = new Set(f.studentIds ? String(f.studentIds).split(',') : []);
  let all = !f.studentIds;
  const d = $('#svDlg');
  const draw = () => {
    d.innerHTML = `<form method="dialog" class="sv-form"><h3>${fa('users')} 대상</h3>
      <div class="seg2"><button type="button" data-all="1" class="${all ? 'on' : ''}">클래스 전체 (${roster.length}명)</button><button type="button" data-all="0" class="${all ? '' : 'on'}">일부 학생</button></div>
      ${all ? '' : `<div class="sv-people">${roster.map(s => `<button type="button" data-id="${s.id}" class="${chosen.has(s.id) ? 'on' : ''}">${s.number} ${esc(s.name)}</button>`).join('')}</div>`}
      <div class="acts"><button type="button" class="btn" data-x>취소</button><button type="button" class="btn primary" data-ok>저장</button></div></form>`;
  };
  draw();
  d.showModal();
  d.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.all) { all = b.dataset.all === '1'; draw(); }
    else if (b.dataset.id) { chosen.has(b.dataset.id) ? chosen.delete(b.dataset.id) : chosen.add(b.dataset.id); b.classList.toggle('on'); }
    else if (b.dataset.x !== undefined) d.close();
    else if (b.dataset.ok !== undefined) {
      if (!all && !chosen.size) return toast('학생을 한 명 이상 골라 주세요');
      f.studentIds = all ? '' : [...chosen].join(',');
      d.close();
      commit(f, { draw: true });
    }
  };
}

// ---------- responses ----------

let respTab = 'sum';
let respAt = 0;

async function drawResponses(f) {
  const id = f.id;
  const cached = F.resp[id] || lsGet('fresp:' + id);
  paintResponses(f, cached);
  try {
    const rs = await quiet('responses', { formId: id });
    F.resp[id] = rs;
    lsSet('fresp:' + id, rs);
    f.responses = rs.length;
    saveList();
    if (route.sub === id && route.sub2 === 'a' && JSON.stringify(rs) !== JSON.stringify(cached) && !document.activeElement?.matches('.sv-grade input')) paintResponses(f, rs);
  } catch (e) { if (!cached) toast(e.message); }
}

const ansText = (q, v) => {
  if (v === undefined || v === null || v === '') return '';
  if (q.type === 'mc') return (q.options || [])[+v] ?? '';
  if (q.type === 'cb') return (Array.isArray(v) ? v : []).map(i => (q.options || [])[+i]).filter(Boolean).join(', ');
  return String(v);
};

function paintResponses(f, rs) {
  const roster = (ctx.v.roster || []).slice().sort((a, b) => a.number - b.number);
  const anon = f.kind === 'survey' && f.settings.anon;
  const who = Object.fromEntries(roster.map(s => [s.id, s]));
  const list = rs || [];
  const miss = anon ? [] : missing(f, roster, list);
  const tot = f.studentIds ? String(f.studentIds).split(',').length : roster.length;
  let body;
  if (!rs) body = '<p class="sv-hint">응답을 불러오는 중…</p>';
  else if (!list.length) body = `<div class="sv-empty">${fa('inbox')}<p>아직 낸 학생이 없어요.</p></div>`;
  else if (respTab === 'sum' || anon) body = summaryHtml(f, list);
  else body = personHtml(f, list, who);
  paint(`${header(f, 'a')}
    <div class="sv-rtop"><div class="sv-big"><b>${list.length}</b><small>/ ${tot}명 냄</small></div>
      ${f.kind === 'quiz' && list.length ? `<div class="sv-big"><b>${summarize(f, list).quiz.avg}</b><small>평균 / ${summarize(f, list).quiz.max}점</small></div>` : ''}
      <div class="sv-miss">${anon ? `${fa('user-secret')} 익명 설문 · 아직 안 낸 학생 ${Math.max(0, tot - list.length)}명 (이름은 볼 수 없어요)` : miss.length ? `안 낸 학생 <b>${miss.length}명</b>: ${esc(miss.slice(0, 8).map(s => s.name).join(', '))}${miss.length > 8 ? ' 외' : ''}` : '모두 냈어요 🎉'}</div>
      ${f.status !== 'draft' && !isOver(f) && (anon ? tot > list.length : miss.length) ? `<button type="button" class="btn" id="svNudge">${fa('bell')}안 낸 학생에게 알림</button>` : ''}
      ${anon ? '' : `<div class="seg2 sv-rtabs"><button type="button" data-rt="sum" class="${respTab === 'sum' ? 'on' : ''}">요약</button><button type="button" data-rt="who" class="${respTab === 'who' ? 'on' : ''}">학생별</button></div>`}
      <button type="button" class="btn" id="svCsv" ${list.length ? '' : 'disabled'}>${fa('download')}CSV</button></div>
    <section class="sv-resp">${body}</section>`);
  if ($('.sv-rtabs')) $('.sv-rtabs').onclick = e => { const b = e.target.closest('[data-rt]'); if (b) { respTab = b.dataset.rt; paintResponses(f, rs); } };
  if ($('#svNudge')) $('#svNudge').onclick = async () => { try { const n = await call('formNudge', { id: f.id }); toast(`${n}명에게 알림을 보냈어요`); } catch (e) { toast(e.message); } };
  $('#svCsv').onclick = () => downloadCsv(f, list, who, anon);
  if (respTab === 'who' && !anon && list.length) bindPerson(f, list);
}

function summaryHtml(f, list) {
  const s = summarize(f, list);
  const pct = (n, d) => (d ? Math.round(n / d * 100) : 0);
  const quiz = s.quiz ? `<article class="sv-stat wide"><h4>문항별 정답률</h4>${f.questions.filter(q => q.type !== 'scale').map((q, i) => {
    const r = s.quiz.rate[q.id];
    return `<div class="sv-rate"><span>Q${i + 1}</span><span class="sv-t"><i class="${r !== null && r < .5 ? 'low' : ''}" style="width:${r === null ? 0 : r * 100}%"></i></span><em class="${r !== null && r < .5 ? 'low' : ''}">${r === null ? '채점 대기' : Math.round(r * 100) + '%'}</em></div>`;
  }).join('')}</article>` : '';
  return quiz + s.items.map((it, i) => {
    const head = `<h4>${i + 1}. ${esc(it.q.title || '(제목 없음)')}</h4><div class="sv-meta">응답 ${it.answered}${it.q.type === 'cb' ? ' · 여러 개 선택' : ''}${it.kind === 'scale' ? ` · 평균 ${it.avg}` : ''}</div>`;
    if (it.kind === 'bars') {
      const key = f.kind === 'quiz' ? (it.q.type === 'mc' ? [+it.q.answer] : it.q.answer || []) : [];
      return `<article class="sv-stat">${head}${(it.q.options || []).map((o, k) => `<div class="sv-hb"><span>${key.includes(k) ? fa('check') + ' ' : ''}${esc(o)}</span><span class="sv-t"><i style="width:${pct(it.counts[k], s.n)}%"></i></span><em>${it.counts[k]} · ${pct(it.counts[k], s.n)}%</em></div>`).join('')}</article>`;
    }
    if (it.kind === 'scale') {
      const top = Math.max(1, ...it.counts);
      return `<article class="sv-stat">${head}<div class="sv-cols">${it.counts.map((n, k) => `<div><i style="height:${n / top * 70 + 2}px"></i>${k + 1}<br>${n}명</div>`).join('')}</div>${it.q.lo || it.q.hi ? `<div class="sv-meta">1 ${esc(it.q.lo || '')} · 5 ${esc(it.q.hi || '')}</div>` : ''}</article>`;
    }
    return `<article class="sv-stat ${it.q.type === 'long' ? 'wide' : ''}">${head}${it.groups.slice(0, 30).map(g => `<div class="sv-ans">${esc(g.text)}${g.n > 1 ? `<em>${g.n}명</em>` : ''}</div>`).join('') || '<p class="sv-hint">답이 없어요</p>'}${it.groups.length > 30 ? `<p class="sv-hint">외 ${it.groups.length - 30}개 · CSV에서 모두 볼 수 있어요</p>` : ''}</article>`;
  }).join('');
}

function personHtml(f, list, who) {
  const sorted = list.slice().sort((a, b) => ((who[a.studentId] || {}).number || 999) - ((who[b.studentId] || {}).number || 999));
  respAt = Math.min(respAt, sorted.length - 1);
  const r = sorted[respAt];
  const s = who[r.studentId] || { name: '(명단에 없음)', number: '' };
  const cards = f.questions.map((q, i) => {
    const v = r.answers[q.id];
    const per = r.per && r.per[q.id];
    const mark = per ? (per.ok === true ? `<span class="sv-ok">${fa('check')} ${per.got}/${per.max}</span>` : per.ok === false ? `<span class="sv-no">${fa('xmark')} ${per.got}/${per.max}</span>` : '<span class="sv-wait">채점 대기</span>') : '';
    const grading = f.kind === 'quiz' && q.type === 'long' ? `<div class="sv-grade">점수 <input type="number" min="0" max="${+q.points || 1}" data-grade="${q.id}" value="${r.manual && r.manual[q.id] !== undefined ? r.manual[q.id] : ''}"> / ${+q.points || 1}<button type="button" class="btn primary" data-save>저장</button></div>` : '';
    return `<article class="sv-stat wide"><h4>${i + 1}. ${esc(q.title)} ${mark}</h4><div class="sv-ans">${esc(ansText(q, v)) || '<span class="sv-hint">(답 없음)</span>'}</div>${grading}</article>`;
  }).join('');
  return `<div class="sv-who"><nav class="sv-wl">${sorted.map((x, k) => {
    const st = who[x.studentId] || { name: '?' };
    const sc = f.kind === 'quiz' ? (x.pending ? '<em class="w">채점 대기</em>' : `<em>${x.score}</em>`) : '';
    return `<button type="button" data-at="${k}" class="${k === respAt ? 'on' : ''}">${esc(st.name)}${sc}</button>`;
  }).join('')}</nav>
    <div class="sv-wd"><div class="sv-wh"><b>${s.number ? s.number + '번 ' : ''}${esc(s.name)}</b><small>${new Date(r.submitted).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 제출${f.kind === 'quiz' ? ` · ${r.score}/${r.max}점` : ''}</small>
      <span class="sp"></span><button type="button" class="btn" data-step="-1">${fa('chevron-left')} 이전</button><button type="button" class="btn" data-step="1">다음 ${fa('chevron-right')}</button></div>${cards}</div></div>`;
}

function bindPerson(f, list) {
  $('.sv-who').onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.at) { respAt = +b.dataset.at; return paintResponses(f, list); }
    if (b.dataset.step) { respAt = Math.max(0, Math.min(list.length - 1, respAt + +b.dataset.step)); return paintResponses(f, list); }
    if (b.dataset.save !== undefined) {
      const who = Object.fromEntries((ctx.v.roster || []).map(s => [s.id, s]));
      const sorted = list.slice().sort((a, c) => ((who[a.studentId] || {}).number || 999) - ((who[c.studentId] || {}).number || 999));
      const r = sorted[respAt];
      const manual = {};
      document.querySelectorAll('[data-grade]').forEach(i => { if (i.value !== '') manual[i.dataset.grade] = +i.value; });
      Object.assign(r, { manual: { ...r.manual, ...manual } }); // show at once
      b.disabled = true;
      try {
        const g = await call('grade', { responseId: r.id, manual });
        Object.assign(r, g);
        lsSet('fresp:' + f.id, list);
        toast('채점을 저장했어요');
        paintResponses(f, list);
      } catch (err) { b.disabled = false; toast(err.message); }
    }
  };
}

function downloadCsv(f, list, who, anon) {
  const q = v => `"${String(v ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const head = [anon ? '응답' : '번호', anon ? '' : '이름', ...f.questions.map((x, i) => `${i + 1}. ${x.title}`), ...(f.kind === 'quiz' ? ['점수', '만점'] : []), '제출 시각'];
  const rows = list.map((r, k) => {
    const s = who[r.studentId] || {};
    return [anon ? k + 1 : s.number ?? '', anon ? '' : s.name ?? '', ...f.questions.map(x => ansText(x, r.answers[x.id])), ...(f.kind === 'quiz' ? [r.score, r.max] : []), r.submitted];
  });
  const csv = '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${ctx.cls.name}_${f.title}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
