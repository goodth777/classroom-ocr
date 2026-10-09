import { call, quiet } from './api.js';
import { bubbles, bindComposer } from './inbox.js';
import { fa } from './fa.js';
import { qrSvg, joinUrl } from './qr.js';
import { seatsView } from './seats.js';
import { pushState, enablePush, disablePush } from './push.js';
import { store } from './store.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, DONE, assigned, summarize, toCsv, dDay, dueLabel, parseRoster } from './lib.js';

const kst = iso => new Date(Date.parse(iso) + 9 * 36e5);
const when = iso => {
  if (!iso) return '';
  const d = kst(iso), today = kst(new Date().toISOString());
  return d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)
    ? d.toISOString().slice(11, 16)
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const stamp = iso => { const d = kst(iso); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.toISOString().slice(11, 16)}`; };
const shortDue = due => (due ? `${+due.slice(5, 7)}.${+due.slice(8)} 마감` : '마감일 없음');
const weekLater = () => new Date(Date.now() + 9 * 36e5 + 7 * 864e5).toISOString().slice(0, 10);
const cellOf = (grid, sid, wid) => (grid.cells[sid] || {})[wid];

// Full submission texts, fetched on demand (the grid only carries a short preview). Keyed by submission id.
const fullText = new Map();
async function loadTexts(classId, studentId) {
  Object.entries(await call('texts', { classId, studentId })).forEach(([id, t]) => fullText.set(id, t));
}
// CSV needs {studentId: {workId: text}}.
async function csvTexts(grid, classId, studentId) {
  await loadTexts(classId, studentId);
  const texts = {};
  grid.students.forEach(s => grid.works.forEach(w => { const c = cellOf(grid, s.id, w.id); if (c && fullText.has(c.subId)) (texts[s.id] ??= {})[w.id] = fullText.get(c.subId); }));
  return texts;
}
async function busyBtn(btn, label, work) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  try { await work(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.innerHTML = old; }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

let escBound = false;
function bindEsc() {
  if (escBound) return;
  escBound = true;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    document.querySelectorAll('.drawer.open').forEach(d => d.classList.remove('open'));
    document.getElementById('board')?.setAttribute('hidden', '');
  });
}

// ---------- loading: draw the last known view at once, refresh in the background ----------

const busyUI = () => document.querySelector('dialog[open], .drawer.open, .board:not([hidden])');

export async function teacherView(classId, tab, sub, sub2) {
  const n = currentNav();
  const key = 'view:' + (classId || '');
  const old = store.cache(key);
  if (old && old.classId) draw(old, tab, sub, sub2); else loading('teacher');
  let v;
  try {
    v = await call('view', { classId });
  } catch (e) {
    if (!old || e.code === 'auth') throw e;
    return toast('연결이 잠시 끊겼어요. 마지막으로 받은 화면을 보여 드려요');
  }
  if (!isCurrent(n)) return;
  store.setCache('view:' + (v.classId || ''), v);
  store.setCache('view:', v);
  if (!v.classId) return drawEmpty(v);
  if (classId !== v.classId) return location.replace(`#/t/${v.classId}/${tabFor(v.classes.find(c => c.id === v.classId), tab)}`);
  // the forms screen keeps its own data; redrawing it under the teacher's typing would lose focus
  if (JSON.stringify(v) !== JSON.stringify(old) && !busyUI() && (tab !== 'forms' || !(old && old.classId))) draw(v, tab, sub, sub2);
}

const reload = (cls, tab) => teacherView(cls.id, tab).catch(e => toast(e.message));

// Homeroom classes open on seats and have no assignment grid; teaching classes have no seats.
const isHome = c => !!c && c.kind === 'homeroom';
// Dialogs that pick a class (new announcement, new assignment) only offer classes of the open class's kind.
const sameKind = (v, cls) => v.classes.filter(c => isHome(c) === isHome(cls));
function tabFor(c, tab) {
  if (tab === 'roster' || tab === 'msg') return tab;
  if (tab === 'forms' && !isHome(c)) return tab;
  return isHome(c) ? 'seats' : 'grid';
}

function draw(v, tab, sub, sub2) {
  bindEsc();
  const cls = v.classes.find(c => c.id === v.classId);
  tab = tabFor(cls, tab);
  if (tab === 'msg') return drawMsg(v, cls, sub || '');
  if (tab === 'roster') return drawRoster(v, cls);
  if (tab === 'forms') {
    // loaded only when the tab opens, so the app's first screen stays as light as before
    const frame = { v, cls, frame: (body, actions) => shell(v.classes, cls, 'forms', (v.roster || []).length, body, actions), after: bindShell };
    return import('./forms.js').then(m => m.formsView(frame, sub || '', sub2 || '')).catch(e => toast(e.message));
  }
  if (tab === 'seats') {
    return seatsView({
      v, cls,
      frame: (body, actions) => shell(v.classes, cls, 'seats', (v.roster || []).length, body, actions),
      after: bindShell,
    });
  }
  return drawGrid(v, cls);
}

// ---------- shell: class sidebar + header with tabs ----------

function shell(classes, cls, tab, students, body, actions) {
  return `<div class="t-layout">
    <aside class="side">
      <div class="brand"><img src="icons/icon-192.png" alt=""><span><b>과제 제출</b><small>손글씨 OCR</small></span></div>
      ${classGroup('담임', classes.filter(isHome), cls, tab, 'house-chimney-user')}
      ${classGroup(classes.some(isHome) ? '수업' : '내 클래스', classes.filter(c => !isHome(c)), cls, tab, 'book-open')}
      <button class="addclass" id="addClass">${fa('plus')}새 클래스 만들기</button>
      <div class="me"><div class="av">${fa('user')}</div><div><b>선생님</b><span>개인 구글 계정</span></div></div>
      ${pcPush()}
      <button class="sheetlink" id="openSheet">${fa('table')}원본 시트 열기</button>
    </aside>
    <main class="tmain">
      ${cls ? `<div class="thead">
        <h1>${esc(cls.name)}</h1>${isHome(cls) ? '<span class="chip home">담임 클래스</span>' : ''}<span class="chip">${esc([cls.section, `학생 ${students}명`].filter(Boolean).join(' · '))}</span>
        <nav class="tabs">${isHome(cls)
          ? `<a class="${tab === 'seats' ? 'on' : ''}" href="#/t/${cls.id}/seats">${fa('chair')}좌석 배치</a>`
          : `<a class="${tab === 'grid' ? 'on' : ''}" href="#/t/${cls.id}/grid">${fa('table-cells-large')}과제 현황</a><a class="${tab === 'forms' ? 'on' : ''}" href="#/t/${cls.id}/forms">${fa('square-poll-horizontal')}설문</a>`}<a class="${tab === 'roster' ? 'on' : ''}" href="#/t/${cls.id}/roster">${fa('users')}학생 명단</a>
          <a class="${tab === 'msg' ? 'on' : ''}" href="#/t/${cls.id}/msg">${fa('comment-dots')}메시지${cls.unread ? ` <span class="badge">${cls.unread}</span>` : ''}</a></nav>
        <span class="sp"></span>${actions}
      </div>` : ''}
      ${body}
    </main>
    <dialog class="sheet" id="classDlg"><form id="classForm">
      <h3>새 클래스 만들기</h3>
      <p class="muted small">클래스를 만들면 학생이 입력할 수업 코드가 바로 생겨요.</p>
      <div class="f"><span>종류</span><div class="seg2" id="kindSeg"><button type="button" data-kind="" class="on">${fa('book-open')} 수업 클래스</button><button type="button" data-kind="homeroom">${fa('house-chimney-user')} 담임 클래스</button></div></div>
      <input type="hidden" name="kind" value="">
      <label>클래스 이름<input name="name" required placeholder="예: 2학년 영어 독해"></label>
      <div class="row2"><label>학년·반<input name="section" placeholder="예: 2-3반"></label><label>과목 (선택)<input name="subject" placeholder="예: 영어"></label></div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary">만들기</button></div>
    </form></dialog>
  </div>`;
}

