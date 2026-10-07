import { run } from './api.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, DONE, dDay, dueLabel } from './lib.js';

let cards = [];

const loadDraft = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const clearDraft = k => { try { localStorage.removeItem(k); } catch {} };

// ponytail: Korean 3-syllable names drop the surname for the greeting; anything else is shown whole.
const firstName = name => (/^[가-힣]{3}$/.test(name) ? name.slice(1) : name);
const dLabel = d => (d > 0 ? `D-${d}` : d === 0 ? 'D-day' : '마감');
const shortDate = iso => {
  const d = new Date(Date.parse(iso) + 9 * 36e5);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
const isDone = c => DONE.has(c.state);

async function loadCards() {
  const n = currentNav();
  const list = await run('listMyAssignments');
  if (!isCurrent(n)) return false;
  cards = list;
  return true;
}

function taskCard(c) {
  const done = isDone(c);
  const overdue = !done && dDay(c.due) < 0;
  return `<a class="task ${done ? 'done' : ''}" href="#/a/${c.courseId}/${c.workId}">
    <div class="row"><span class="chip">${esc(c.courseName)}</span>
      <span class="pill ${done ? 'ok' : ''}">${done ? '제출 완료' : overdue ? '마감 지남' : '미제출'}</span></div>
    <h4>${esc(c.title)}</h4>
    <div class="meta">${done ? (c.updated ? `${shortDate(c.updated)} 제출` : '제출함') : c.due ? `🗓 ${dueLabel(c.due)} 마감` : '마감일 없음'}</div>
    ${done ? '' : '<div class="cta"><span>촬영해서 제출하기</span><span>→</span></div>'}
  </a>`;
}

export async function studentHome(me) {
  loading();
  if (!(await loadCards())) return;
  const name = (me && me.name) || '';
  const course = cards[0] || (me && me.learning[0]);
  const sub = course ? [course.section, course.courseName || course.name].filter(Boolean).join(' · ') : '';
  const pending = cards.filter(c => !isDone(c)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = cards.filter(isDone);
  const next = pending.find(c => c.due && dDay(c.due) >= 0);
  const pct = cards.length ? Math.round((done.length / cards.length) * 100) : 0;

  render(`<header class="hello">
      <div><small>${esc(sub)}</small><strong>안녕하세요${name ? `, ${esc(firstName(name))}님` : ''}</strong></div>
      <div class="av" aria-hidden="true">${esc(name.slice(-2) || '나')}</div>
    </header>
    <section class="s-bento">
      <div class="tile hero"><div class="k">제출 현황</div>
        <div class="ring" style="--p:${pct}"><span>${done.length}/${cards.length}</span></div>
        <div class="k">과제 ${cards.length}개 중 ${done.length}개 완료</div></div>
      <div class="tile alert"><div class="k">미제출</div><div class="v">${pending.length}<small>건</small></div></div>
      <div class="tile due"><div class="k">다음 마감</div>
        <div class="v">${next ? dLabel(dDay(next.due)) : '–'}<small>${next ? esc(next.due.slice(5).replace('-', '.')) : ''}</small></div></div>
    </section>
    <div class="sec"><h3>진행 중</h3><span>${pending.length}</span></div>
    <div class="tasks">${pending.map(taskCard).join('') || '<p class="empty">모든 과제를 제출했어요 🎉</p>'}</div>
    ${done.length ? `<div class="sec"><h3>완료</h3><span>${done.length}</span></div><div class="tasks">${done.map(taskCard).join('')}</div>` : ''}
    ${pending[0] ? `<a class="fab" href="#/a/${pending[0].courseId}/${pending[0].workId}">📷 손글씨 촬영</a>` : ''}`);
}

// Shrinks the photo so the upload stays small (the whole submission must fit one scripts.run request).
async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.8);
  return { url, base64: url.split(',')[1] };
}

const MAX_PHOTOS = 5;
const fileInput = '<input type="file" accept="image/*" capture="environment" class="photoIn" hidden>';

