// Homeroom seat chart. Everything runs on the device; the working copy is saved locally at once and
// sent to the server 2 s after the last change, so no tap ever waits for Apps Script.
import { quiet } from './api.js';
import { render, $, toast } from './ui.js';
import { esc } from './lib.js';
import { fa } from './fa.js';
import { blankLayout, toggleDesk, resize, unplaced, arrange } from './seatlogic.js';
import { showSeats } from './seatshow.js';

const SYNC_MS = 2000;
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => { const d = new Date(); return `${d.getMonth() + 1}월 ${d.getDate()}일 배치`; };
const stamp = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

let S = null; // { classId, L, step, view, saved, sync: ''|'wait'|'fail', fetched }
let ctx = null;
let syncTimer = null;

// ---------- state & sync ----------

function load(cls) {
  const L = lsGet('seat:' + cls.id);
  S = {
    classId: cls.id,
    L: L || blankLayout(5, 6),
    step: L && Object.keys(L.assign || {}).length ? 'place' : 'build',
    view: lsGet('seatView') || 'student',
    saved: lsGet('seats:' + cls.id) || [],
    sync: lsGet('seatq:' + cls.id) ? 'wait' : '',
    fetched: false,
  };
}

function commit(next, redraw = true) {
  S.L = { ...next, updated: new Date().toISOString() };
  lsSet('seat:' + S.classId, S.L);
  lsSet('seatq:' + S.classId, 1);
  S.sync = 'wait';
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushWorking, SYNC_MS);
  if (redraw) paint(); else paintSync();
}

async function pushWorking() {
  const L = S.L, id = S.classId;
  try {
    await quiet('seatPut', { classId: id, id: 'cur:' + id, name: '', layout: JSON.stringify(L), updated: L.updated });
    if (S.classId === id && S.L === L) { S.sync = ''; lsSet('seatq:' + id, null); }
  } catch {
    if (S.classId === id) S.sync = 'fail';
  }
  paintSync();
}

const saveSaved = () => lsSet('seats:' + S.classId, S.saved);

async function pushSnap(snap) {
  try {
    await quiet('seatPut', { classId: S.classId, id: snap.id, name: snap.name, layout: JSON.stringify(snap.layout), updated: snap.updated });
    snap.local = false;
    saveSaved();
  } catch { /* stays local; retried next time the screen opens */ }
}

// Server copy: newer working layout wins; saved layouts are merged by id.
async function fetchServer() {
  const id = S.classId;
  let rows;
  try { rows = await quiet('seats', { classId: id }); } catch { return; }
  if (!S || S.classId !== id) return;
  const cur = rows.find(r => r.id === 'cur:' + id);
  let changed = false;
  if (cur && (!S.L.updated || cur.updated > S.L.updated)) {
    try { S.L = JSON.parse(cur.layout); lsSet('seat:' + id, S.L); changed = true; } catch {}
  } else if (lsGet('seatq:' + id)) pushWorking();
  const server = rows.filter(r => r.id !== 'cur:' + id).map(r => { try { return { id: r.id, name: r.name, layout: JSON.parse(r.layout), updated: r.updated }; } catch { return null; } }).filter(Boolean);
  const local = S.saved.filter(s => s.local && !server.some(r => r.id === s.id));
  local.forEach(pushSnap);
  const merged = [...server, ...local].sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  if (JSON.stringify(merged.map(s => s.id)) !== JSON.stringify(S.saved.map(s => s.id))) changed = true;
  S.saved = merged;
  saveSaved();
  if (changed && !document.querySelector('dialog[open], .seat-show, .seat-paper')) paint();
}

// ---------- drawing ----------

const names = () => Object.fromEntries((ctx.v.roster || []).map(s => [s.id, s]));
const studentIds = () => (ctx.v.roster || []).slice().sort((a, b) => a.number - b.number).map(s => s.id);