function classGroup(label, list, cls, tab, icon) {
  if (!list.length) return '';
  return `<div class="lab">${label}</div>${list.map(c => `<a class="course ${cls && c.id === cls.id ? 'on' : ''}" href="#/t/${c.id}/${tabFor(c, tab)}">${fa(icon)}<span class="cn">${esc(c.name)}</span>${c.unread ? `<span class="badge">${c.unread}</span>` : `<small>${esc(c.section)}</small>`}</a>`).join('')}`;
}

function pcPush() {
  const st = pushState();
  if (st === 'unsupported' || st === 'ios') return '';
  return `<button class="pcpush" id="pcPush">${st === 'on' ? `${fa('bell')}PC 알림 켜짐 <small>끄기</small>` : st === 'denied' ? `${fa('bell-slash')}PC 알림 차단됨 <small>브라우저 설정</small>` : `${fa('bell')}PC 알림 켜기 <small>학생 메시지</small>`}</button>`;
}

function bindShell() {
  $('#addClass').onclick = () => $('#classDlg').showModal();
  $('#kindSeg').onclick = e => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    $('#kindSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    const f = $('#classForm');
    f.kind.value = b.dataset.kind;
    f.name.placeholder = b.dataset.kind ? '예: 2학년 3반' : '예: 2학년 영어 독해';
  };
  if ($('#pcPush')) $('#pcPush').onclick = async () => {
    const st = pushState();
    if (st === 'denied') return toast('주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔 주세요');
    try {
      if (st === 'on') { await disablePush(); toast('PC 알림을 껐어요'); }
      else { await enablePush('teacher'); toast('PC 알림을 켰어요. 학생 메시지가 오면 알려 드려요 🔔'); }
    } catch (e) { toast(e.message); }
    $('#pcPush').outerHTML = pcPush();
    bindShell();
  };
  $('#openSheet').onclick = async () => {
    const w = window.open('', '_blank');
    try { w.location = await call('sheetUrl'); } catch (e) { w.close(); toast(e.message); }
  };
  document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  $('#classForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('.primary');
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    try {
      const c = await call('createClass', { name: f.get('name'), section: f.get('section'), subject: f.get('subject'), kind: f.get('kind') });
      $('#classDlg').close();
      toast(`클래스를 만들었어요. 수업 코드는 ${c.code}예요`);
      location.hash = `#/t/${c.id}/roster`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '만들기';
      toast(err.message);
    }
  };
}

function drawEmpty(v) {
  render(shell(v.classes, null, 'grid', 0, `<section class="center"><div class="hero-card">
    <div class="logo"></div><h1>첫 클래스를 만들어 주세요</h1>
    <p class="muted">클래스를 만들고 학생 명단을 붙여 넣으면,<br>학생이 수업 코드와 PIN으로 참여할 수 있어요.</p>
    <button class="btn primary" id="firstClass">${fa('plus')}새 클래스 만들기</button></div></section>`, ''));
  bindShell();
  $('#firstClass').onclick = () => $('#classDlg').showModal();
}

// ---------- target picker (new assignment, change targets) ----------

function pickerHtml(students, chosen, all) {
  return `<div class="f"><span>대상</span><div class="seg2" data-seg>
      <button type="button" data-all="1" class="${all ? 'on' : ''}">클래스 전체 (${students.length}명)</button>
      <button type="button" data-all="0" class="${all ? '' : 'on'}">일부 학생 선택</button></div></div>
    <div class="who" data-who ${all ? 'hidden' : ''}>
      <div class="whohead"><b data-count></b><span class="sp"></span>
        <button type="button" data-q="miss">미제출 있는 학생</button><button type="button" data-q="all">모두 선택</button><button type="button" data-q="none">선택 해제</button></div>
      <div class="people">${students.map(s => `<button type="button" class="p ${chosen.has(s.id) ? 'on' : ''}" data-id="${s.id}"><i>✓</i>${s.number} ${esc(s.name)}</button>`).join('')}</div>
    </div>`;
}

// Returns get() → null for the whole class, or the chosen student ids; onChange(count|null) updates the submit label.
function bindPicker(root, students, missIds, onChange) {
  let all = root.querySelector('[data-seg] .on').dataset.all === '1';
  const chosen = () => [...root.querySelectorAll('.p.on')].map(b => b.dataset.id);
  const paint = () => {
    root.querySelector('[data-who]').hidden = all;
    root.querySelectorAll('[data-seg] button').forEach(b => b.classList.toggle('on', (b.dataset.all === '1') === all));
    root.querySelector('[data-count]').textContent = `${chosen().length}명 선택됨`;
    onChange(all ? null : chosen().length);
  };
  root.onclick = e => {
    const seg = e.target.closest('[data-seg] button');
    const p = e.target.closest('.p');
    const q = e.target.closest('[data-q]');
    if (seg) all = seg.dataset.all === '1';
    else if (p) p.classList.toggle('on');
    else if (q) root.querySelectorAll('.p').forEach(b => b.classList.toggle('on', q.dataset.q === 'all' || (q.dataset.q === 'miss' && missIds.has(b.dataset.id))));
    else return;
    paint();
  };
  paint();
  return () => (all ? null : chosen());
}

