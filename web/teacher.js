import { run } from './api.js';
import { render, loading, $ } from './ui.js';
import { esc, stateLabel, DONE, summarize, toCsv } from './lib.js';

export function teacherHome(me) {
  render(`<header class="bar"><h1>내 수업</h1></header>
    <section class="cards">${me.teaching.map(c => `
      <a class="card task" href="#/t/${c.id}">
        ${c.section ? `<span class="chip">${esc(c.section)}</span>` : ''}
        <h2>${esc(c.name)}</h2>
      </a>`).join('')}
    </section>`);
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const cellOf = (grid, sid, wid) => (grid.cells[sid] || {})[wid];

export async function teacherCourse(courseId, me) {
  loading();
  const course = me.teaching.find(c => c.id === courseId);
  if (!course) throw new Error('수업을 찾을 수 없어요.');
  const grid = await run('getGrid', courseId);
  const sum = summarize(grid);
  const li = (a, b) => `<li><span>${esc(a)}</span><span class="muted">${esc(b)}</span></li>`;

  render(`<header class="bar"><a href="#/" class="back" aria-label="뒤로">‹</a>
      <h1>${esc(course.name)}</h1><button id="new" class="primary">+ 과제</button></header>
    <section class="bento">
      <div class="card stat"><span class="muted">제출률</span><strong>${sum.rate}%</strong></div>
      <div class="card"><h2>미제출</h2><ul>${sum.missing.slice(0, 5).map(m => li(m.name, `${m.miss}건`)).join('') || '<li class="muted">없음</li>'}</ul></div>
      <div class="card"><h2>최근 제출</h2><ul>${sum.recent.map(r => li(r.student, r.work)).join('') || '<li class="muted">없음</li>'}</ul></div>
      <div class="card wide">
        <div class="grid-head"><h2>학생별 과제</h2><button id="csv">CSV 내려받기</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>학생</th>${grid.works.map(w => `<th>${w.link ? `<a href="${esc(w.link)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title)}${w.app ? '' : '<span class="tag">클래스룸</span>'}</th>`).join('')}</tr></thead>
          <tbody>${grid.students.map(s => `<tr><td>${esc(s.name)}</td>${grid.works.map(w => {
            const c = cellOf(grid, s.id, w.id);
            const ok = c && DONE.has(c.state);
            return `<td><button class="cell ${ok ? 'ok' : 'no'}" data-s="${s.id}" data-w="${w.id}" ${c && c.docId ? '' : 'disabled'}
              aria-label="${esc(`${s.name} ${w.title} ${stateLabel(c)}`)}">${ok ? '●' : '○'}</button></td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>
    </section>
    <dialog id="detail"></dialog>
    <dialog id="newDlg"><form id="newForm">
      <h2>새 과제</h2>
      <input type="text" name="title" placeholder="제목" required>
      <textarea name="description" rows="4" placeholder="안내 (선택)"></textarea>
      <button class="primary">만들기</button>
      <button type="button" id="cancel">취소</button>
    </form></dialog>`);

  $('table').onclick = async e => {
    const b = e.target.closest('button.cell');
    if (!b || b.disabled) return;
    const s = grid.students.find(x => x.id === b.dataset.s);
    const w = grid.works.find(x => x.id === b.dataset.w);
    const c = cellOf(grid, s.id, w.id);
    const dlg = $('#detail');
    dlg.innerHTML = '<p class="muted">불러오는 중…</p>';
    dlg.showModal();
    const text = await run('getText', c.docId).catch(() => null);
    dlg.innerHTML = `<h2>${esc(s.name)} · ${esc(w.title)}</h2>
      ${text != null ? `<pre>${esc(text)}</pre>` : ''}
      <p><a href="${esc(c.link)}" target="_blank" rel="noopener">원본 열기</a></p>
      <form method="dialog"><button>닫기</button></form>`;
  };

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
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'CSV 내려받기';
    }
  };

  $('#new').onclick = () => $('#newDlg').showModal();
  $('#cancel').onclick = () => $('#newDlg').close();
  $('#newForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    e.target.querySelector('.primary').disabled = true;
    try {
      await run('createAssignment', courseId, f.get('title').trim(), f.get('description').trim());
      $('#newDlg').close();
    } catch (err) {
      e.target.querySelector('.primary').disabled = false;
      alert(err.message);
      return;
    }
    await teacherCourse(courseId, me);
  };
}