// Grid HTML shared by the screen, the print page and the reveal. Teacher view turns the room 180°.
export function gridHtml(L, { view = 'student', mode = 'place', who = {}, show = false } = {}) {
  const rows = [...Array(L.rows).keys()], cols = [...Array(L.cols).keys()];
  if (view === 'teacher') { rows.reverse(); cols.reverse(); }
  const aisle = (a, b) => L.pairs && Math.min(a, b) % 2 === 1;
  const tmpl = cols.map((c, k) => (k && aisle(cols[k - 1], c) ? 'var(--seat-aisle) ' : '') + 'var(--seat-w)').join(' ');
  const fixed = new Set(L.fixed);
  let h = '';
  rows.forEach(r => cols.forEach((c, k) => {
    if (k && aisle(cols[k - 1], c)) h += '<i class="seat-gap"></i>';
    const i = r * L.cols + c;
    if (mode === 'build') { h += `<button type="button" class="seat-cell ${L.desks[i] ? 'on' : 'off'}" data-i="${i}" aria-label="${r + 1}행 ${c + 1}열 ${L.desks[i] ? '책상' : '빈칸'}"></button>`; return; }
    if (!L.desks[i]) { h += '<i class="seat-cell none"></i>'; return; }
    const sid = L.assign[i];
    const s = sid && who[sid];
    if (!s) { h += `<div class="seat-cell empty" data-i="${i}">${show ? '' : '빈자리'}</div>`; return; }
    h += `<div class="seat-cell stu ${fixed.has(i) ? 'fixed' : ''}" data-i="${i}">${show ? '' : `<small>${s.number}</small>`}<b>${show ? '' : esc(s.name)}</b>${fixed.has(i) ? `<span class="seat-pin">${fa('thumbtack')}</span>` : ''}</div>`;
  }));
  return `<div class="seat-grid" style="grid-template-columns:${tmpl}">${h}</div>`;
}

const roomHtml = (L, opts) => `<div class="seat-room ${opts.view}">
  <div class="seat-desk">교탁</div>${gridHtml(L, opts)}</div>`;

function toolbar() {
  const L = S.L, b = S.step === 'build';
  const stepper = (k, v) => `<span class="seat-step"><button type="button" data-dim="${k}" data-d="-1" aria-label="${k === 'rows' ? '행' : '열'} 줄이기">−</button><b>${v}</b><button type="button" data-dim="${k}" data-d="1" aria-label="${k === 'rows' ? '행' : '열'} 늘리기">＋</button></span>`;
  return `<div class="seat-tools">
    <div class="seat-steps"><button type="button" data-step="build" class="${b ? 'on' : ''}"><em>1</em>좌석 구성</button>${fa('chevron-right')}<button type="button" data-step="place" class="${b ? '' : 'on'}"><em>2</em>자리 배치</button></div>
    <div class="seg2 seat-view"><button type="button" data-view="student" class="${S.view === 'student' ? 'on' : ''}">${fa('user-graduate')} 학생 보기</button><button type="button" data-view="teacher" class="${S.view === 'teacher' ? 'on' : ''}">${fa('chalkboard-user')} 교사 보기</button></div>
    ${b ? `<span class="seat-dims">행 ${stepper('rows', L.rows)} 열 ${stepper('cols', L.cols)}</span>
      <button type="button" class="btn ${L.pairs ? 'on' : ''}" id="seatPairs">${fa('table-columns')}두 자리씩 붙이기</button>
      <button type="button" class="btn" id="seatAll">${fa('border-all')}모두 책상</button><button type="button" class="btn" id="seatNone">${fa('eraser')}모두 비우기</button>
      <span class="sp"></span><span id="seatSync"></span><button type="button" class="btn primary" id="seatDone">구성 끝 · 자리 배치로 ${fa('arrow-right')}</button>`
    : `<span class="sp"></span><span id="seatSync"></span><button type="button" class="btn" id="seatLoad">${fa('folder-open')}불러오기${S.saved.length ? ` <small>${S.saved.length}</small>` : ''}</button>`}
  </div>`;
}