// ---------- 과제 현황: spreadsheet ----------

let sortBy = 'num';
let query = '';

function drawGrid(v, cls) {
  const grid = v.grid;
  const sum = summarize(grid);
  const missOf = sid => grid.works.filter(w => assigned(w, sid) && !cellOf(grid, sid, w.id)).length;
  const doneOf = sid => grid.works.filter(w => assigned(w, sid) && DONE.has((cellOf(grid, sid, w.id) || {}).state)).length;
  const dueOf = sid => grid.works.filter(w => assigned(w, sid)).length;
  const workStats = w => {
    const who = grid.students.filter(s => assigned(w, s.id));
    return { n: who.length, done: who.filter(s => cellOf(grid, s.id, w.id)).length };
  };
  const next = grid.works.filter(w => w.due && dDay(w.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0];
  const ns = next && workStats(next);
  const li = (a, b) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`;
  const deltaHtml = sum.delta == null ? '' : sum.delta >= 0
    ? `<br>지난주보다 <span class="up">+${sum.delta}%p</span>` : `<br>지난주보다 <span class="down">${sum.delta}%p</span>`;
  const missIds = new Set(grid.students.filter(s => missOf(s.id)).map(s => s.id));

  const cell = (s, w) => {
    if (!assigned(w, s.id)) return '<td class="na" title="대상 아님">–</td>';
    const c = cellOf(grid, s.id, w.id);
    if (!c) return `<td class="c" data-s="${s.id}" data-w="${w.id}"><span class="s no"><b>미제출</b></span></td>`;
    return `<td class="c" data-s="${s.id}" data-w="${w.id}"><span class="s ${c.late ? 'late' : 'ok'}"><b>${c.late ? '지각' : '제출'}</b><span>${esc(stamp(c.updated))}</span></span></td>`;
  };
  const rows = () => {
    const list = grid.students.filter(s => !query || s.name.includes(query));
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    else if (sortBy === 'miss') list.sort((a, b) => missOf(b.id) - missOf(a.id) || a.number - b.number);
    return list.map(s => `<tr data-row="${s.id}"><td class="rownum">${s.sno || s.number}</td><td class="namecol" data-student="${s.id}">${esc(s.name)}<span class="open">현황 ›</span></td>
      ${grid.works.map(w => cell(s, w)).join('')}<td class="sum"><b>${doneOf(s.id)}</b>/${dueOf(s.id)}</td></tr>`).join('');
  };

  const body = `
    <section class="t-bento">
      <div class="tile rate">
        <div class="ring" style="--p:${sum.rate}"><span>${sum.rate}%</span></div>
        <div><b>전체 제출률</b><p>과제 ${grid.works.length}개 · ${sum.total}건 중 ${sum.done}건 제출${deltaHtml}</p></div>
      </div>
      <div class="tile"><div class="k"><i class="ti w">${fa('circle-exclamation')}</i>미제출 <span>전체</span></div>
        <div class="big warn">${sum.total - sum.done}<small>건</small></div>
        <ul class="mini">${sum.missing.slice(0, 2).map(m => li(m.name, `${m.miss}건`)).join('')}</ul></div>
      <div class="tile"><div class="k"><i class="ti b">${fa('clock-rotate-left')}</i>최근 제출</div>
        <ul class="mini">${sum.recent.slice(0, 3).map(r => li(r.student, `${r.work} · ${when(r.updated)}`)).join('') || '<li><span class="muted">아직 없어요</span></li>'}</ul></div>
      <div class="tile"><div class="k"><i class="ti y">${fa('calendar-check')}</i>다음 마감 <span>${next ? esc(next.title) : ''}</span></div>
        ${next ? `<div class="big">${dDay(next.due) === 0 ? 'D-day' : `D-${dDay(next.due)}`}<small>${esc(dueLabel(next.due))}</small></div>
        <div class="mbar" title="제출 ${ns.done}/${ns.n}"><i style="width:${ns.n ? Math.round(ns.done / ns.n * 100) : 0}%"></i></div>` : '<div class="big">–</div>'}</div>
    </section>
    <div class="toolbar">
      <label class="srch">${fa('magnifying-glass')}<input class="search" id="search" type="search" placeholder="학생 검색" aria-label="학생 검색" value="${esc(query)}"></label>
      <div class="seg2 small" id="sort">${[['num', '번호순'], ['name', '이름순'], ['miss', '미제출 많은 순']].map(([k, t]) => `<button type="button" data-sort="${k}" class="${sortBy === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="legend"><span><b class="lg ok">제출</b></span><span><b class="lg late">지각</b></span><span><b class="lg no">미제출</b></span><span>▨ 대상 아님</span></div>
    </div>
    ${grid.works.length ? `<div class="sheetwrap"><table class="xsheet">
      <thead><tr><th class="rownum">#</th><th class="namecol">학생</th>${grid.works.map(w => {
        const st = workStats(w);
        return `<th><button class="wt" data-work="${w.id}" title="눌러서 대상 바꾸기">${esc(w.title)}${w.targets ? ` <span class="tgt">${w.targets.length}명 대상</span>` : ''}</button>
          <small>${esc(shortDue(w.due))} · 제출 ${st.done}/${st.n}</small><span class="rate"><i style="width:${st.n ? Math.round(st.done / st.n * 100) : 0}%"></i></span></th>`;
      }).join('')}<th class="sumh">제출</th></tr></thead>
      <tbody id="rows">${rows()}</tbody>
    </table></div>` : '<section class="gridcard"><p class="empty">아직 낸 과제가 없어요. 오른쪽 위 "새 과제"로 첫 과제를 내 보세요.</p></section>'}
    <aside class="drawer" id="drawer" aria-label="제출 내용">
      <div class="dh"><span class="av" id="dAv"></span><div><b id="dTitle"></b><span id="dSub"></span></div><button class="x" data-shut aria-label="닫기">${fa('xmark')}</button></div>
      <div class="photos" id="dPhotos"></div>
      <pre class="txt" id="dText"></pre>
      <div class="acts"><button class="btn" id="dNext">다음 학생 →</button></div>
    </aside>
    <aside class="drawer spanel" id="spanel" aria-label="학생 현황"></aside>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="제출 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
    <dialog class="sheet wide" id="newDlg"><form id="newForm">
      <h3>새 과제 만들기</h3>
      <label>제목<input name="title" required placeholder="예: 3회차 독해 활동"></label>
      <label>안내<textarea name="description" rows="2" placeholder="학생에게 보일 안내 (선택)"></textarea></label>
      <div class="row2">
        <label>마감일<input type="date" name="due" value="${weekLater()}"></label>
        <label>클래스<select name="classId" id="newClass">${sameKind(v, cls).map(c => `<option value="${c.id}" ${c.id === cls.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div id="newPick">${pickerHtml(grid.students, new Set(), true)}</div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="create">클래스 전체에게 과제 내기</button></div>
    </form></dialog>
    <dialog class="sheet wide" id="tgtDlg"><form id="tgtForm">
      <h3 id="tgtTitle"></h3><p class="muted small">이미 제출한 학생의 제출물은 대상에서 빼도 지워지지 않아요.</p>
      <div id="tgtPick"></div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="tgtGo">저장</button></div>
    </form></dialog>`;
  const actions = `<button class="btn" id="csv">${fa('download')}CSV 내려받기</button><button class="btn primary" id="new">${fa('plus')}새 과제</button>`;
  render(shell(v.classes, cls, 'grid', grid.students.length, body, actions));
  bindShell();

  // toolbar
  $('#search').oninput = e => { query = e.target.value.trim(); if ($('#rows')) $('#rows').innerHTML = rows(); };
  $('#sort').onclick = e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    sortBy = b.dataset.sort;
    $('#sort').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if ($('#rows')) $('#rows').innerHTML = rows();
  };

  // submission drawer
  const drawer = $('#drawer');
  let open = null;
  let token = 0;
  const nextWith = (sid, wid) => {
    const order = [...document.querySelectorAll('#rows tr')].map(tr => tr.dataset.row);
    return order.slice(order.indexOf(sid) + 1).find(id => cellOf(grid, id, wid));
  };
  async function show(sid, wid) {
    const s = grid.students.find(x => x.id === sid);
    const w = grid.works.find(x => x.id === wid);
    const c = cellOf(grid, sid, wid);
    if (!c) return;
    open = { sid, wid };
    $('#spanel').classList.remove('open');
    $('#dAv').textContent = s.number;
    $('#dTitle').textContent = `${s.name} · ${w.title}`;
    $('#dSub').textContent = `${stamp(c.updated)} 제출${c.late ? ' · 지각' : ''}${c.photos ? ` · 사진 ${c.photos}장` : ''}`;
    const known = fullText.get(c.subId);
    $('#dText').textContent = known ?? c.preview;
    $('#dText').classList.toggle('loading', known == null);
    $('#dPhotos').innerHTML = c.photos ? '<div class="sk" style="width:130px;height:170px;flex:none"></div>'.repeat(c.photos) : '';
    $('#dNext').disabled = !nextWith(sid, wid);
    drawer.classList.add('open');
    const my = ++token;
    if (known == null) {
      loadTexts(cls.id, sid).then(() => {
        if (my !== token || !drawer.isConnected) return;
        $('#dText').textContent = fullText.get(c.subId) ?? c.preview;
        $('#dText').classList.remove('loading');
      }).catch(() => { if (my === token) $('#dText').classList.remove('loading'); });
    }
    if (!c.photos) return;
    const photos = await call('photos', { subId: c.subId }).catch(() => []);
    if (my !== token || !drawer.isConnected) return;
    $('#dPhotos').innerHTML = photos.filter(p => p.startsWith('data:image/')).map((p, i) => `<img src="${esc(p)}" alt="제출 사진 ${i + 1}">`).join('')
      || '<p class="muted small">사진을 불러오지 못했어요.</p>';
  }
  $('#dNext').onclick = () => { const nx = open && nextWith(open.sid, open.wid); if (nx) show(nx, open.wid); };
  $('#dPhotos').onclick = e => { if (e.target.tagName === 'IMG') { $('#phBig').src = e.target.src; $('#phDlg').showModal(); } };
  document.querySelectorAll('[data-shut]').forEach(b => { b.onclick = () => { b.closest('.drawer').classList.remove('open'); token++; }; });

  // student panel
  function studentPanel(sid) {
    const s = grid.students.find(x => x.id === sid);
    const r = (v.roster || []).find(x => x.id === sid) || {};
    const works = grid.works.filter(w => assigned(w, sid));
    const late = works.filter(w => (cellOf(grid, sid, w.id) || {}).late).length;
    drawer.classList.remove('open');
    document.querySelectorAll('#rows tr').forEach(tr => tr.classList.toggle('sel', tr.dataset.row === sid));
    $('#spanel').innerHTML = `
      <div class="dh"><span class="av big2">${s.number}</span><div><b>${esc(s.name)}</b><span>${esc([s.sno ? `학번 ${s.sno}` : '', cls.name, cls.section, s.number + '번'].filter(Boolean).join(' · '))}${r.lastSubmit ? ` · 마지막 제출 ${esc(when(r.lastSubmit))}` : ''}</span></div><button class="x" data-shut aria-label="닫기">${fa('xmark')}</button></div>
      ${(r.others || []).length ? `<div class="others-line">${fa('users')} 같은 학번이 있는 클래스: ${esc(r.others.join(' · '))}</div>` : ''}
      <div class="pstats"><div><small>제출</small><b class="a">${doneOf(sid)}</b>/${works.length}</div><div><small>미제출</small><b class="w">${missOf(sid)}</b></div><div><small>지각</small><b>${late}</b></div></div>
      <div class="plist">${works.map(w => {
        const c = cellOf(grid, sid, w.id);
        return c
          ? `<button class="pitem" data-s="${sid}" data-w="${w.id}"><div class="r"><b>${esc(w.title)}</b><span class="pill ${c.late ? 'late' : 'ok'}">${c.late ? '지각' : '제출'}</span></div>
              <div class="m">${esc(stamp(c.updated))} 제출${c.photos ? ` · 사진 ${c.photos}장` : ''}</div><p>${esc(c.preview)}</p></button>`
          : `<div class="pitem miss"><div class="r"><b>${esc(w.title)}</b><span class="pill no">미제출</span></div>
              <div class="m">${w.due ? `${esc(dueLabel(w.due))} 마감 · ${dDay(w.due) >= 0 ? `D-${dDay(w.due)}` : '마감 지남'}` : '마감일 없음'}</div></div>`;
      }).join('') || '<p class="muted small">이 학생에게 낸 과제가 없어요.</p>'}</div>
      <div class="acts"><a class="btn" href="#/t/${cls.id}/msg/${sid}">${fa('comment-dots')}메시지</a><button class="btn" id="sCsv">${fa('download')}이 학생 CSV</button><button class="btn" id="sPin">PIN 보기</button></div>`;
    $('#spanel').classList.add('open');
    $('#spanel').querySelector('[data-shut]').onclick = () => { $('#spanel').classList.remove('open'); document.querySelectorAll('#rows tr.sel').forEach(tr => tr.classList.remove('sel')); };
    $('#spanel').querySelector('.plist').onclick = e => { const it = e.target.closest('.pitem[data-w]'); if (it) show(it.dataset.s, it.dataset.w); };
    $('#sPin').onclick = () => toast(r.pin ? `${s.name} 학생의 PIN은 ${r.pin}예요` : 'PIN을 불러오지 못했어요');
    $('#sCsv').onclick = () => busyBtn($('#sCsv'), '내려받는 중…', async () => {
      const one = { students: [s], works, cells: { [sid]: grid.cells[sid] || {} } };
      download(`${cls.name}_${s.number}_${s.name}.csv`, toCsv(one, await csvTexts(one, cls.id, sid)));
    });
  }

  const want = sessionStorage.getItem('openStudent'); // "학생 현황 ›" from a message thread
  if (want) { sessionStorage.removeItem('openStudent'); if (grid.students.some(s => s.id === want)) studentPanel(want); }

  if ($('.xsheet')) $('.xsheet').onclick = e => {
    const name = e.target.closest('[data-student]');
    const c = e.target.closest('td.c');
    const wt = e.target.closest('[data-work]');
    if (name) studentPanel(name.dataset.student);
    else if (c) show(c.dataset.s, c.dataset.w);
    else if (wt) editTargets(wt.dataset.work);
  };

  // CSV
  $('#csv').onclick = () => busyBtn($('#csv'), '내려받는 중…', async () => {
    download(`${cls.name}.csv`, toCsv(grid, await csvTexts(grid, cls.id)));
  });

  // new assignment (targets only for this class; another class gets the whole class)
  let pick = bindPicker($('#newPick'), grid.students, missIds, n => {
    $('#create').textContent = n == null ? '클래스 전체에게 과제 내기' : `${n}명에게 과제 내기`;
    $('#create').disabled = n === 0;
  });
  $('#newClass').onchange = e => {
    const same = e.target.value === cls.id;
    $('#newPick').hidden = !same;
    if (!same) { $('#create').textContent = '클래스 전체에게 과제 내기'; $('#create').disabled = false; }
  };
  $('#new').onclick = () => $('#newDlg').showModal();
  $('#newForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const target = f.get('classId');
    const ids = target === cls.id ? pick() : null;
    const label = $('#create').textContent;
    $('#create').disabled = true;
    $('#create').textContent = '내는 중…';
    try {
      await call('createAssignment', { classId: target, title: f.get('title'), description: f.get('description'), due: f.get('due'), studentIds: ids });
      $('#newDlg').close();
    } catch (err) {
      $('#create').disabled = false;
      $('#create').textContent = label;
      return toast(err.message);
    }
    toast(ids ? `${ids.length}명에게 과제를 냈어요` : '과제를 냈어요. 학생 앱에 바로 보여요');
    if (target !== cls.id) location.hash = `#/t/${target}/grid`;
    else reload(cls, 'grid');
  };

  // change targets of an existing assignment
  function editTargets(wid) {
    const w = grid.works.find(x => x.id === wid);
    $('#tgtTitle').textContent = `"${w.title}" 대상 바꾸기`;
    $('#tgtPick').innerHTML = pickerHtml(grid.students, new Set(w.targets || []), !w.targets);
    const get = bindPicker($('#tgtPick'), grid.students, missIds, n => {
      $('#tgtGo').textContent = n == null ? '클래스 전체로 저장' : `${n}명으로 저장`;
      $('#tgtGo').disabled = n === 0;
    });
    $('#tgtForm').onsubmit = async e => {
      e.preventDefault();
      $('#tgtGo').disabled = true;
      try {
        await call('updateTargets', { assignmentId: wid, studentIds: get() });
        $('#tgtDlg').close();
        toast('대상을 바꿨어요');
        reload(cls, 'grid');
      } catch (err) {
        $('#tgtGo').disabled = false;
        toast(err.message);
      }
    };
    $('#tgtDlg').showModal();
  }
}

