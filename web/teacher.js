import { call } from './api.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, DONE, summarize, toCsv, dDay, dueLabel, parseRoster } from './lib.js';

const kst = iso => new Date(Date.parse(iso) + 9 * 36e5);
const when = iso => {
  if (!iso) return '';
  const d = kst(iso), today = kst(new Date().toISOString());
  return d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)
    ? d.toISOString().slice(11, 16)
    : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
const shortDue = due => (due ? `${+due.slice(5, 7)}.${+due.slice(8)} 마감` : '마감일 없음');
const weekLater = () => new Date(Date.now() + 9 * 36e5 + 7 * 864e5).toISOString().slice(0, 10);
const cellOf = (grid, sid, wid) => (grid.cells[sid] || {})[wid];
const dotFor = c => (!c ? ['no', ''] : c.late ? ['late', '!'] : ['ok', '✓']);

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
    document.getElementById('drawer')?.classList.remove('open');
    document.getElementById('board')?.setAttribute('hidden', '');
  });
}

// Shell shared by both tabs: class sidebar, header with tabs, dialogs for a new class.
function shell(classes, cls, tab, students, body, actions) {
  return `<div class="t-layout">
    <aside class="side">
      <div class="brand"><i></i><span>과제 제출</span></div>
      <div class="lab">내 반</div>
      ${classes.map(c => `<a class="course ${cls && c.id === cls.id ? 'on' : ''}" href="#/t/${c.id}/${tab}">${esc(c.name)}<small>${esc(c.section)}</small></a>`).join('')}
      <button class="addclass" id="addClass">＋ 새 반 만들기</button>
      <div class="me"><div class="av">T</div><div><b>선생님</b><span>개인 구글 계정</span></div></div>
      <button class="sheetlink" id="openSheet">📊 원본 시트 열기</button>
    </aside>
    <main class="tmain">
      ${cls ? `<div class="thead">
        <h1>${esc(cls.name)}</h1><span class="chip">${esc([cls.section, `학생 ${students}명`].filter(Boolean).join(' · '))}</span>
        <nav class="tabs"><a class="${tab === 'grid' ? 'on' : ''}" href="#/t/${cls.id}/grid">과제 현황</a><a class="${tab === 'roster' ? 'on' : ''}" href="#/t/${cls.id}/roster">학생 명단</a></nav>
        <span class="sp"></span>${actions}
      </div>` : ''}
      ${body}
    </main>
    <dialog class="sheet" id="classDlg"><form id="classForm">
      <h3>새 반 만들기</h3>
      <p class="muted small">반을 만들면 학생이 입력할 수업 코드가 바로 생겨요.</p>
      <label>반 이름<input name="name" required placeholder="예: 2학년 영어 독해"></label>
      <div class="row2"><label>학년·반<input name="section" placeholder="예: 2-3반"></label><label>과목 (선택)<input name="subject" placeholder="예: 영어"></label></div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary">만들기</button></div>
    </form></dialog>
  </div>`;
}

function bindShell() {
  $('#addClass').onclick = () => $('#classDlg').showModal();
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
    try {
      const c = await call('createClass', { name: f.get('name'), section: f.get('section'), subject: f.get('subject') });
      $('#classDlg').close();
      toast(`반을 만들었어요. 수업 코드는 ${c.code}예요`);
      location.hash = `#/t/${c.id}/roster`;
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  };
}

export async function teacherView(classId, tab) {
  const n = currentNav();
  loading('teacher');
  const classes = await call('classes');
  if (!isCurrent(n)) return;
  if (!classes.length) {
    render(shell(classes, null, 'grid', 0, `<section class="center"><div class="hero-card">
      <div class="logo"></div><h1>첫 반을 만들어 주세요</h1>
      <p class="muted">반을 만들고 학생 명단을 붙여 넣으면,<br>학생이 수업 코드와 PIN으로 참여할 수 있어요.</p>
      <button class="btn primary" id="firstClass">＋ 새 반 만들기</button></div></section>`, ''));
    bindShell();
    $('#firstClass').onclick = () => $('#classDlg').showModal();
    return;
  }
  const cls = classes.find(c => c.id === classId);
  if (!cls) return location.replace(`#/t/${classes[0].id}/grid`);
  bindEsc();
  return tab === 'roster' ? rosterTab(classes, cls, n) : gridTab(classes, cls, n);
}

// ---------- 과제 현황 ----------