function panel() {
  const L = S.L, who = names(), ids = studentIds();
  const desks = L.desks.filter(Boolean).length;
  if (S.step === 'build') {
    const left = desks - ids.length;
    return `<aside class="seat-panel">
      <div class="seat-stat"><div><b>${desks}</b><small>책상</small></div><div><b>${ids.length}</b><small>학생</small></div><div><b class="${left < 0 ? 'w' : 'a'}">${left > 0 ? '+' : ''}${left}</b><small>남는 자리</small></div></div>
      <p class="seat-hint"><b>1단계 좌석 구성</b> · 칸을 누르면 책상 ↔ 빈칸으로 바뀌어요. 교실 책상 모양만 만들고, 학생은 2단계에서 앉혀요.</p>
      ${left < 0 ? `<p class="seat-warn">${fa('circle-exclamation')} 책상이 ${-left}개 모자라요.</p>` : ''}
      <p class="seat-hint">학생이 앉은 뒤 구성을 바꾸면 없앤 책상의 학생만 "자리 없는 학생"으로 돌아가요.</p>
    </aside>`;
  }
  const out = unplaced(L, ids);
  return `<aside class="seat-panel">
    <div class="seat-stat"><div><b>${desks}</b><small>책상</small></div><div><b>${ids.length}</b><small>학생</small></div><div><b class="y">${L.fixed.length}</b><small>고정</small></div></div>
    <div class="seat-ph">자리 없는 학생 <span>${out.length ? `${out.length}명 · 끌어다 놓기` : ''}</span></div>
    <div class="seat-pool" data-pool>${out.map(s => `<span class="seat-chip" data-sid="${esc(s)}">${esc(who[s].name)}</span>`).join('') || '<span class="seat-none">모두 앉았어요</span>'}</div>
    <div class="seat-ph">떨어뜨릴 학생 <span>무작위할 때 붙지 않게</span></div>
    <div class="seat-pairs">${(L.apart || []).map(([a, b], k) => who[a] && who[b] ? `<div class="seat-pair">${esc(who[a].name)} ${fa('arrows-left-right')} ${esc(who[b].name)}<button type="button" data-unpair="${k}" aria-label="쌍 지우기">${fa('xmark')}</button></div>` : '').join('')}
      <button type="button" class="seat-add" id="seatPair">${fa('plus')} 쌍 추가</button></div>
    <p class="seat-hint">학생 화면(무작위 공개)에는 보이지 않아요. 자리를 누르면 고정할 수 있어요.</p>
  </aside>`;
}

function paintSync() {
  const el = document.getElementById('seatSync');
  if (!el) return;
  el.className = 'seat-sync ' + S.sync;
  el.innerHTML = S.sync === 'fail' ? `${fa('circle-exclamation')} 저장 대기 · 연결되면 보내요` : S.sync === 'wait' ? '저장 중…' : '';
}

function paint() {
  const L = S.L, who = names();
  const body = `<section class="seat-body">
      <div class="seat-wrap ${S.step === 'build' ? 'build' : ''}" id="seatWrap">${roomHtml(L, { view: S.view, mode: S.step, who })}</div>
      ${panel()}
    </section>
    <dialog class="sheet" id="seatDlg"></dialog>`;
  const actions = S.step === 'place'
    ? `<button class="btn" id="seatPrint">${fa('print')}인쇄</button><button class="btn" id="seatSave">${fa('floppy-disk')}저장</button><button class="btn primary" id="seatShuffle">${fa('shuffle')}무작위 배치</button>`
    : '';
  render(ctx.frame(toolbar() + body, actions));
  ctx.after();
  paintSync();
  fitGrid();
  bind();
}

// Cells shrink to fit the room on small screens and grow up to a comfortable size on big ones.
function fitGrid(wrap = document.getElementById('seatWrap'), max = { w: 128, h: 66 }) {
  if (!wrap) return;
  const L = S.L;
  const aisles = L.pairs ? Math.floor((L.cols - 1) / 2) : 0;
  const W = wrap.clientWidth - 40, H = wrap.clientHeight - 90;
  const narrow = W < 520;
  const gap = narrow ? 5 : 10, aisle = narrow ? 8 : 16;
  const w = Math.max(34, Math.min(max.w, (W - gap * (L.cols - 1 + aisles) - aisle * aisles) / L.cols));
  const h = Math.max(40, Math.min(max.h, (H - gap * (L.rows - 1)) / L.rows));
  wrap.style.setProperty('--seat-w', w + 'px');
  wrap.style.setProperty('--seat-h', h + 'px');
  wrap.style.setProperty('--seat-aisle', aisle + 'px');
  wrap.style.setProperty('--seat-gap', gap + 'px');
}
addEventListener('resize', () => { if (document.getElementById('seatWrap')) fitGrid(); });