// ---------- 학생 명단 ----------

function drawRoster(v, cls) {
  const roster = v.roster;
  const joined = roster.filter(s => s.joined).length;
  const link = joinUrl(cls.code);
  const body = `
    <section class="r-bento">
      <div class="tile codecard">
        <div class="qr" title="학생이 카메라로 찍으면 수업 코드가 채워진 참여 화면이 열려요">${qrSvg(link, 3)}</div>
        <div><div class="k">수업 코드 · 카메라로 QR 찍기</div><div class="code">${esc(cls.code)}</div><div class="u">QR을 찍으면 코드가 자동으로 들어가요</div></div>
        <div class="codeacts"><button id="big" class="on">${fa('expand')}QR 크게 보기</button><button id="copy">${fa('copy')}링크 복사</button><button id="regen">${fa('rotate')}새 코드</button></div>
      </div>
      <div class="tile"><div class="k"><i class="ti">${fa('circle-check')}</i>참여한 학생</div><div class="big">${joined}<small>/ ${roster.length}명</small></div>
        <div class="mbar"><i style="width:${roster.length ? Math.round(joined / roster.length * 100) : 0}%"></i></div></div>
      <div class="tile"><div class="k"><i class="ti w">${fa('circle-exclamation')}</i>아직 참여 안 함</div><div class="big warn">${roster.length - joined}<small>명</small></div>
        <p class="muted small">${roster.length - joined ? 'PIN 카드를 다시 나눠 주세요' : '모두 참여했어요 🎉'}</p></div>
    </section>
    <section class="gridcard">
      <div class="gh"><h2>학생 명단</h2><span class="sp"></span><label class="srch">${fa('magnifying-glass')}<input class="search" id="search" type="search" placeholder="학생 검색" aria-label="학생 검색"></label></div>
      ${roster.length ? `<div class="table-wrap"><table class="roster">
        <thead><tr><th>학번</th><th>이름</th><th>PIN</th><th>참여</th><th>마지막 제출</th><th></th></tr></thead>
        <tbody>${roster.map(s => `<tr data-name="${esc(s.name)}" data-id="${s.id}" data-others="${esc((s.others || []).join(', '))}">
          <td>${s.sno || `<span class="muted" title="학번 없음">${s.number}번</span>`}</td><td><div class="name">${esc(s.name)}${(s.others || []).length ? `<small class="others">${esc(s.others.join(' · '))}</small>` : ''}</div></td>
          <td class="pin" data-pin="${esc(s.pin)}">••••</td>
          <td><span class="st ${s.joined ? 'ok' : 'wait'}">${s.joined ? '참여함' : '대기'}</span></td>
          <td class="muted">${s.lastSubmit ? when(s.lastSubmit) : '–'}</td>
          <td class="rowacts"><button data-act="show">PIN 보기</button><button data-act="reissue">재발급</button></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">아직 학생이 없어요. 오른쪽 위 "명단 붙여넣기"로 학생을 추가해 주세요.</p>'}
    </section>
    <dialog class="sheet" id="pasteDlg"><form id="pasteForm">
      <h3>학생 명단 붙여넣기</h3>
      <p class="muted small">엑셀이나 나이스에서 <b>학번·이름</b> 두 칸을 복사해 붙여 넣으세요(학번 5자리, 예: 20812 = 2학년 8반 12번). PIN은 자동으로 만들어지고, 다른 클래스에 같은 학번이 있으면 같은 PIN을 써요. 이미 있는 학생에게는 이름으로 학번을 채워 넣어요.</p>
      <textarea name="text" id="pasteText" rows="8" placeholder="20801&#9;강수아&#10;20802&#9;김민준&#10;20803&#9;박지호"></textarea>
      <div class="preview" id="pastePreview">붙여 넣으면 몇 명인지 바로 보여요</div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="pasteGo" disabled>추가하고 PIN 만들기</button></div>
    </form></dialog>
    <div class="board" id="board" hidden>
      <button class="x" id="boardClose">${fa('xmark')}닫기 (Esc)</button>
      <div class="qr">${qrSvg(link, 9)}</div>
      <div class="bt"><div class="t">${esc([cls.name, cls.section].filter(Boolean).join(' · '))}</div>
        <div class="c">${esc(cls.code)}</div>
        <ol><li>휴대폰 카메라로 QR 찍기</li><li>"앱 설치하기" 누르기</li><li>번호 고르고 PIN 4자리 입력</li></ol></div>
    </div>
    <div class="print-cards" aria-hidden="true">${roster.map(s => `<div class="pcard"><div class="pq">${qrSvg(link, 2)}</div><div><b>${esc(cls.name)}</b><span>${esc(cls.section)} ${s.sno ? `학번 ${s.sno}` : `${s.number}번`} ${esc(s.name)}</span>
      <div class="pk"><small>수업 코드</small>${esc(cls.code)}</div><div class="pk"><small>PIN</small>${esc(s.pin)}</div>
      <p>카메라로 QR을 찍고 번호와 PIN을 넣으세요</p></div></div>`).join('')}</div>`;
  const actions = `<button class="btn" id="print">${fa('print')}PIN 카드 인쇄</button><button class="btn primary" id="paste">${fa('plus')}명단 붙여넣기</button>`;
  render(shell(v.classes, cls, 'roster', roster.length, body, actions));
  bindShell();

  $('#search').oninput = e => {
    const q = e.target.value.trim();
    document.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
  };
  $('#big').onclick = () => $('#board').removeAttribute('hidden');
  $('#boardClose').onclick = () => $('#board').setAttribute('hidden', '');
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('참여 링크를 복사했어요. 단톡방에 붙여 넣으면 돼요'); } catch { toast(link); }
  };
  $('#regen').onclick = async () => {
    if (!confirm('새 코드를 만들면 지금 코드로는 더 이상 참여할 수 없어요. 이미 참여한 학생은 그대로예요. 바꿀까요?')) return;
    try { await call('newCode', { classId: cls.id }); toast('새 수업 코드를 만들었어요'); reload(cls, 'roster'); } catch (e) { toast(e.message); }
  };
  $('#print').onclick = () => { if (!roster.length) return toast('먼저 명단을 붙여 넣어 주세요'); window.print(); };
  if ($('table')) $('table').onclick = async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const tr = b.closest('tr');
    const pin = tr.querySelector('.pin');
    if (b.dataset.act === 'show') {
      const hidden = pin.textContent === '••••';
      pin.textContent = hidden ? pin.dataset.pin : '••••';
      b.textContent = hidden ? 'PIN 숨기기' : 'PIN 보기';
      return;
    }
    const also = tr.dataset.others ? `\n같은 학번이 있는 ${tr.dataset.others}의 PIN도 함께 바뀌어요.` : '';
    if (!confirm(`${tr.dataset.name} 학생의 PIN을 새로 만들까요? 이 학생은 새 PIN으로 다시 참여해야 해요.${also}`)) return;
    b.disabled = true;
    b.textContent = '만드는 중…';
    try {
      const p = await call('reissuePin', { studentId: tr.dataset.id });
      pin.dataset.pin = p;
      pin.textContent = p;
      tr.querySelector('[data-act=show]').textContent = 'PIN 숨기기';
      tr.querySelector('.st').className = 'st wait';
      tr.querySelector('.st').textContent = '대기';
      toast(`새 PIN은 ${p}예요`);
    } catch (err) { toast(err.message); }
    b.disabled = false;
    b.textContent = '재발급';
  };

  $('#paste').onclick = () => $('#pasteDlg').showModal();
  $('#pasteText').oninput = () => {
    // rough preview only; the server decides (same names are asked about after sending)
    const list = parseRoster($('#pasteText').value);
    const has = r => roster.some(s => (r.sno ? s.sno === r.sno : !s.sno && s.number === r.number));
    const fill = list.filter(r => r.sno && !has(r) && roster.some(s => !s.sno && s.name === r.name)).length;
    const skip = list.filter(has).length;
    const fresh = list.length - skip - fill;
    $('#pastePreview').textContent = list.length ? `✓ ${list.length}명을 읽었어요 · 새로 추가 ${fresh}명${fill ? ` · 학번 채우기 ${fill}명` : ''}${skip ? ` · 이미 있음 ${skip}명` : ''}` : '학번과 이름을 읽지 못했어요';
    $('#pasteGo').disabled = !(fresh + fill);
    $('#pasteGo').textContent = fresh + fill ? '명단에 반영하기' : '추가하고 PIN 만들기';
  };
  $('#pasteForm').onsubmit = async e => {
    e.preventDefault();
    $('#pasteGo').disabled = true;
    $('#pasteGo').textContent = '추가하는 중…';
    try {
      const send = async resolve => {
        const r = await call('addStudents', { classId: cls.id, text: $('#pasteText').value, resolve });
        if (!r.ask.length) {
          $('#pasteDlg').close();
          toast([r.added ? `${r.added}명 추가` : '', r.filled ? `${r.filled}명 학번 채움` : ''].filter(Boolean).join(' · ') || '바뀐 학생이 없어요');
          return reload(cls, 'roster');
        }
        // same names: let the teacher pick who gets which 학번, then send once more
        const pick = await askSameNames(r.ask);
        if (pick) return send({ ...resolve, ...pick });
        $('#pasteGo').disabled = false;
        $('#pasteGo').textContent = '명단에 반영하기';
      };
      await send({});
    } catch (err) {
      $('#pasteGo').disabled = false;
      toast(err.message);
    }
  };
}

