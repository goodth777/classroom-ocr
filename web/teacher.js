import { run } from './api.js';
import { render, loading, $, fail, toast, currentNav, isCurrent } from './ui.js';
import { esc, stateLabel, DONE, summarize, toCsv, dDay, dueLabel } from './lib.js';

// Teachers land straight on their first course; the sidebar switches between courses.
export function teacherHome(me) {
  location.replace(`#/t/${me.teaching[0].id}`);
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

const cellOf = (grid, sid, wid) => (grid.cells[sid] || {})[wid];
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

function dotFor(c) {
  if (!c || !DONE.has(c.state)) return ['no', ''];
  if (c.state === 'RETURNED') return ['ret', '↩'];
  return c.late ? ['late', '!'] : ['ok', '✓'];
}

let escBound = false;

export async function teacherCourse(courseId, me) {
  const n = currentNav();
  loading();
  const course = me.teaching.find(c => c.id === courseId);
  if (!course) throw new Error('수업을 찾을 수 없어요.');
  const grid = await run('getGrid', courseId);
  if (!isCurrent(n)) return;
  const sum = summarize(grid);
  const doneOf = sid => grid.works.filter(w => DONE.has((cellOf(grid, sid, w.id) || {}).state)).length;
  const next = grid.works.filter(w => w.due && dDay(w.due) >= 0).sort((a, b) => a.due.localeCompare(b.due))[0];
  const nextRate = next && grid.students.length
    ? Math.round(grid.students.filter(s => DONE.has((cellOf(grid, s.id, next.id) || {}).state)).length / grid.students.length * 100) : 0;
  const li = (a, b) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`;
  const deltaHtml = sum.delta == null ? '' : sum.delta >= 0
    ? `<br>지난주보다 <span class="up">+${sum.delta}%p</span>` : `<br>지난주보다 <span class="down">${sum.delta}%p</span>`;

  render(`<div class="t-layout">
    <aside class="side">
      <div class="brand"><i></i><span>과제 제출</span></div>
      <div class="lab">내 수업</div>
      ${me.teaching.map(c => `<a class="course ${c.id === courseId ? 'on' : ''}" href="#/t/${c.id}">${esc(c.name)}<small>${esc(c.section)}</small></a>`).join('')}
      <div class="me"><div class="av">T</div><div><b>${esc(me.name || '선생님')}</b><span>교사</span></div></div>
    </aside>
    <main class="tmain">
      <div class="thead">
        <h1>${esc(course.name)}</h1><span class="chip">${esc([course.section, `학생 ${grid.students.length}명`].filter(Boolean).join(' · '))}</span>
        <span class="sp"></span>
        <button class="btn" id="csv">⬇ CSV 내려받기</button>
        <button class="btn primary" id="new">＋ 새 과제</button>
      </div>
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
          <div class="legend"><span><i style="background:var(--accent)"></i>제출</span><span><i style="background:var(--warn)"></i>지각</span><span><i style="border:1.5px dashed #556;width:7px;height:7px"></i>미제출</span></div>
          <span class="sp"></span><input class="search" id="search" type="search" placeholder="🔍 학생 검색" aria-label="학생 검색"></div>
        <div class="table-wrap"><table>
          <thead><tr><th>학생</th>${grid.works.map(w => `<th>${w.link ? `<a href="${esc(w.link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title)}${w.app ? '' : '<span class="tag">클래스룸</span>'}<small>${esc(shortDue(w.due))}</small></th>`).join('')}<th>제출</th></tr></thead>
          <tbody>${grid.students.map(s => `<tr data-name="${esc(s.name)}"><td><div class="name"><span class="av">${esc(s.name.slice(0, 1))}</span>${esc(s.name)}</div></td>${grid.works.map(w => {
            const c = cellOf(grid, s.id, w.id);
            const [cls, mark] = dotFor(c);
            return `<td><button class="dot ${cls}" data-s="${s.id}" data-w="${w.id}" ${c && c.docId ? '' : 'disabled'}
              aria-label="${esc(`${s.name} ${w.title} ${c && c.late && DONE.has(c.state) ? '지각 제출' : stateLabel(c)}`)}">${mark}</button></td>`;
          }).join('')}<td class="cnt">${doneOf(s.id)}/${grid.works.length}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>
    </main>
    <aside class="drawer" id="drawer" aria-label="제출 내용">
      <div class="dh"><span class="av" id="dAv"></span><div><b id="dTitle"></b><span id="dSub"></span></div><button class="x" id="dClose" aria-label="닫기">✕</button></div>
      <div class="photos" id="dPhotos"></div>
      <pre class="txt" id="dText"></pre>
      <div class="acts"><a class="btn" id="dOpen" target="_blank" rel="noopener">원본 문서 열기 ↗</a><button class="btn" id="dNext">다음 학생 →</button></div>
    </aside>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="제출 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
    <dialog class="sheet" id="newDlg"><form id="newForm">
      <h3>새 과제 만들기</h3>
      <label>제목<input name="title" required placeholder="예: 3회차 독해 활동"></label>
      <label>안내<textarea name="description" rows="3" placeholder="학생에게 보일 안내 (선택)"></textarea></label>
      <div class="row2">
        <label>마감일<input type="date" name="due" value="${weekLater()}"></label>
        <label>수업<select name="course">${me.teaching.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="acts"><button type="button" class="btn" id="cancel">취소</button><button class="btn primary" id="create">클래스룸에 올리기</button></div>
    </form></dialog>
  </div>`);

  // --- submission drawer ---
  let open = null;
  let token = 0;
  const drawer = $('#drawer');
  async function show(sid, wid) {
    const s = grid.students.find(x => x.id === sid);
    const w = grid.works.find(x => x.id === wid);
    const c = cellOf(grid, sid, wid);
    open = { sid, wid };
    $('#dAv').textContent = s.name.slice(0, 1);
    $('#dTitle').textContent = `${s.name} · ${w.title}`;
    $('#dSub').textContent = `${c.updated ? `${when(c.updated)} 제출` : '제출'}${c.late ? ' · 지각' : ''}`;
    $('#dPhotos').innerHTML = '';
    $('#dText').textContent = '불러오는 중…';
    $('#dOpen').href = c.link || '#';
    $('#dOpen').hidden = !c.link;
    $('#dNext').disabled = !nextWithDoc(sid, wid);
    drawer.classList.add('open');
    const my = ++token;
    const sub = await run('getSubmission', c.docId).catch(() => ({ text: null, photos: [] }));
    if (my !== token || !drawer.isConnected) return;
    $('#dPhotos').innerHTML = sub.photos.filter(p => p.startsWith('data:image/'))
      .map((p, i) => `<img src="${esc(p)}" alt="제출 사진 ${i + 1}">`).join('');
    $('#dText').textContent = sub.text ?? '글을 불러오지 못했어요. 원본 문서를 열어 확인해 주세요.';
  }
  function nextWithDoc(sid, wid) {
    const i = grid.students.findIndex(x => x.id === sid);
    return grid.students.slice(i + 1).find(x => (cellOf(grid, x.id, wid) || {}).docId);
  }
  const close = () => { drawer.classList.remove('open'); open = null; token++; };

  $('table').onclick = e => {
    const b = e.target.closest('button.dot');
    if (b && !b.disabled) show(b.dataset.s, b.dataset.w);
  };
  $('#dClose').onclick = close;
  $('#dNext').onclick = () => { const nx = open && nextWithDoc(open.sid, open.wid); if (nx) show(nx.id, open.wid); };
  $('#dPhotos').onclick = e => {
    if (e.target.tagName !== 'IMG') return;
    $('#phBig').src = e.target.src;
    $('#phDlg').showModal();
  };
  if (!escBound) {
    escBound = true;
    document.addEventListener('keydown', e => {
      const d = document.getElementById('drawer');
      if (e.key === 'Escape' && d && d.classList.contains('open') && !document.querySelector('dialog[open]')) d.classList.remove('open');
    });
  }

  // --- search ---
  $('#search').oninput = e => {
    const q = e.target.value.trim();
    document.querySelectorAll('tbody tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.name.includes(q); });
  };

  // --- CSV ---
  $('#csv').onclick = async () => {
    const btn = $('#csv');
    btn.disabled = true;
    btn.textContent = '내려받는 중…';
    try {
      const texts = {};
      // One call per assignment column keeps each GAS run well under its time limit.
      for (const w of grid.works) {
        const got = await run('getTexts', grid.students.map(s => (cellOf(grid, s.id, w.id) || {}).docId || null));
        grid.students.forEach((s, i) => { if (got[i] != null) (texts[s.id] ??= {})[w.id] = got[i]; });
      }
      download(`${course.name}.csv`, toCsv(grid, texts));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ CSV 내려받기';
    }
  };

  // --- new assignment ---
  $('#new').onclick = () => $('#newDlg').showModal();
  $('#cancel').onclick = () => { $('#newForm').reset(); $('#newDlg').close(); };
  $('#newForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const target = f.get('course');
    $('#create').disabled = true;
    try {
      await run('createAssignment', target, f.get('title').trim(), f.get('description').trim(), f.get('due'));
      $('#newDlg').close();
    } catch (err) {
      $('#create').disabled = false;
      toast(err.message);
      return;
    }
    toast('클래스룸에 과제를 올렸어요');
    if (target !== courseId) { location.hash = `#/t/${target}`; return; }
    try {
      await teacherCourse(courseId, me);
    } catch (err) {
      fail(err);
    }
  };
}