// ---------- interaction ----------

function bind() {
  const wrap = $('#seatWrap');
  $('.seat-steps').onclick = e => {
    const b = e.target.closest('[data-step]');
    if (!b || b.dataset.step === S.step) return;
    S.step = b.dataset.step;
    paint();
  };
  $('.seat-view').onclick = e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    S.view = b.dataset.view;
    lsSet('seatView', S.view);
    paint();
  };
  if (S.step === 'build') {
    $('.seat-dims').onclick = e => {
      const b = e.target.closest('[data-dim]');
      if (!b) return;
      const L = S.L, d = +b.dataset.d;
      const rows = b.dataset.dim === 'rows' ? Math.min(8, Math.max(2, L.rows + d)) : L.rows;
      const cols = b.dataset.dim === 'cols' ? Math.min(8, Math.max(2, L.cols + d)) : L.cols;
      if (rows !== L.rows || cols !== L.cols) commit(resize(L, rows, cols));
    };
    $('#seatPairs').onclick = () => commit({ ...S.L, pairs: !S.L.pairs });
    $('#seatAll').onclick = () => commit({ ...S.L, desks: S.L.desks.map(() => true) });
    $('#seatNone').onclick = () => commit({ ...S.L, desks: S.L.desks.map(() => false), assign: {}, fixed: [] });
    $('#seatDone').onclick = () => { S.step = 'place'; paint(); };
    wrap.onclick = e => { const c = e.target.closest('.seat-cell[data-i]'); if (c) commit(toggleDesk(S.L, +c.dataset.i)); };
    return;
  }
  $('#seatLoad').onclick = openLoad;
  $('#seatSave').onclick = openSave;
  $('#seatPrint').onclick = openPrint;
  $('#seatShuffle').onclick = openShuffle;
  $('#seatPair').onclick = openPair;
  $('.seat-pairs').onclick = e => {
    const b = e.target.closest('[data-unpair]');
    if (b) commit({ ...S.L, apart: S.L.apart.filter((_, k) => k !== +b.dataset.unpair) });
  };
  bindDrag();
}

// Pins belong to students: after any move the pin follows its student.
function withPins(L, assign) {
  const pinned = new Set(L.fixed.map(i => L.assign[i]).filter(Boolean));
  const fixed = Object.entries(assign).filter(([, s]) => pinned.has(s)).map(([i]) => +i);
  return { ...L, assign, fixed };
}

function bindDrag() {
  const body = $('.seat-body');
  let drag = null;
  body.onpointerdown = e => {
    const seat = e.target.closest('.seat-cell.stu');
    const chip = e.target.closest('.seat-chip');
    if ((!seat && !chip) || e.button > 0) return;
    drag = { x: e.clientX, y: e.clientY, seat: seat && +seat.dataset.i, sid: chip && chip.dataset.sid, el: seat || chip, moved: false };
    body.setPointerCapture(e.pointerId);
  };
  body.onpointermove = e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      closeMenu();
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'seat-ghost';
      drag.ghost.textContent = drag.el.querySelector('b') ? drag.el.querySelector('b').textContent : drag.el.textContent;
      document.body.append(drag.ghost);
      drag.el.classList.add('dragging');
    }
    drag.ghost.style.transform = `translate(${e.clientX - 50}px, ${e.clientY - 22}px)`;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const over = t && (t.closest('.seat-cell.stu, .seat-cell.empty') || t.closest('[data-pool]'));
    if (drag.over !== over) { if (drag.over) drag.over.classList.remove('over'); drag.over = over; if (over) over.classList.add('over'); }
  };
  const end = e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.moved) { if (d.seat != null) openMenu(d.seat, d.el); return; }
    const L = S.L, assign = { ...L.assign };
    const over = d.over;
    if (!over) return paint();
    if (over.matches('[data-pool]')) {
      if (d.seat == null) return paint();
      delete assign[d.seat];
      return commit({ ...withPins(L, assign), fixed: L.fixed.filter(i => i !== d.seat && assign[i]) });
    }
    const to = +over.dataset.i;
    if (d.seat != null) {
      const a = assign[d.seat], b = assign[to];
      if (b) assign[d.seat] = b; else delete assign[d.seat];
      assign[to] = a;
    } else {
      Object.keys(assign).forEach(i => { if (assign[i] === d.sid) delete assign[i]; });
      assign[to] = d.sid; // whoever sat there goes back to the pool
    }
    commit(withPins(L, assign));
  };
  body.onpointerup = end;
  body.onpointercancel = () => { if (drag && drag.ghost) drag.ghost.remove(); drag = null; paint(); };
}