// Same name twice in a class: which existing student gets the 학번 (or a new student)?
function askSameNames(asks) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog" class="seat-form"><h3>같은 이름이 있어요</h3>
      <p class="muted small">학번을 누구에게 넣을지 골라 주세요.</p>
      ${asks.map(a => `<label class="f">${esc(a.sno)} ${esc(a.name)}<select data-sno="${esc(a.sno)}">${a.candidates.map(c => `<option value="${esc(c.id)}">기존 ${c.number}번 ${esc(c.name)}</option>`).join('')}<option value="new">새 학생으로 추가</option></select></label>`).join('')}
      <div class="acts"><button type="button" class="btn" data-x>취소</button><button class="btn primary">반영하기</button></div></form>`;
    document.body.append(d);
    d.showModal();
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-x]').onclick = () => done(null);
    d.querySelector('form').onsubmit = e => { e.preventDefault(); done(Object.fromEntries([...d.querySelectorAll('select')].map(x => [x.dataset.sno, x.value]))); };
  });
}

// ---------- 💬 messages: class announcements + one thread per student ----------

const QUICK = ['👍 확인했어', '📝 다시 제출해 줘', '⏰ 마감이 다가와'];
const POLL_MS = 5000;
let mstate = { cls: null, sel: '', inbox: null, thread: null, q: '' };

function drawMsg(v, cls, sel) {
  if (mstate.cls !== cls.id) mstate = { cls: cls.id, sel: '', inbox: store.cache('tinbox:' + cls.id), thread: null, q: '' };
  if (mstate.sel !== sel) { mstate.sel = sel; mstate.thread = sel && sel !== 'ann' ? store.cache('tthread:' + sel) : null; }
  const n = currentNav();
  paintMsg(v, cls);
  if (mstate.polling === n) return;
  mstate.polling = n;
  (async () => {
    while (isCurrent(n)) {
      try {
        const [box, th] = await Promise.all([quiet('tInbox', { classId: cls.id }),
          mstate.sel && mstate.sel !== 'ann' ? quiet('tThread', { studentId: mstate.sel }) : null]);
        if (!isCurrent(n)) return;
        const changed = JSON.stringify(box) !== JSON.stringify(mstate.inbox) || (th && JSON.stringify(th) !== JSON.stringify(mstate.thread));
        mstate.inbox = box;
        store.setCache('tinbox:' + cls.id, box);
        if (th) { mstate.thread = th; store.setCache('tthread:' + mstate.sel, th); }
        if (changed && !document.querySelector('dialog[open]')) paintMsg(v, cls);
      } catch {} // offline: keep what is on screen and try again
      await new Promise(r => setTimeout(r, document.hidden ? POLL_MS * 3 : POLL_MS));
    }
  })();
}

function paintMsg(v, cls) {
  const nav = currentNav();
  const typed = $('#msg') ? $('#msg').value : '';
  const box = mstate.inbox;
  const sel = mstate.sel;
  const grid = v.grid;
  // Opening a thread reads it; keep the badges in step without waiting for the next poll.
  if (box && sel && sel !== 'ann') box.threads.forEach(t => { if (t.studentId === sel) t.unread = 0; });
  if (box) cls.unread = box.threads.reduce((k, t) => k + t.unread, 0);
  const titleOf = id => (grid.works.find(w => w.id === id) || {}).title;
  const short = t => (t && t.length > 14 ? t.slice(0, 14) + '…' : t);
  const latestAnn = box && box.anns[0];
  const list = !box ? '<p class="muted small">불러오는 중…</p>' : `
    <a class="cv ${sel === 'ann' ? 'on' : ''}" href="#/t/${cls.id}/msg/ann"><div class="a ann">${fa('bullhorn')}</div><div class="t">
      <b>클래스 공지 <small>${latestAnn ? esc(when(latestAnn.created)) : ''}</small></b>
      <p>${latestAnn ? `${esc(latestAnn.title)} · 읽음 ${latestAnn.read}/${latestAnn.total}` : '아직 공지가 없어요'}</p></div></a>
    ${box.threads.filter(t => !mstate.q || t.name.includes(mstate.q)).map(t => `
      <a class="cv ${t.unread ? 'unread' : ''} ${sel === t.studentId ? 'on' : ''}" href="#/t/${cls.id}/msg/${t.studentId}"><div class="a">${t.number}</div><div class="t">
        <b>${esc(t.name)} <small>${t.last ? esc(when(t.last.created)) : ''}</small></b>
        <p>${t.last ? `${t.last.from === 't' ? '나: ' : ''}${t.last.assignmentId && titleOf(t.last.assignmentId) ? `📝 ${esc(short(titleOf(t.last.assignmentId)))} · ` : ''}${esc(t.last.text)}` : '<span class="muted">대화 시작하기</span>'}</p></div>
        ${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</a>`).join('')}`;

  let right;
  if (sel === 'ann') {
    right = `<div class="th"><div class="a ann">${fa('bullhorn')}</div><div><b>클래스 공지</b><small>${esc([cls.name, cls.section].filter(Boolean).join(' · '))} 학생 ${grid.students.length}명에게</small></div><span class="sp"></span></div>
      <div class="annlist">${(box ? box.anns : []).map(a => `<article class="ann ${a.pinned ? 'pin' : ''}">
        <div class="h">${a.pinned ? `<span class="tag">${fa('thumbtack')}고정</span>` : ''}${esc(when(a.created))}<span class="sp"></span>
          <button class="lk" data-pin="${a.id}" data-on="${a.pinned ? '' : '1'}">${a.pinned ? '고정 해제' : `${fa('thumbtack')}고정`}</button><button class="lk del" data-del="${a.id}">삭제</button></div>
        <b>${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}
        <div class="read">읽음 <b>${a.read}/${a.total}</b><span class="rbar"><i style="width:${a.total ? Math.round(a.read / a.total * 100) : 0}%"></i></span>${a.unreadNames.length ? `안 읽음: ${esc(a.unreadNames.join(', '))}` : ''}</div>
      </article>`).join('') || '<p class="empty">아직 공지가 없어요. 오른쪽 위 "새 공지"로 클래스 전체에 알릴 수 있어요.</p>'}</div>`;
  } else if (sel) {
    const s = grid.students.find(x => x.id === sel) || (box && box.threads.find(t => t.studentId === sel)) || { name: '', number: '' };
    const works = grid.works.filter(w => assigned(w, sel));
    const done = works.filter(w => cellOf(grid, sel, w.id)).length;
    const r = (v.roster || []).find(x => x.id === sel) || {};
    right = `<div class="th"><div class="a">${esc(s.number)}</div><div><b>${esc(s.name)}</b><small>${esc(s.number)}번 · 제출 ${done}/${works.length}${r.lastSubmit ? ` · 마지막 제출 ${esc(when(r.lastSubmit))}` : ''}</small></div>
        <span class="sp"></span><button class="btn" id="toPanel">학생 현황 ›</button></div>
      <div class="msgs thread" id="msgs">${mstate.thread ? bubbles(mstate.thread, 't', titleOf) || '<p class="empty">아직 주고받은 메시지가 없어요.</p>' : '<p class="empty">불러오는 중…</p>'}</div>
      <div class="quick">${QUICK.map(q => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="comp" id="composer"><textarea id="msg" rows="1" placeholder="${esc(s.name)}에게 메시지… (Enter 보내기 · Shift+Enter 줄바꿈)" aria-label="메시지"></textarea><button class="btn primary">보내기</button></form>`;
  } else {
    right = `<div class="pickone">${fa('comments')}<p>왼쪽에서 학생이나 클래스 공지를 골라 주세요.<br>학생이 과제 화면에서 질문하면 어떤 과제인지 꼬리표가 붙어 와요.</p></div>`;
  }

  const body = `<div class="inbox ${sel ? 'has-sel' : ''}">
      <div class="clist"><label class="srch">${fa('magnifying-glass')}<input class="search" id="msearch" type="search" placeholder="학생 검색" aria-label="학생 검색" value="${esc(mstate.q)}"></label><div id="cvs">${list}</div></div>
      <div class="cpane">${right}</div>
    </div>
    <dialog class="sheet wide" id="annDlg"><form id="annForm">
      <h3>${fa('bullhorn')} 새 공지 쓰기</h3>
      <label>받는 사람<select name="classId">${sameKind(v, cls).map(c => `<option value="${c.id}" ${c.id === cls.id ? 'selected' : ''}>${esc([c.name, c.section].filter(Boolean).join(' · '))} 전체 (${c.students}명)</option>`).join('')}</select></label>
      <label>제목<input name="title" required placeholder="예: 내일 수행평가 안내"></label>
      <label>내용<textarea name="body" rows="4" placeholder="학생에게 보일 내용"></textarea></label>
      <label class="check"><input type="checkbox" name="pinned"> 맨 위에 고정 (학생 홈 화면 맨 위에도 보여요)</label>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="annGo">공지 보내기</button></div>
    </form></dialog>`;
  const actions = `<button class="btn primary" id="newAnn">${fa('bullhorn')}새 공지</button>`;
  const y = $('#cvs') ? $('#cvs').scrollTop : 0;
  render(shell(v.classes, cls, 'msg', grid.students.length, body, actions));
  bindShell();
  $('#cvs').scrollTop = y;

  $('#msearch').oninput = e => {
    mstate.q = e.target.value.trim();
    const pos = e.target.selectionStart;
    paintMsg(v, cls);
    $('#msearch').focus();
    $('#msearch').setSelectionRange(pos, pos);
  };
  const annForm = $('#annForm');
  const goLabel = () => { const o = annForm.classId.selectedOptions[0]; $('#annGo').textContent = `${(/\((\d+)명\)/.exec(o.text) || [])[1] || ''}명에게 공지 보내기`; };
  annForm.classId.onchange = goLabel;
  goLabel();
  $('#newAnn').onclick = () => $('#annDlg').showModal();
  annForm.onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(annForm);
    const btn = $('#annGo');
    btn.disabled = true;
    btn.textContent = '보내는 중…';
    try {
      await call('postAnn', { classId: f.get('classId'), title: f.get('title'), body: f.get('body'), pinned: !!f.get('pinned') });
      $('#annDlg').close();
      toast('공지를 보냈어요. 학생 앱의 🔔 알림과 홈 화면에 나타나요');
      if (f.get('classId') !== cls.id) return (location.hash = `#/t/${f.get('classId')}/msg/ann`);
      mstate.inbox = await call('tInbox', { classId: cls.id });
      if (location.hash.endsWith('/msg/ann')) paintMsg(v, cls); else location.hash = `#/t/${cls.id}/msg/ann`;
    } catch (err) {
      btn.disabled = false;
      goLabel();
      toast(err.message);
    }
  };

  if (sel === 'ann') {
    $('.annlist').onclick = async e => {
      const pin = e.target.closest('[data-pin]');
      const del = e.target.closest('[data-del]');
      if (!pin && !del) return;
      if (del && !confirm('이 공지를 지울까요? 학생 화면에서도 사라져요.')) return;
      try {
        if (pin) await call('pinAnn', { id: pin.dataset.pin, pinned: !!pin.dataset.on });
        else await call('delAnn', { id: del.dataset.del });
        mstate.inbox = await call('tInbox', { classId: cls.id });
        paintMsg(v, cls);
      } catch (err) { toast(err.message); }
    };
  }
  if (sel && sel !== 'ann') {
    const msgs = $('#msgs');
    msgs.scrollTop = msgs.scrollHeight;
    $('#toPanel').onclick = () => { sessionStorage.setItem('openStudent', sel); location.hash = `#/t/${cls.id}/grid`; };
    $('.quick').onclick = e => {
      const b = e.target.closest('[data-quick]');
      if (!b) return;
      $('#msg').value = b.dataset.quick;
      $('#msg').focus();
    };
    bindComposer(async text => {
      const temp = { id: 'tmp' + Date.now(), from: 't', text, assignmentId: '', created: new Date().toISOString(), readAt: '', pending: true };
      mstate.thread = (mstate.thread || []).concat(temp);
      paintMsg(v, cls);
      try {
        Object.assign(temp, await call('tSend', { studentId: sel, text }), { pending: false });
        mstate.inbox = await quiet('tInbox', { classId: cls.id });
      } catch (err) {
        mstate.thread = mstate.thread.filter(m => m !== temp);
        toast(`보내지 못했어요. ${err.message}`);
        if ($('#msg') && !$('#msg').value) $('#msg').value = text;
      }
      if (isCurrent(nav)) paintMsg(v, cls);
    });
    if (typed) { $('#msg').value = typed; $('#msg').oninput(); }
  }
}