export async function studentEditor(courseId, workId) {
  if (!cards.length) { loading(); if (!(await loadCards())) return; }
  const c = cards.find(x => x.courseId === courseId && x.workId === workId);
  if (!c) throw new Error('과제를 찾을 수 없어요.');
  const key = `draft:${courseId}:${workId}`;
  const draft = loadDraft(key);
  const st = { photos: [], sel: 0, ocrBase: '', token: 0, busy: false };

  render(`<div id="ev">
    <header class="topbar">
      <a href="#/" class="iconbtn" aria-label="뒤로">‹</a>
      <div class="t"><small>${esc(c.courseName)}${c.due ? ` · ${dueLabel(c.due)} 마감` : ''}</small><b>${esc(c.title)}</b></div>
      <span class="pill" id="pill"></span>
    </header>
    <div class="ed" id="ed">
      <section class="v-before">
        ${c.description ? `<div class="guide"><b>선생님 안내</b> · ${esc(c.description)}</div>` : ''}
        <label class="capzone">${fileInput}<span class="cam" aria-hidden="true">📷</span><b>손글씨 촬영하기</b>
          <span class="sub">여러 장이면 한 장씩 이어서 찍어요 (최대 ${MAX_PHOTOS}장)</span></label>
        <div class="or">또는</div>
        <button class="ghost" id="typeBtn">⌨️ 직접 입력하기</button>
      </section>
      <section class="v-reading">
        <div class="scan"><img id="scanImg" alt="읽고 있는 사진"><div class="beam"></div></div>
        <div class="reading"><div class="spin"></div><div><b>손글씨를 읽고 있어요</b><span>보통 5~10초 걸려요</span></div></div>
      </section>
      <section class="v-edit">
        <div class="strip" id="strip"></div>
        <div class="edhead"><b>읽은 글자 확인·수정</b>
          <div class="tools"><button id="undo" type="button">↺ 되돌리기</button><button id="viewPh" type="button">사진 보기</button></div></div>
        <textarea id="text" class="editor" placeholder="여기에 답을 쓰거나, 읽은 글자를 고쳐 주세요" aria-label="제출할 내용">${esc(draft)}</textarea>
      </section>
      <section class="v-done">
        <div class="chk"><span>✓</span></div>
        <h2>제출했어요!</h2>
        <p>선생님 클래스룸에 바로 올라갔어요.<br>마감 전까지 다시 제출할 수 있어요.</p>
        <div class="receipt" id="receipt"></div>
      </section>
    </div>
    <div class="dock" id="dock"></div>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="촬영한 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
  </div>`);

  const text = $('#text');
  const DOCK = {
    before: () => `<label class="main">${fileInput}📷 손글씨 촬영</label>`,
    reading: () => '<button class="sec" id="cancel" aria-label="읽기 취소">✕</button><div class="main dim">읽는 중…</div>',
    edit: () => st.busy
      ? '<div class="main dim">제출 중…</div>'
      : `${st.photos.length < MAX_PHOTOS ? `<label class="sec" aria-label="한 장 더 촬영">${fileInput}📷</label>` : ''}<button class="main" id="submit">${isDone(c) ? '다시 제출하기' : '제출하기'}</button>`,
    done: () => '<a class="main" href="#/">내 과제로 돌아가기</a>',
  };

  function setState(s) {
    $('#ed').dataset.state = s;
    $('#dock').innerHTML = DOCK[s]();
    const pill = $('#pill');
    pill.textContent = isDone(c) ? '제출 완료' : '미제출';
    pill.className = 'pill' + (isDone(c) ? ' ok' : '');
    if (s === 'edit') renderStrip();
  }
  const state = () => $('#ed').dataset.state;

  function renderStrip() {
    $('#strip').innerHTML = st.photos.map((p, i) => `
      <button class="ph ${i === st.sel ? 'on' : ''}" data-i="${i}" style="background-image:url(${p.url})" aria-label="사진 ${i + 1}">
        <span class="n">${i + 1}</span><span class="del" data-del="${i}" role="button" aria-label="사진 ${i + 1} 삭제">✕</span></button>`).join('')
      + (st.photos.length < MAX_PHOTOS ? `<label class="ph add" aria-label="사진 추가">${fileInput}＋<small>추가</small></label>` : '');
    $('#viewPh').hidden = !st.photos.length;
    $('#undo').hidden = !st.ocrBase;
  }

  async function onPhoto(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (st.photos.length >= MAX_PHOTOS) return toast(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요`);
    let shot;
    try { shot = await resizeImage(file); } catch { return toast('사진을 열 수 없어요. 다시 촬영해 주세요'); }
    st.photos.push(shot);
    st.sel = st.photos.length - 1;
    $('#scanImg').src = shot.url;
    setState('reading');
    const my = ++st.token;
    let t = '';
    try { t = await run('ocr', shot.base64, 'image/jpeg'); } catch { toast('글자를 읽지 못했어요. 사진은 그대로 두고 직접 입력해 주세요'); }
    if (my !== st.token || !text.isConnected) return; // cancelled or navigated away
    if (t) {
      text.value = text.value.trim() ? `${text.value}\n\n${t}` : t;
      st.ocrBase = text.value;
      saveDraft(key, text.value);
    }
    setState('edit');
  }

  $('#ev').onchange = e => { if (e.target.matches('.photoIn')) onPhoto(e.target); };
  $('#ev').onclick = async e => {
    const t = e.target;
    if (t.closest('#typeBtn')) { setState('edit'); text.focus(); }
    else if (t.closest('#cancel')) {
      st.token++;
      st.photos.pop();
      st.sel = Math.max(0, st.photos.length - 1);
      setState(st.photos.length || text.value.trim() ? 'edit' : 'before');
    } else if (t.closest('[data-del]')) {
      e.preventDefault();
      st.photos.splice(+t.closest('[data-del]').dataset.del, 1);
      st.sel = Math.min(st.sel, Math.max(0, st.photos.length - 1));
      setState('edit');
    } else if (t.closest('.ph[data-i]')) {
      st.sel = +t.closest('.ph[data-i]').dataset.i;
      renderStrip();
    } else if (t.closest('#undo')) {
      text.value = st.ocrBase;
      saveDraft(key, text.value);
    } else if (t.closest('#viewPh') && st.photos[st.sel]) {
      $('#phBig').src = st.photos[st.sel].url;
      $('#phDlg').showModal();
    } else if (t.closest('#submit')) {
      const body = text.value.trim();
      if (!body) { toast('제출할 내용을 입력해 주세요'); return text.focus(); }
      st.busy = true;
      setState('edit');
      try {
        await run('submit', courseId, workId, c.title, body, st.photos.map(p => p.base64));
        clearDraft(key);
        c.state = 'TURNED_IN';
        const now = new Date();
        const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        $('#receipt').innerHTML = `<div><span>과제</span><b>${esc(c.title)}</b></div>
          <div><span>제출 시각</span><b>${now.getMonth() + 1}월 ${now.getDate()}일 ${hm}</b></div>
          <div><span>첨부</span><b>글 1개${st.photos.length ? ` · 사진 ${st.photos.length}장` : ''}</b></div>`;
        st.busy = false;
        setState('done');
      } catch (err) {
        st.busy = false;
        setState('edit');
        toast(err.message);
      }
    }
  };
  text.oninput = () => saveDraft(key, text.value);

  setState(draft ? 'edit' : 'before');
}