function closeMenu() { document.querySelectorAll('.seat-menu').forEach(m => m.remove()); }

function openMenu(i, el) {
  closeMenu();
  const L = S.L, s = names()[L.assign[i]];
  const pinned = L.fixed.includes(i);
  const r = Math.floor(i / L.cols) + 1, c = (i % L.cols) + 1;
  const m = document.createElement('div');
  m.className = 'seat-menu';
  m.innerHTML = `<div class="hd">${esc(s ? s.name : '')} · ${r}줄 ${c}번째</div>
    <button type="button" data-act="pin">${fa('thumbtack')}${pinned ? '고정 해제' : '이 자리에 고정'}</button>
    <button type="button" data-act="clear">${fa('eraser')}자리 비우기</button>`;
  document.body.append(m);
  const b = el.getBoundingClientRect();
  m.style.left = Math.min(innerWidth - 190, b.left) + 'px';
  m.style.top = Math.min(innerHeight - 120, b.bottom + 6) + 'px';
  m.onclick = e => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    closeMenu();
    if (a.dataset.act === 'pin') commit({ ...L, fixed: pinned ? L.fixed.filter(x => x !== i) : [...L.fixed, i] });
    else { const assign = { ...L.assign }; delete assign[i]; commit({ ...L, assign, fixed: L.fixed.filter(x => x !== i) }); }
  };
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off); } }), 0);
}

// ---------- dialogs ----------

function dlg(html) {
  const d = $('#seatDlg');
  d.innerHTML = html;
  d.showModal();
  d.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => d.close(); });
  return d;
}

function openPair() {
  const opts = (ctx.v.roster || []).slice().sort((a, b) => a.number - b.number).map(s => `<option value="${esc(s.id)}">${s.number}. ${esc(s.name)}</option>`).join('');
  const d = dlg(`<form method="dialog" class="seat-form"><h3>${fa('arrows-left-right')} 떨어뜨릴 학생</h3>
    <p class="muted small">이 두 학생은 무작위 배치할 때 앞·뒤·옆으로 붙지 않아요.</p>
    <div class="row2"><label>학생 1<select name="a">${opts}</select></label><label>학생 2<select name="b">${opts}</select></label></div>
    <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary">추가</button></div></form>`);
  const f = d.querySelector('form');
  f.b.selectedIndex = Math.min(1, f.b.options.length - 1);
  f.onsubmit = e => {
    e.preventDefault();
    const a = f.a.value, b = f.b.value;
    if (a === b) return toast('서로 다른 두 학생을 골라 주세요');
    if ((S.L.apart || []).some(p => p.includes(a) && p.includes(b))) return toast('이미 있는 쌍이에요');
    d.close();
    commit({ ...S.L, apart: [...(S.L.apart || []), [a, b]] });
  };
}

