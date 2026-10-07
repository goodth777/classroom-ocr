import { call } from './api.js';
import { store } from './store.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, dDay, dueLabel } from './lib.js';

let me = null;

// ponytail: Korean 3-syllable names drop the surname for the greeting; anything else is shown whole.
const firstName = name => (/^[가-힣]{3}$/.test(name) ? name.slice(1) : name);
const dLabel = d => (d > 0 ? `D-${d}` : d === 0 ? 'D-day' : '마감');
const shortDate = iso => {
  const d = new Date(Date.parse(iso) + 9 * 36e5);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
const isDone = a => a.state === 'TURNED_IN';

async function loadMe() {
  const n = currentNav();
  const data = await call('me');
  if (!isCurrent(n)) return false;
  me = data;
  return true;
}

function taskCard(a) {
  const done = isDone(a);
  const overdue = !done && dDay(a.due) < 0;
  return `<a class="task ${done ? 'done' : ''}" href="#/a/${a.id}">
    <div class="row"><span class="chip">${esc(me.cls.name)}</span>
      <span class="pill ${done ? 'ok' : ''}">${done ? (a.late ? '늦게 제출' : '제출 완료') : overdue ? '마감 지남' : '미제출'}</span></div>
    <h4>${esc(a.title)}</h4>
    <div class="meta">${done ? `${shortDate(a.updated)} 제출` : a.due ? `🗓 ${dueLabel(a.due)} 마감` : '마감일 없음'}</div>
    ${done ? '' : '<div class="cta"><span>촬영해서 제출하기</span><span>→</span></div>'}
  </a>`;
}

export async function studentHome() {
  loading('home');
  if (!(await loadMe())) return;
  const list = me.assignments;
  const pending = list.filter(a => !isDone(a)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = list.filter(isDone).sort((a, b) => b.updated.localeCompare(a.updated));
  const next = pending.find(a => a.due && dDay(a.due) >= 0);
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
  const name = me.student.name;

  render(`<header class="hello">
      <div><small>${esc([me.cls.section, me.cls.name].filter(Boolean).join(' · '))}</small><strong>안녕하세요, ${esc(firstName(name))}님</strong></div>
      <button class="av" id="profile" aria-label="내 정보">${esc(name.slice(-2))}</button>
    </header>
    <section class="s-bento">
      <div class="tile hero"><div class="k">제출 현황</div>
        <div class="ring" style="--p:${pct}"><span>${done.length}/${list.length}</span></div>
        <div class="k">과제 ${list.length}개 중 ${done.length}개 완료</div></div>
      <div class="tile alert"><div class="k">미제출</div><div class="v">${pending.length}<small>건</small></div></div>
      <div class="tile due"><div class="k">다음 마감</div>
        <div class="v">${next ? dLabel(dDay(next.due)) : '–'}<small>${next ? esc(next.due.slice(5).replace('-', '.')) : ''}</small></div></div>
    </section>
    <div class="sec"><h3>진행 중</h3><span>${pending.length}</span></div>
    <div class="tasks">${pending.map(taskCard).join('') || `<p class="empty">${list.length ? '모든 과제를 제출했어요 🎉' : '아직 받은 과제가 없어요'}</p>`}</div>
    ${done.length ? `<div class="sec"><h3>완료</h3><span>${done.length}</span></div><div class="tasks">${done.map(taskCard).join('')}</div>` : ''}
    ${pending[0] ? `<a class="fab" href="#/a/${pending[0].id}">📷 손글씨 촬영</a>` : ''}
    <dialog class="sheet menu" id="menu">
      <div class="menu-head"><div class="av">${esc(name.slice(-2))}</div><div><b>${esc(name)}</b><span>${esc([me.cls.name, me.cls.section, me.student.number + '번'].filter(Boolean).join(' · '))}</span></div></div>
      <button class="ghost danger" id="leave">이 기기에서 나가기</button>
      <p class="muted small">나가면 다음에 수업 코드와 PIN을 다시 입력해야 해요.</p>
      <form method="dialog"><button class="ghost">닫기</button></form>
    </dialog>`);

  $('#profile').onclick = () => $('#menu').showModal();
  $('#leave').onclick = async () => {
    $('#leave').disabled = true;
    try { await call('leave', { token: store.token() }); } catch {} // leaving locally is enough if the server is unreachable
    store.clearToken();
    location.hash = '#/join';
  };
}

// Shrinks the photo so uploads stay small (one submission carries all photos).
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
const SLOW_MS = 15000;
const fileInput = '<input type="file" accept="image/*" capture="environment" class="photoIn" hidden>';
const stepRow = (state, label) => `<div class="st ${state}"><span class="d">${state === 'done' ? '✓' : ''}</span>${label}</div>`;
const STATUS = { wait: '대기', run: '읽는 중', ok: '✓ 완료', fail: '다시 읽기' };

export async function studentEditor(id) {
  if (!me) { loading('page'); if (!(await loadMe())) return; }
  const a = me.assignments.find(x => x.id === id);
  if (!a) throw new Error('과제를 찾을 수 없어요.');
  const draft = store.draft(a.id) || a.text || '';
  // photos: {url, base64, status: wait|run|ok|fail}; reading runs one at a time in photo order, so text is appended in order too.
  const st = { photos: [], sel: 0, ocrBase: '', busy: false, view: draft ? 'edit' : 'before', reading: null };

  render(`<div id="ev">
    <header class="topbar">
      <a href="#/home" class="iconbtn" aria-label="뒤로">‹</a>
      <div class="t"><small>${esc(me.cls.name)}${a.due ? ` · ${dueLabel(a.due)} 마감` : ''}</small><b>${esc(a.title)}</b></div>
      <span class="pill" id="pill"></span>
    </header>
    <div class="ed" id="ed">
      <section class="v-before">
        ${a.description ? `<div class="guide"><b>선생님 안내</b> · ${esc(a.description)}</div>` : ''}
        <label class="capzone">${fileInput}<span class="cam" aria-hidden="true">📷</span><b>손글씨 촬영하기</b>
          <span class="sub">여러 장이면 한 장씩 이어서 찍어요 (최대 ${MAX_PHOTOS}장)</span></label>
        <div class="or">또는</div>
        <button class="ghost" id="typeBtn">⌨️ 직접 입력하기</button>
      </section>
      <section class="v-reading">
        <div class="scan" id="scan"><img id="scanImg" alt="읽고 있는 사진"><div class="beam"></div></div>
        <div class="progress">
          <div class="ptitle"><b id="rTitle"></b><span id="rSec">0초</span></div>
          <div class="bar"><i id="rBar"></i></div>
          <div class="steps-list" id="rSteps"></div>
        </div>
        <div class="slow" id="rSlow" hidden>⏳ <span>지금 친구들이 한꺼번에 올리고 있어서 조금 늦어지고 있어요. <b>앱을 닫지 말고</b> 그대로 기다려 주세요. 사진은 안전하게 받아 두었어요.</span></div>
        <p class="tip" id="rTip">보통 10초 안에 끝나요. 화면을 닫지 말고 기다려 주세요.</p>
      </section>
      <section class="v-edit">
        <div class="strip" id="strip"></div>
        <div class="queue" id="queue" hidden></div>
        <div class="edhead"><b>읽은 글자 확인·수정</b>
          <div class="tools"><button id="undo" type="button">↺ 되돌리기</button><button id="viewPh" type="button">사진 보기</button></div></div>
        <div class="edwrap">
          <textarea id="text" class="editor" placeholder="여기에 답을 쓰거나, 읽은 글자를 고쳐 주세요" aria-label="제출할 내용">${esc(draft)}</textarea>
          <div class="ghosts" id="ghosts" hidden aria-hidden="true"><span style="width:92%"></span><span style="width:78%"></span><span style="width:85%"></span></div>
        </div>
      </section>
      <section class="v-error">
        <div class="err-ic">📡</div><h2>연결이 잠시 끊겼어요</h2>
        <p>와이파이나 데이터를 확인한 뒤<br>다시 시도해 주세요.</p>
        <div class="keep" id="keep"></div>
      </section>
      <section class="v-done">
        <div class="chk"><span>✓</span></div>
        <h2>제출했어요!</h2>
        <p>선생님께 바로 전달됐어요.<br>마감 전까지 다시 제출할 수 있어요.</p>
        <div class="receipt" id="receipt"></div>
      </section>
    </div>
    <div class="overlay" id="sending" hidden>
      <div class="orb" id="orb"><span id="pct">0%</span></div>
      <h2>제출하고 있어요</h2><p>선생님께 보내는 중이에요.<br>잠깐이면 돼요.</p>
      <div class="steps-list" id="sSteps"></div>
    </div>
    <div class="dock" id="dock"></div>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="촬영한 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
  </div>`);

  const text = $('#text');
  const pending = () => st.photos.some(p => p.status === 'wait' || p.status === 'run');
  const DOCK = {
    before: () => `<label class="main">${fileInput}📷 손글씨 촬영</label>`,
    reading: () => '<button class="sec small" id="cancel">취소</button><div class="main dim">읽는 중…</div>',
    edit: () => `${st.photos.length < MAX_PHOTOS ? `<label class="sec" aria-label="한 장 더 촬영">${fileInput}📷</label>` : ''}${pending()
      ? '<div class="main dim">사진을 다 읽으면 제출할 수 있어요</div>'
      : `<button class="main" id="submit">${isDone(a) ? '다시 제출하기' : '제출하기'}</button>`}`,
    error: () => '<button class="main" id="retry">다시 시도</button>',
    done: () => '<a class="main" href="#/home">내 과제로 돌아가기</a>',
  };

  function show(view) {
    st.view = view;
    $('#ed').dataset.state = view;
    $('#dock').innerHTML = DOCK[view]();
    $('#pill').textContent = isDone(a) ? '제출 완료' : '미제출';
    $('#pill').className = 'pill' + (isDone(a) ? ' ok' : '');
    if (view === 'edit') paintEdit();
  }

  function paintEdit() {
    $('#strip').innerHTML = st.photos.map((p, i) => `
      <button class="ph ${p.status} ${i === st.sel ? 'on' : ''}" data-i="${i}" style="background-image:url(${p.url})" aria-label="사진 ${i + 1} ${STATUS[p.status]}">
        <span class="n">${i + 1}</span><span class="s">${STATUS[p.status]}</span>
        <span class="del" data-del="${i}" role="button" aria-label="사진 ${i + 1} 삭제">✕</span></button>`).join('')
      + (st.photos.length < MAX_PHOTOS ? `<label class="ph add" aria-label="사진 추가">${fileInput}＋<small>추가</small></label>` : '');
    const runIdx = st.photos.findIndex(p => p.status === 'run');
    const left = st.photos.filter(p => p.status === 'wait' || p.status === 'run').length;
    $('#queue').hidden = runIdx < 0;
    if (runIdx >= 0) {
      const ok = st.photos.filter(p => p.status === 'ok').length;
      $('#queue').innerHTML = `<div class="spin"></div><div><b>${runIdx + 1}번 사진을 읽고 있어요</b><span>${ok}장 완료 · ${left}장 남음 · 그동안 위의 글을 고쳐도 돼요</span></div>`;
    }
    $('#ghosts').hidden = !left;
    $('#text').classList.toggle('waiting', !!left);
    if (st.view === 'edit') $('#dock').innerHTML = DOCK.edit();
    $('#viewPh').hidden = !st.photos.length;
    $('#undo').hidden = !st.ocrBase;
  }

  // Full-screen reading view for the first photo: staged steps, estimated bar, elapsed time, slow notice.
  function startReadingView(photo) {
    $('#scanImg').src = photo.url;
    $('#scan').querySelectorAll('.found').forEach(f => f.remove());
    const t0 = Date.now();
    let stage = 0;
    let retry = 0;
    const labels = ['사진 올리기', '글자 찾기', '읽은 글 정리하기'];
    const titles = ['사진을 올리고 있어요', '손글씨에서 글자를 찾고 있어요', '읽은 글을 정리하고 있어요'];
    const paint = () => {
      $('#rTitle').textContent = titles[stage];
      $('#rSteps').innerHTML = labels.map((l, i) => stepRow(i < stage ? 'done' : i === stage ? 'now' : '',
        i === 1 && retry ? `${l} · 자동으로 다시 시도 중 (${retry}/2)` : l)).join('');
    };
    paint();
    const tick = setInterval(() => {
      if (!$('#rSec')) return clearInterval(tick);
      const ms = Date.now() - t0;
      $('#rSec').textContent = Math.floor(ms / 1000) + '초';
      if (stage === 0 && ms > 1500) { stage = 1; paint(); }
      // ponytail: Drive OCR reports no progress, so the bar eases toward 90% and jumps to 100% on the answer.
      $('#rBar').style.width = Math.min(90, 12 + (ms / 10000) * 78) + '%';
      const slow = ms > SLOW_MS;
      $('#rSlow').hidden = !slow;
      $('#rTip').hidden = slow;
      if (stage === 1 && ms % 900 < 250 && $('#scan').querySelectorAll('.found').length < 6) {
        const f = document.createElement('div');
        const k = $('#scan').querySelectorAll('.found').length;
        f.className = 'found';
        f.style.cssText = `top:${9 + k * 14}%;width:${55 + (k * 13) % 30}%`;
        $('#scan').append(f);
      }
    }, 250);
    st.reading = {
      onRetry: n => { retry = n; paint(); },
      finish: () => { clearInterval(tick); stage = 2; paint(); $('#rBar').style.width = '100%'; },
      stop: () => clearInterval(tick),
    };
  }

  async function pump() {
    if (st.photos.some(p => p.status === 'run')) return;
    const p = st.photos.find(x => x.status === 'wait');
    if (!p) return;
    p.status = 'run';
    const full = st.view === 'before' || st.view === 'reading';
    if (full) { show('reading'); startReadingView(p); } else paintEdit();
    let t = null;
    let failed = false;
    try {
      t = (await call('ocr', { image: p.base64 }, { onRetry: n => st.reading && st.reading.onRetry(n) })).text;
    } catch {
      failed = true;
    }
    if (!text.isConnected || p.status === 'cancel') return; // left the screen or cancelled
    p.status = failed ? 'fail' : 'ok';
    if (failed) toast('글자를 읽지 못했어요. 사진은 그대로 두었으니 직접 입력하거나 사진을 눌러 다시 읽어 주세요.');
    if (st.reading) { st.reading.finish(); st.reading = null; await new Promise(r => setTimeout(r, 350)); }
    if (t) {
      text.value = text.value.trim() ? `${text.value.trim()}\n\n${t}` : t;
      st.ocrBase = text.value;
      store.setDraft(a.id, text.value);
    }
    show('edit');
    pump();
  }

  async function addPhoto(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (st.photos.length >= MAX_PHOTOS) return toast(`사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요`);
    let shot;
    try { shot = await resizeImage(file); } catch { return toast('사진을 열 수 없어요. 다시 촬영해 주세요'); }
    st.photos.push({ ...shot, status: 'wait' });
    st.sel = st.photos.length - 1;
    if (st.view === 'edit') paintEdit();
    pump();
  }

  async function send() {
    const body = text.value.trim();
    if (!body) { toast('제출할 내용을 입력해 주세요'); return text.focus(); }
    const photos = st.photos.filter(p => p.status !== 'cancel');
    $('#sending').hidden = false;
    $('#dock').innerHTML = '';
    const labels = ['글 저장하기', photos.length ? `사진 ${photos.length}장 올리기` : '확인하기', '선생님께 전달하기'];
    const t0 = Date.now();
    const est = 2500 + photos.length * 1500;
    const tick = setInterval(() => {
      const p = Math.min(92, ((Date.now() - t0) / est) * 92);
      const k = p < 25 ? 0 : p < 80 ? 1 : 2;
      $('#orb').style.setProperty('--p', p + '%');
      $('#pct').textContent = Math.round(p) + '%';
      $('#sSteps').innerHTML = labels.map((l, i) => stepRow(i < k ? 'done' : i === k ? 'now' : '', l)).join('');
    }, 120);
    try {
      const r = await call('submit', { assignmentId: a.id, text: body, photos: photos.map(p => p.base64) });
      clearInterval(tick);
      $('#orb').style.setProperty('--p', '100%');
      $('#pct').textContent = '100%';
      store.clearDraft(a.id);
      Object.assign(a, { state: 'TURNED_IN', updated: r.submittedAt, late: r.late, text: body });
      const d = new Date(r.submittedAt);
      $('#receipt').innerHTML = `<div><span>과제</span><b>${esc(a.title)}</b></div>
        <div><span>제출 시각</span><b>${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${r.late ? ' (마감 후)' : ''}</b></div>
        <div><span>첨부</span><b>글 1개${photos.length ? ` · 사진 ${photos.length}장` : ''}</b></div>`;
      if (navigator.vibrate) navigator.vibrate(60);
      await new Promise(r2 => setTimeout(r2, 300));
      $('#sending').hidden = true;
      show('done');
    } catch (e) {
      clearInterval(tick);
      $('#sending').hidden = true;
      if (e.code === 'offline') {
        $('#keep').textContent = `✓ 쓴 글${photos.length ? `과 사진 ${photos.length}장은` : '은'} 이 휴대폰에 그대로 있어요`;
        show('error');
      } else {
        show('edit');
        toast(e.message);
      }
    }
  }

  $('#ev').onchange = e => { if (e.target.matches('.photoIn')) addPhoto(e.target); };
  $('#ev').onclick = e => {
    const t = e.target;
    if (t.closest('#typeBtn')) { show('edit'); text.focus(); }
    else if (t.closest('#cancel')) {
      const p = st.photos.find(x => x.status === 'run');
      if (p) p.status = 'cancel';
      st.photos = st.photos.filter(x => x.status !== 'cancel');
      if (st.reading) { st.reading.stop(); st.reading = null; }
      show(st.photos.length || text.value.trim() ? 'edit' : 'before');
      pump();
    } else if (t.closest('[data-del]')) {
      e.preventDefault();
      const i = +t.closest('[data-del]').dataset.del;
      if (st.photos[i].status === 'run') return toast('읽는 중인 사진은 다 읽은 뒤에 지울 수 있어요');
      st.photos.splice(i, 1);
      st.sel = Math.min(st.sel, Math.max(0, st.photos.length - 1));
      toast('읽은 글은 편집 칸에 남아 있어요. 필요 없으면 직접 지워 주세요');
      show('edit');
    } else if (t.closest('.ph[data-i]')) {
      const i = +t.closest('.ph[data-i]').dataset.i;
      if (st.photos[i].status === 'fail') { st.photos[i].status = 'wait'; paintEdit(); pump(); return; }
      st.sel = i;
      paintEdit();
    } else if (t.closest('#undo')) {
      text.value = st.ocrBase;
      store.setDraft(a.id, text.value);
    } else if (t.closest('#viewPh') && st.photos[st.sel]) {
      $('#phBig').src = st.photos[st.sel].url;
      $('#phDlg').showModal();
    } else if (t.closest('#submit') || t.closest('#retry')) send();
  };
  text.oninput = () => store.setDraft(a.id, text.value);

  show(st.view);
}