async function gridTab(classes, cls, n) {
  const grid = await call('grid', { classId: cls.id });
  if (!isCurrent(n)) return;
  const sum = summarize(grid);
  const doneOf = sid => grid.works.filter(w => DONE.has((cellOf(grid, sid, w.id) || {}).state)).length;
  const next = grid.works.filter(w => w.due && dDay(w.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0];
  const nextRate = next && grid.students.length
    ? Math.round(grid.students.filter(s => cellOf(grid, s.id, next.id)).length / grid.students.length * 100) : 0;
  const li = (a, b) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`;
  const deltaHtml = sum.delta == null ? '' : sum.delta >= 0
    ? `<br>지난주보다 <span class="up">+${sum.delta}%p</span>` : `<br>지난주보다 <span class="down">${sum.delta}%p</span>`;

  const body = `
    <section class="t-bento">
      <div class="tile rate">
        <div class="ring" style="--p:${sum.rate}"><span>${sum.rate}%</span></div>
        <div><b>전체 제출률</b><p>과제 ${grid.works.length}개 · ${sum.total}건 중 ${sum.done}건 제출${deltaHtml}</p></div>
      </div>
      <div class="tile"><div class="k">미제출 <span>전체</span></div>
        <div class="big warn">${sum.total - sum.done}<small>건</small></div>
        <ul class="mini">${sum.missing.slice(0, 2).map(m => li(m.name, `${m.miss}건`)).join('')}</ul></div>
      <div class="tile"><div class="k">최근 제출</div>
        <ul class="mini">${sum.recent.slice(0, 3).map(r => li(r.student, `${r.work} · ${when(r.updated)}`)).join('') || '<li><span class="muted">아직 없어요</span></li>'}</ul></div>
      <div class="tile"><div class="k">다음 마감 <span>${next ? esc(next.title) : ''}</span></div>
        ${next ? `<div class="big">${dDay(next.due) === 0 ? 'D-day' : `D-${dDay(next.due)}`}<small>${esc(dueLabel(next.due))}</small></div>
        <div class="mbar" title="제출 ${nextRate}%"><i style="width:${nextRate}%"></i></div>` : '<div class="big">–</div>'}</div>
    </section>
    <section class="gridcard">
      <div class="gh"><h2>학생별 과제</h2>
        <div class="legend"><span><i style="background:var(--accent)"></i>제출</span><span><i style="background:var(--warn)"></i>지각</span><span><i class="dashed"></i>미제출</span></div>
        <span class="sp"></span><input class="search" id="search" type="search" placeholder="🔍 학생 검색" aria-label="학생 검색"></div>
      ${grid.works.length ? `<div class="table-wrap"><table>
        <thead><tr><th>학생</th>${grid.works.map(w => `<th>${esc(w.title)}<small>${esc(shortDue(w.due))}</small></th>`).join('')}<th>제출</th></tr></thead>
        <tbody>${grid.students.map(s => `<tr data-name="${esc(s.name)}"><td><div class="name"><span class="num">${s.number}</span>${esc(s.name)}</div></td>${grid.works.map(w => {
          const c = cellOf(grid, s.id, w.id);
          const [cls2, mark] = dotFor(c);
          return `<td><button class="dot ${cls2}" data-s="${s.id}" data-w="${w.id}" ${c ? '' : 'disabled'}
            aria-label="${esc(`${s.name} ${w.title} ${!c ? '미제출' : c.late ? '지각 제출' : '제출'}`)}">${mark}</button></td>`;
        }).join('')}<td class="cnt">${doneOf(s.id)}/${grid.works.length}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">아직 낸 과제가 없어요. 오른쪽 위 "＋ 새 과제"로 첫 과제를 내 보세요.</p>'}
    </section>
    <aside class="drawer" id="drawer" aria-label="제출 내용">
      <div class="dh"><span class="av" id="dAv"></span><div><b id="dTitle"></b><span id="dSub"></span></div><button class="x" id="dClose" aria-label="닫기">✕</button></div>
      <div class="photos" id="dPhotos"></div>
      <pre class="txt" id="dText"></pre>
      <div class="acts"><button class="btn" id="dNext">다음 학생 →</button></div>
    </aside>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="제출 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
    <dialog class="sheet" id="newDlg"><form id="newForm">
      <h3>새 과제 만들기</h3>
      <label>제목<input name="title" required placeholder="예: 3회차 독해 활동"></label>
      <label>안내<textarea name="description" rows="3" placeholder="학생에게 보일 안내 (선택)"></textarea></label>
      <div class="row2">
        <label>마감일<input type="date" name="due" value="${weekLater()}"></label>
        <label>반<select name="classId">${classes.map(c => `<option value="${c.id}" ${c.id === cls.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="create">과제 내기</button></div>
    </form></dialog>`;
  const actions = '<button class="btn" id="csv">⬇ CSV 내려받기</button><button class="btn primary" id="new">＋ 새 과제</button>';
  render(shell(classes, cls, 'grid', grid.students.length, body, actions));
  bindShell();

  // submission drawer
  const drawer = $('#drawer');
  let open = null;
  let token = 0;
  const nextWith = (sid, wid) => grid.students.slice(grid.students.findIndex(x => x.id === sid) + 1).find(x => cellOf(grid, x.id, wid));
  async function show(sid, wid) {
    const s = grid.students.find(x => x.id === sid);
    const w = grid.works.find(x => x.id === wid);
    const c = cellOf(grid, sid, wid);
    open = { sid, wid };
    $('#dAv').textContent = s.number;
    $('#dTitle').textContent = `${s.name} · ${w.title}`;
    $('#dSub').textContent = `${when(c.updated)} 제출${c.late ? ' · 지각' : ''}${c.photos ? ` · 사진 ${c.photos}장` : ''}`;
    $('#dText').textContent = c.text;
    $('#dPhotos').innerHTML = c.photos ? '<div class="sk" style="width:130px;height:170px"></div>'.repeat(c.photos) : '';
    $('#dNext').disabled = !nextWith(sid, wid);
    drawer.classList.add('open');
    if (!c.photos) return;
    const my = ++token;
    const photos = await call('photos', { subId: c.subId }).catch(() => []);
    if (my !== token || !drawer.isConnected) return;
    $('#dPhotos').innerHTML = photos.filter(p => p.startsWith('data:image/')).map((p, i) => `<img src="${esc(p)}" alt="제출 사진 ${i + 1}">`).join('')
      || '<p class="muted small">사진을 불러오지 못했어요.</p>';
  }
  if ($('table')) $('table').onclick = e => { const b = e.target.closest('button.dot'); if (b && !b.disabled) show(b.dataset.s, b.dataset.w); };
  $('#dClose').onclick = () => { drawer.classList.remove('open'); token++; };
  $('#dNext').onclick = () => { const nx = open && nextWith(open.sid, open.wid); if (nx) show(nx.id, open.wid); };
  $('#dPhotos').onclick = e => { if (e.target.tagName === 'IMG') { $('#phBig').src = e.target.src; $('#phDlg').showModal(); } };

  $('#search').oninput = e => {
    const q = e.target.value.trim();
    document.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
  };

  $('#csv').onclick = () => {
    const texts = {};
    grid.students.forEach(s => grid.works.forEach(w => { const c = cellOf(grid, s.id, w.id); if (c) (texts[s.id] ??= {})[w.id] = c.text; }));
    download(`${cls.name}.csv`, toCsv(grid, texts));
  };

  $('#new').onclick = () => $('#newDlg').showModal();
  $('#newForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#create').disabled = true;
    try {
      await call('createAssignment', { classId: f.get('classId'), title: f.get('title'), description: f.get('description'), due: f.get('due') });
      $('#newDlg').close();
    } catch (err) {
      $('#create').disabled = false;
      return toast(err.message);
    }
    toast('과제를 냈어요. 학생 앱에 바로 보여요');
    if (f.get('classId') !== cls.id) location.hash = `#/t/${f.get('classId')}/grid`;
    else teacherView(cls.id, 'grid').catch(err => toast(err.message));
  };
}

// ---------- 학생 명단 ----------

async function rosterTab(classes, cls, n) {
  const roster = await call('roster', { classId: cls.id });
  if (!isCurrent(n)) return;
  const joined = roster.filter(s => s.joined).length;
  const body = `
    <section class="r-bento">
      <div class="tile codecard">
        <div><div class="k">수업 코드</div><div class="code" id="code">${esc(cls.code)}</div></div>
        <div class="codeacts"><button id="big">⛶ 크게 보기</button><button id="copy">⧉ 복사</button><button id="regen">↻ 새 코드</button></div>
      </div>
      <div class="tile"><div class="k">참여한 학생</div><div class="big">${joined}<small>/ ${roster.length}명</small></div>
        <div class="mbar"><i style="width:${roster.length ? Math.round(joined / roster.length * 100) : 0}%"></i></div></div>
      <div class="tile"><div class="k">아직 참여 안 함</div><div class="big warn">${roster.length - joined}<small>명</small></div>
        <p class="muted small">${roster.length - joined ? 'PIN 카드를 다시 나눠 주세요' : '모두 참여했어요 🎉'}</p></div>
    </section>
    <section class="gridcard">
      <div class="gh"><h2>학생 명단</h2><span class="sp"></span><input class="search" id="search" type="search" placeholder="🔍 학생 검색" aria-label="학생 검색"></div>
      ${roster.length ? `<div class="table-wrap"><table class="roster">
        <thead><tr><th>번호</th><th>이름</th><th>PIN</th><th>참여</th><th>마지막 제출</th><th></th></tr></thead>
        <tbody>${roster.map(s => `<tr data-name="${esc(s.name)}" data-id="${s.id}">
          <td>${s.number}</td><td><div class="name">${esc(s.name)}</div></td>
          <td class="pin" data-pin="${esc(s.pin)}">••••</td>
          <td><span class="st ${s.joined ? 'ok' : 'wait'}">${s.joined ? '참여함' : '대기'}</span></td>
          <td class="muted">${s.lastSubmit ? when(s.lastSubmit) : '–'}</td>
          <td class="rowacts"><button data-act="show">PIN 보기</button><button data-act="reissue">재발급</button></td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">아직 학생이 없어요. 오른쪽 위 "＋ 명단 붙여넣기"로 학생을 추가해 주세요.</p>'}
    </section>
    <dialog class="sheet" id="pasteDlg"><form id="pasteForm">
      <h3>학생 명단 붙여넣기</h3>
      <p class="muted small">엑셀이나 나이스에서 <b>번호·이름</b> 두 칸을 복사해 붙여 넣으세요. PIN은 자동으로 만들어져요. 이미 있는 번호는 건너뛰어요.</p>
      <textarea name="text" id="pasteText" rows="8" placeholder="1&#9;강수아&#10;2&#9;김민준&#10;3&#9;박지호"></textarea>
      <div class="preview" id="pastePreview">붙여 넣으면 몇 명인지 바로 보여요</div>
      <div class="acts"><button type="button" class="btn" data-close>취소</button><button class="btn primary" id="pasteGo" disabled>추가하고 PIN 만들기</button></div>
    </form></dialog>
    <div class="board" id="board" hidden>
      <button class="x" id="boardClose">✕ 닫기 (Esc)</button>
      <div class="t">${esc([cls.name, cls.section].filter(Boolean).join(' · '))}</div>
      <div class="c">${esc(cls.code)}</div>
      <div class="u">휴대폰에서 앱을 열고 이 코드를 입력하세요</div>
    </div>
    <div class="print-cards" aria-hidden="true">${roster.map(s => `<div class="pcard"><b>${esc(cls.name)}</b><span>${esc(cls.section)} ${s.number}번 ${esc(s.name)}</span>
      <div class="pk"><small>수업 코드</small>${esc(cls.code)}</div><div class="pk"><small>PIN</small>${esc(s.pin)}</div>
      <p>${esc(location.origin + location.pathname)}</p></div>`).join('')}</div>`;
  const actions = '<button class="btn" id="print">🖨 PIN 카드 인쇄</button><button class="btn primary" id="paste">＋ 명단 붙여넣기</button>';
  render(shell(classes, cls, 'roster', roster.length, body, actions));
  bindShell();

  $('#search').oninput = e => {
    const q = e.target.value.trim();
    document.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
  };
  $('#big').onclick = () => $('#board').removeAttribute('hidden');
  $('#boardClose').onclick = () => $('#board').setAttribute('hidden', '');
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(cls.code); toast('수업 코드를 복사했어요'); } catch { toast(cls.code); }
  };
  $('#regen').onclick = async () => {
    if (!confirm('새 코드를 만들면 지금 코드로는 더 이상 참여할 수 없어요. 이미 참여한 학생은 그대로예요. 바꿀까요?')) return;
    try { cls.code = await call('newCode', { classId: cls.id }); teacherView(cls.id, 'roster'); } catch (e) { toast(e.message); }
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
    if (!confirm(`${tr.dataset.name} 학생의 PIN을 새로 만들까요? 이 학생은 새 PIN으로 다시 참여해야 해요.`)) return;
    b.disabled = true;
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
  };

  $('#paste').onclick = () => $('#pasteDlg').showModal();
  $('#pasteText').oninput = () => {
    const list = parseRoster($('#pasteText').value);
    const have = new Set(roster.map(s => s.number));
    const fresh = list.filter(s => !have.has(s.number)).length;
    $('#pastePreview').textContent = list.length ? `✓ ${list.length}명을 읽었어요 · 새로 추가 ${fresh}명 · 이미 있는 번호 ${list.length - fresh}명` : '번호와 이름을 읽지 못했어요';
    $('#pasteGo').disabled = !fresh;
    $('#pasteGo').textContent = fresh ? `${fresh}명 추가하고 PIN 만들기` : '추가하고 PIN 만들기';
  };
  $('#pasteForm').onsubmit = async e => {
    e.preventDefault();
    $('#pasteGo').disabled = true;
    try {
      const r = await call('addStudents', { classId: cls.id, text: $('#pasteText').value });
      $('#pasteDlg').close();
      toast(`${r.added}명을 추가했어요`);
      teacherView(cls.id, 'roster');
    } catch (err) {
      $('#pasteGo').disabled = false;
      toast(err.message);
    }
  };
}