function openSave() {
  const d = dlg(`<form class="seat-form"><h3>${fa('floppy-disk')} 배치 저장</h3>
    <label>이름<input name="name" value="${esc(today())}" required maxlength="40"></label>
    <p class="muted small">좌석 구성, 학생 자리, 고정석, 떨어뜨릴 학생, 인쇄 문구가 함께 저장돼요.</p>
    <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary">저장</button></div></form>`);
  const f = d.querySelector('form');
  f.name.select();
  f.onsubmit = e => {
    e.preventDefault();
    const snap = { id: newId(), name: f.name.value.trim() || today(), layout: { ...S.L, base: '' }, updated: new Date().toISOString(), local: true };
    S.saved = [snap, ...S.saved];
    saveSaved();
    pushSnap(snap);
    commit({ ...S.L, base: snap.id }); // the next shuffle avoids this arrangement
    d.close();
    toast(`"${snap.name}"(으)로 저장했어요`);
  };
}

function openLoad() {
  const d = dlg(`<div class="seat-form"><h3>${fa('folder-open')} 저장한 배치</h3>
    <div class="seat-saved">${S.saved.map(s => `<div class="seat-sv ${S.L.base === s.id ? 'cur' : ''}"><button type="button" class="seat-sv-open" data-load="${esc(s.id)}"><b>${esc(s.name)}</b><small>${stamp(s.updated)}${S.L.base === s.id ? ' · 지금 기준' : ''}</small></button>
      <button type="button" class="seat-sv-del" data-del="${esc(s.id)}" aria-label="삭제">${fa('trash-can')}</button></div>`).join('') || '<p class="muted small">아직 저장한 배치가 없어요. 자리를 정한 뒤 "저장"을 눌러 주세요.</p>'}</div>
    <p class="muted small">불러오면 좌석 구성·학생 자리·고정석·문구가 그대로 돌아와요. 이 배치를 기준으로 무작위하면 같은 자리를 피해요.</p>
    <div class="acts"><button type="button" class="btn" data-close>닫기</button></div></div>`);
  d.querySelector('.seat-saved').onclick = e => {
    const ld = e.target.closest('[data-load]');
    const del = e.target.closest('[data-del]');
    if (ld) {
      const s = S.saved.find(x => x.id === ld.dataset.load);
      d.close();
      S.step = 'place';
      commit({ ...blankLayout(s.layout.rows, s.layout.cols), ...s.layout, base: s.id });
      toast(`"${s.name}"을(를) 불러왔어요`);
    } else if (del) {
      if (!confirm('이 배치를 지울까요?')) return;
      S.saved = S.saved.filter(x => x.id !== del.dataset.del);
      saveSaved();
      quiet('seatDel', { id: del.dataset.del }).catch(() => {});
      d.close();
      openLoad();
    }
  };
}

// ---------- shuffle & reveal ----------

function baseAssign() {
  const s = S.L.base && S.saved.find(x => x.id === S.L.base);
  return s ? s.layout.assign : S.L.assign;
}

function openShuffle() {
  const L = S.L, ids = studentIds();
  const desks = L.desks.filter(Boolean).length;
  const prefs = lsGet('seatShowPrefs') || { mode: 'slot', speed: 'normal', sound: true };
  const base = S.L.base && S.saved.find(x => x.id === S.L.base);
  const seg = (k, opts) => `<div class="seg2" data-pref="${k}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(prefs[k]) === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const d = dlg(`<div class="seat-form"><h3>${fa('shuffle')} 무작위 배치</h3>
    ${ids.length > desks ? `<p class="seat-warn">${fa('circle-exclamation')} 책상이 ${ids.length - desks}개 모자라요. ${ids.length - desks}명은 자리 없는 학생으로 남아요.</p>` : ''}
    <div class="seat-rules">
      <div>${fa('thumbtack')} 고정석 ${L.fixed.length}자리는 그대로</div>
      <div>${fa('rotate')} ${base ? `"${esc(base.name)}"` : '지금 배치'}와 같은 자리 피하기</div>
      <div>${fa('arrows-left-right')} 떨어뜨릴 학생 ${(L.apart || []).length}쌍 지키기</div>
    </div>
    <div class="f"><span>연출</span>${seg('mode', [['slot', '슬롯머신'], ['magnet', '자석']])}</div>
    <div class="f"><span>진행 속도</span>${seg('speed', [['fast', '빠르게 · 5초'], ['normal', '보통 · 12초'], ['step', '한 명씩 (클릭)']])}</div>
    <div class="f"><span>효과음</span>${seg('sound', [['true', '켜기'], ['false', '끄기']])}</div>
    <div class="acts"><button type="button" class="btn" data-close>취소</button><button type="button" class="btn primary" id="seatGo">${fa('expand')} 전체 화면으로 시작</button></div></div>`);
  d.querySelectorAll('[data-pref]').forEach(g => {
    g.onclick = e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      prefs[g.dataset.pref] = g.dataset.pref === 'sound' ? b.dataset.v === 'true' : b.dataset.v;
    };
  });
  d.querySelector('#seatGo').onclick = () => { lsSet('seatShowPrefs', prefs); d.close(); reveal(prefs); };
}

async function reveal(prefs) {
  let r;
  const shuffle = () => { r = arrange(S.L, studentIds(), baseAssign()); return { ...S.L, assign: r.assign }; };
  const out = await showSeats({ L: shuffle(), who: names(), title: ctx.cls.name, ...prefs, reshuffle: shuffle });
  if (out.res !== 'ok') return;
  commit({ ...S.L, assign: out.L.assign });
  const notes = [];
  if (r.same) notes.push(`${r.same}명은 자리가 빠듯해 같은 자리예요`);
  if (r.apartFail) notes.push('떨어뜨릴 수 없는 쌍이 있어요');
  if (r.unseated.length) notes.push(`${r.unseated.length}명은 자리가 없어요`);
  toast(notes.length ? notes.join(' · ') : '새 자리를 확정했어요. 마음에 들면 "저장"을 눌러 주세요');
}

// ---------- print ----------

function openPrint() {
  let view = S.view;
  const who = names();
  const el = document.createElement('div');
  el.className = 'seat-paper';
  const draw = () => {
    el.innerHTML = `<div class="seat-ptools"><div class="seg2" id="pv"><button type="button" data-pv="student" class="${view === 'student' ? 'on' : ''}">학생 보기로 인쇄</button><button type="button" data-pv="teacher" class="${view === 'teacher' ? 'on' : ''}">교사 보기로 인쇄</button></div>
      <span class="sp"></span><button type="button" class="btn" id="pClose">닫기</button><button type="button" class="btn primary" id="pGo">${fa('print')}인쇄하기</button></div>
      <div class="seat-sheet">
        <div class="seat-note top" contenteditable="true" data-ph="상단 문구 (예: 2학년 3반 10월 자리)">${esc(S.L.top || '')}</div>
        ${roomHtml(S.L, { view, who })}
        <div class="seat-note bottom" contenteditable="true" data-ph="하단 문구 (예: 자리는 한 달 뒤 바꿉니다)">${esc(S.L.bottom || '')}</div>
      </div>`;
    el.querySelector('#pv').onclick = e => { const b = e.target.closest('[data-pv]'); if (b) { saveNotes(); view = b.dataset.pv; draw(); } };
    el.querySelector('#pClose').onclick = close;
    el.querySelector('#pGo').onclick = () => { saveNotes(); print(); };
  };
  const saveNotes = () => {
    const top = el.querySelector('.seat-note.top').innerText.trim(), bottom = el.querySelector('.seat-note.bottom').innerText.trim();
    if (top !== (S.L.top || '') || bottom !== (S.L.bottom || '')) commit({ ...S.L, top, bottom }, false);
  };
  const close = () => { saveNotes(); el.remove(); document.body.classList.remove('seat-printing'); removeEventListener('keydown', esc_); };
  const esc_ = e => { if (e.key === 'Escape' && !e.target.isContentEditable) close(); };
  document.body.classList.add('seat-printing');
  document.body.append(el);
  addEventListener('keydown', esc_);
  draw();
}

// ---------- entry ----------

export function seatsView(c) {
  ctx = c;
  if (!S || S.classId !== c.cls.id) load(c.cls);
  paint();
  if (!S.fetched) { S.fetched = true; fetchServer(); }
}
