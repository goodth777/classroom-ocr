import { call } from './api.js';
import { store } from './store.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, dDay, dueLabel } from './lib.js';
import * as outbox from './outbox.js';
import { homeIcons, homeNotice } from './inbox.js';
import { pushState, prefs, enablePush, disablePush, setPrefs, pushToken } from './push.js';
import { quiet } from './api.js';

let me = null;

// ponytail: Korean 3-syllable names drop the surname for the greeting; anything else is shown whole.
const firstName = name => (/^[가-힣]{3}$/.test(name) ? name.slice(1) : name);
const dLabel = d => (d > 0 ? `D-${d}` : d === 0 ? 'D-day' : '마감');
const shortDate = iso => {
  const d = new Date(Date.parse(iso) + 9 * 36e5);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
const isDone = a => a.state === 'TURNED_IN';

// What the student should see, folding in submissions still waiting in the outbox.
function stateOf(a) {
  const q = outbox.forAssignment(a.id);
  if (q) return q.status === 'fail' ? 'fail' : 'sending';
  return isDone(a) ? 'done' : 'todo';
}
const attach = q => `글 1개${q.photos.length ? ` · 사진 ${q.photos.length}장` : ''}`;
const hm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// The card on the "제출했어요" screen follows its outbox item: sending → delivered / failed.
function paintSend(item, state, extra = {}) {
  const el = document.getElementById('sendcard');
  if (!el || el.dataset.id !== item.id) return;
  if (state === 'ok') {
    el.innerHTML = `<div class="r"><div class="okdot">✓</div>선생님께 전달됐어요<small>${esc(hm(extra.result.submittedAt))}${extra.result.late ? ' · 마감 후' : ''}</small></div>
      <div class="bar"><i style="width:100%"></i></div><div class="note">${esc(attach(item))}</div>`;
  } else if (state === 'fail') {
    el.innerHTML = `<div class="r bad">⚠️ 보내지 못했어요<small>${esc(attach(item))}</small></div>
      <div class="note">${esc(extra.error || '')} 글과 사진은 이 휴대폰에 그대로 있어요.</div>
      <button class="retrybtn" data-retry="${esc(item.id)}"><span>다시 보내기</span><span>↻</span></button>`;
  } else {
    el.innerHTML = `<div class="r"><div class="spin"></div>선생님께 보내는 중<small>${esc(attach(item))}</small></div>
      <div class="bar"><i class="indet"></i></div><div class="note">지금 바로 다른 화면으로 가도 괜찮아요.</div>`;
  }
}

addEventListener('outbox', e => {
  const { item, state, result, error } = e.detail;
  if (state === 'ok') {
    me = me || store.cache('me');
    const a = me && me.assignments.find(x => x.id === item.assignmentId);
    if (a && (!item.token || item.token === store.token())) {
      Object.assign(a, { state: 'TURNED_IN', updated: result.submittedAt, late: result.late, text: item.text });
      store.setCache('me', me);
    }
    if (navigator.vibrate) navigator.vibrate(60);
    toast(`"${item.title}" 제출이 선생님께 전달됐어요 ✓`);
  } else if (state === 'fail') {
    toast(`"${item.title}" 제출을 보내지 못했어요. 다시 보내기를 눌러 주세요`);
  }
  paintSend(item, state, { result, error });
  if (document.querySelector('.hello') && !document.querySelector('dialog[open]')) renderHome();
});

// Fetch the latest "me"; returns true when it differs from what is on screen.
async function refreshMe() {
  const data = await call('me');
  const changed = JSON.stringify(data) !== JSON.stringify(me);
  me = data;
  store.setCache('me', data);
  // keeps the class list in step (also fills it for phones that joined before classes could be switched)
  store.saveClass({ token: store.token(), name: data.cls.name, section: data.cls.section, number: data.student.number, student: data.student.name });
  return changed;
}

function taskCard(a) {
  const k = stateOf(a);
  const q = outbox.forAssignment(a.id);
  const overdue = k === 'todo' && dDay(a.due) < 0;
  const pill = {
    done: `<span class="pill ok">${a.late ? '늦게 제출' : '제출 완료'}</span>`,
    sending: '<span class="pill sending">보내는 중</span>',
    fail: '<span class="pill fail">전송 실패</span>',
    todo: `<span class="pill">${overdue ? '마감 지남' : '미제출'}</span>`,
  }[k];
  const meta = k === 'done' ? `${shortDate(a.updated)} 제출`
    : k === 'sending' ? `방금 제출 · ${attach(q)}`
    : k === 'fail' ? `${attach(q)}은 이 휴대폰에 있어요`
    : a.due ? `📅 ${dueLabel(a.due)} 마감` : '마감일 없음';
  const tail = k === 'todo' ? '<div class="cta"><span>촬영해서 제출하기</span><span>→</span></div>'
    : k === 'fail' ? `<button class="retrybtn" data-retry="${esc(q.id)}"><span>다시 보내기</span><span>↻</span></button>` : '';
  return `<a class="task ${k === 'done' || k === 'sending' ? 'done' : ''} ${k === 'sending' ? 'sendingc' : ''} ${k === 'fail' ? 'failc' : ''}" href="#/a/${a.id}">
    <div class="row"><span class="chip">${esc(me.cls.name)}</span>${pill}</div>
    <h4>${esc(a.title)}</h4>
    <div class="meta">${esc(meta)}</div>${tail}
  </a>`;
}

// Draws at once from the last known data, then refreshes in the background and redraws only if something changed.
export async function studentHome() {
  const n = currentNav();
  me = store.cache('me') || me; // the saved copy is current: form answers and the outbox update it from other modules
  const cached = !!me;
  if (cached) renderHome(); else loading('home');
  let changed;
  try {
    changed = await refreshMe();
  } catch (e) {
    if (!cached || e.code === 'auth') throw e;
    return toast('연결이 잠시 끊겼어요. 마지막으로 받은 화면을 보여 드려요');
  }
  if (isCurrent(n) && changed && !document.querySelector('dialog[open]')) renderHome();
  refreshOthers(n);
}

// Other joined classes: refresh their counts quietly so the switcher can show a dot for new notices.
async function refreshOthers(n) {
  const others = store.classes().filter(c => c.token !== store.token());
  if (!others.length) return;
  await Promise.all(others.map(c => quiet('me', { token: c.token }).then(d => store.setCacheFor(c.token, d)).catch(() => {})));
  if (isCurrent(n) && document.querySelector('.hello') && !document.querySelector('dialog[open]')) renderHome();
}

const unreadOf = d => (d && d.inbox ? d.inbox.unread.ann + d.inbox.unread.msg : 0);
const missOf = d => (d ? d.assignments.filter(a => a.state !== 'TURNED_IN').length : 0);

function classSheet() {
  const cur = store.token();
  return store.classes().map(c => {
    const d = c.token === cur ? me : store.cacheFor(c.token);
    const sub = [c.section, c.number + '번', d ? `미제출 ${missOf(d)}` : '', c.token !== cur && unreadOf(d) ? `새 알림 ${unreadOf(d)}` : ''].filter(Boolean).join(' · ');
    return `<button class="cls ${c.token === cur ? 'on' : ''}" data-cls="${esc(c.token)}"><span class="ic">${esc(c.name.replace(/^[\d\s]*학년\s*/, '').slice(0, 1))}</span>
      <span class="tx"><b>${esc(c.name)}</b><small>${esc(sub)}</small></span>${c.token === cur ? '<span class="chk">✓</span>' : unreadOf(d) ? '<span class="newdot"></span>' : ''}</button>`;
  }).join('');
}

function switchClass(token) {
  if (token === store.token()) return $('#clsDlg').close();
  store.setToken(token);
  me = null;
  studentHome().catch(e => toast(e.message));
}

// Surveys, quizzes and replies sit in the same lists as assignments; they open #/f/{id}.
const FORM_KIND = { survey: ['설문', 'sv-ts', '📊'], quiz: ['퀴즈', 'sv-tq', '🎯'], reply: ['회신', 'sv-tr', '✅'] };
function formState(fm) {
  const q = outbox.forAssignment('f:' + fm.id);
  if (q) return q.status === 'fail' ? 'fail' : 'sending';
  return fm.done ? 'done' : fm.status === 'closed' ? 'closed' : 'todo';
}
function formCard(fm) {
  const k = formState(fm), [label, cls, icon] = FORM_KIND[fm.kind];
  const pill = { done: `<span class="pill ok">${fm.result ? `${fm.result.score}/${fm.result.max}점${fm.result.pending ? '+' : ''}` : '제출 완료'}</span>`, sending: '<span class="pill sending">보내는 중</span>',
    fail: '<span class="pill fail">전송 실패</span>', closed: '<span class="pill">마감됨</span>', todo: '<span class="pill">미제출</span>' }[k];
  const meta = fm.due ? `📅 ${dueLabel(fm.due.slice(0, 10))} ${fm.due.slice(11, 16)} 마감` : fm.kind === 'reply' ? '버튼 한 번이면 끝나요' : `${fm.anon ? '익명 · ' : ''}${fm.n}문항`;
  return `<a class="task sv-task ${cls} ${k === 'todo' || k === 'fail' ? '' : 'done'}" href="#/f/${fm.id}">
    <div class="row"><span class="sv-tag ${cls}">${icon} ${label}</span>${pill}</div><h4>${esc(fm.title)}</h4><div class="meta">${esc(meta)}</div></a>`;
}

function renderHome() {
  const list = me.assignments;
  const forms = me.forms || [];
  const fPending = forms.filter(fm => ['todo', 'fail'].includes(formState(fm)));
  const fDone = forms.filter(fm => !['todo', 'fail'].includes(formState(fm))).sort((a, b) => String(b.submitted || b.due).localeCompare(String(a.submitted || a.due)));
  const pending = list.filter(a => ['todo', 'fail'].includes(stateOf(a))).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const done = list.filter(a => ['done', 'sending'].includes(stateOf(a)))
    .sort((a, b) => (stateOf(b) === 'sending') - (stateOf(a) === 'sending') || (b.updated || '').localeCompare(a.updated || ''));
  const queued = outbox.list();
  const fails = queued.filter(q => q.status === 'fail').length;
  const sends = queued.length - fails;
  const resumed = queued.some(q => q.resumed && q.status === 'sending');
  const banner = fails
    ? `<div class="banner fail">⚠️ <span><b>${fails}건</b>을 보내지 못했어요. 인터넷을 확인해 주세요.</span><button class="act" data-retryall>다시 보내기</button></div>`
    : sends ? `<div class="banner sending"><div class="spin"></div><span>${resumed ? '지난번에 다 못 보낸 ' : ''}<b>${sends}건</b>을 ${resumed ? '이어서 보내고 있어요' : '선생님께 보내는 중이에요'}</span></div>` : '';
  const next = pending.find(a => a.due && dDay(a.due) >= 0);
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0;
  const name = me.student.name;

  render(`<header class="hello">
      <div class="greet"><button class="clsbtn" id="clsBtn" aria-label="수업 바꾸기">${esc([me.cls.section, me.cls.name].filter(Boolean).join(' · '))} ▾${store.classes().some(c => c.token !== store.token() && unreadOf(store.cacheFor(c.token))) ? '<span class="newdot"></span>' : ''}</button>
        <button class="hi" id="profile" aria-label="내 정보"><strong>안녕하세요, ${esc(firstName(name))}님 <span>›</span></strong></button></div>
      ${homeIcons(me)}
    </header>
    ${banner}${homeNotice(me)}${optinCard()}
    <section class="s-bento">
      <div class="tile hero"><div class="k">제출 현황</div>
        <div class="ring" style="--p:${pct}"><span>${done.length}/${list.length}</span></div>
        <div class="k">과제 ${list.length}개 중 ${done.length}개 완료</div></div>
      <div class="tile alert"><div class="k">미제출</div><div class="v">${pending.length}<small>건</small></div></div>
      <div class="tile due"><div class="k">다음 마감</div>
        <div class="v">${next ? dLabel(dDay(next.due)) : '–'}<small>${next ? esc(next.due.slice(5).replace('-', '.')) : ''}</small></div></div>
    </section>
    <div class="sec"><h3>진행 중</h3><span>${pending.length + fPending.length}</span></div>
    <div class="tasks">${[...pending.map(a => [a.due || '9', taskCard(a)]), ...fPending.map(fm => [fm.due ? fm.due.slice(0, 10) : '9', formCard(fm)])]
      .sort((x, y) => x[0].localeCompare(y[0])).map(x => x[1]).join('') || `<p class="empty">${list.length + forms.length ? '모두 냈어요 🎉' : '아직 받은 과제가 없어요'}</p>`}</div>
    ${done.length + fDone.length ? `<div class="sec"><h3>완료</h3><span>${done.length + fDone.length}</span></div><div class="tasks">${done.map(taskCard).join('')}${fDone.map(formCard).join('')}</div>` : ''}
    <dialog class="sheet menu" id="menu">
      <div class="menu-head"><div class="av">${esc(name.slice(-2))}</div><div><b>${esc(name)}</b><span>${esc([me.cls.name, me.cls.section, me.student.number + '번'].filter(Boolean).join(' · '))}</span></div></div>
      <div class="settings" id="pushSet">${pushSettings()}</div>
      <button class="ghost danger" id="leave">이 기기에서 나가기</button>
      <p class="muted small">나가면 다음에 수업 코드와 PIN을 다시 입력해야 해요.</p>
      <form method="dialog"><button class="ghost">닫기</button></form>
    </dialog>
    <dialog class="sheet menu bottom" id="clsDlg">
      <h3>내 수업</h3><div class="clslist">${classSheet()}</div>
      <a class="addcls" href="#/join">＋ 다른 수업 참여하기</a>
      <p class="clsnote">수업마다 그 수업의 번호와 PIN으로 한 번만 참여하면 돼요</p>
    </dialog>
    <dialog class="sheet menu" id="iosDlg">
      <h3>📲 아이폰에서 알림 받기</h3><p class="muted small">아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요 (iOS 16.4 이상).</p>
      <div class="step"><span>1</span>아래쪽 공유 버튼 <b>⬆︎</b> 누르기</div><div class="step"><span>2</span><b>홈 화면에 추가</b> 누르기</div><div class="step"><span>3</span>홈 화면의 앱을 열고 <b>알림 켜기</b></div>
      <form method="dialog"><button class="ghost">확인</button></form>
    </dialog>`);

  $('#profile').onclick = () => $('#menu').showModal();
  $('#clsBtn').onclick = () => $('#clsDlg').showModal();
  $('#clsDlg').onclick = e => {
    const b = e.target.closest('[data-cls]');
    if (b) switchClass(b.dataset.cls);
    else if (e.target === $('#clsDlg')) $('#clsDlg').close(); // tap outside the sheet
  };
  document.getElementById('app').onclick = e => {
    if (document.querySelector('.hello')) pushClick(e);
    const one = e.target.closest('[data-retry]');
    const all = e.target.closest('[data-retryall]');
    if ((!one && !all) || !document.querySelector('.hello')) return; // home only; the editor has its own handler
    e.preventDefault();
    if (one) outbox.retry(one.dataset.retry);
    else outbox.list().filter(q => q.status === 'fail').forEach(q => outbox.retry(q.id));
    renderHome();
  };
  $('#leave').onclick = async () => {
    $('#leave').disabled = true;
    const others = store.classes().length > 1;
    if (!others) await disablePush(); // other classes keep their notifications
    try { await call('leave', { token: store.token(), pushToken: pushToken() }); } catch {} // leaving locally is enough if the server is unreachable
    me = null;
    if (store.clearToken()) { $('#menu').close(); return studentHome(); }
    location.hash = '#/join';
  };
}

// ---------- push opt-in (home card + menu switches) ----------

const dismissed = () => { try { return localStorage.getItem('pushDismissed') === '1'; } catch { return false; } };
const KINDS = [['msg', '💬 선생님 메시지'], ['ann', '📢 반 공지 · 새 과제'], ['due', '⏰ 마감 전날 알림 (저녁 6시)']];
const sw = (on, attrs) => `<button type="button" class="tg ${on ? '' : 'off'}" role="switch" aria-checked="${on}" ${attrs}></button>`;

function optinCard() {
  const st = pushState();
  if (!['off', 'ios'].includes(st) || dismissed()) return '';
  return `<div class="optin"><div class="ic">📲</div><div class="tx"><b>알림 받기</b><p>선생님 메시지·공지·마감 전날을 앱을 닫아도 알려 드려요</p></div>
    <button class="go" data-push-on>켜기</button><button class="x" data-push-dismiss aria-label="닫기">✕</button></div>`;
}

function pushSettings() {
  const st = pushState();
  if (st === 'unsupported') return '';
  const head = `<div class="r"><div>🔔 이 휴대폰에 알림 받기<small>${{ on: '앱을 닫아도 알려 드려요', off: '앱을 닫아도 알려 드려요', ios: '아이폰은 홈 화면에 추가해야 받을 수 있어요', denied: '휴대폰 설정에서 이 앱의 알림을 허용해 주세요' }[st]}</small></div>
    ${st === 'denied' ? '' : sw(st === 'on', 'data-push-master')}</div>`;
  const p = prefs();
  return head + (st === 'on' ? KINDS.map(([k, label]) => `<div class="r">${label}${sw(p[k], `data-kind="${k}"`)}</div>`).join('') : '');
}

async function turnOn(btn) {
  if (pushState() === 'ios') return $('#iosDlg').showModal();
  if (btn) btn.disabled = true;
  try {
    await enablePush('student');
    toast('알림을 켰어요 🔔');
  } catch (e) {
    toast(e.message);
  }
  renderHome();
}

// Clicks on the opt-in card and the menu switches (called from the home click handler).
async function pushClick(e) {
  const t = e.target;
  if (t.closest('[data-push-on]')) turnOn(t.closest('[data-push-on]'));
  else if (t.closest('[data-push-dismiss]')) { try { localStorage.setItem('pushDismissed', '1'); } catch {} t.closest('.optin').remove(); }
  else if (t.closest('[data-push-master]')) {
    if (pushState() === 'on') { await disablePush(); toast('이 휴대폰의 알림을 껐어요'); $('#pushSet').innerHTML = pushSettings(); }
    else { $('#menu').close(); turnOn(); }
  } else if (t.closest('[data-kind]')) {
    const p = prefs();
    const k = t.closest('[data-kind]').dataset.kind;
    p[k] = !p[k];
    const saving = setPrefs(p); // stores locally first, so the redraw shows the new state
    $('#pushSet').innerHTML = pushSettings();
    try { await saving; } catch (err) { toast(err.message); }
  }
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
  const n = currentNav();
  me = me || store.cache('me');
  if (!me) { loading('page'); await refreshMe(); if (!isCurrent(n)) return; }
  const a = me.assignments.find(x => x.id === id);
  if (!a) throw new Error('과제를 찾을 수 없어요.');
  const draft = store.draft(a.id) || a.text || '';
  // photos: {url, base64, status: wait|run|ok|fail}; reading runs one at a time in photo order, so text is appended in order too.
  const st = { photos: [], sel: 0, ocrBase: '', busy: false, view: draft ? 'edit' : 'before', reading: null };

  render(`<div id="ev">
    <header class="topbar">
      <a href="#/home" class="iconbtn" aria-label="뒤로">‹</a>
      <div class="t"><small>${esc(me.cls.name)}${a.due ? ` · ${dueLabel(a.due)} 마감` : ''}</small><b>${esc(a.title)}</b></div>
      <a class="iconbtn ask" href="#/chat/a/${a.id}" aria-label="이 과제에 대해 선생님께 질문">💬</a>
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
        <div class="edhead"><b>${isDone(a) ? '제출한 내용 · 고쳐서 다시 낼 수 있어요' : '읽은 글자 확인·수정'}</b>
          <div class="tools"><button id="undo" type="button">↺ 되돌리기</button><button id="viewPh" type="button">사진 보기</button></div></div>
        <div class="edwrap">
          <textarea id="text" class="editor" placeholder="여기에 답을 쓰거나, 읽은 글자를 고쳐 주세요" aria-label="제출할 내용">${esc(draft)}</textarea>
          <div class="ghosts" id="ghosts" hidden aria-hidden="true"><span style="width:92%"></span><span style="width:78%"></span><span style="width:85%"></span></div>
        </div>
      </section>
      <section class="v-done">
        <div class="chk"><span>✓</span></div>
        <h2>제출했어요!</h2>
        <p>선생님께 보내는 중이에요.<br>앱을 닫아도 다음에 열면 이어서 보내요.</p>
        <div class="sendcard" id="sendcard"></div>
      </section>
    </div>
    <div class="dock" id="dock"></div>
    <dialog class="phdlg" id="phDlg"><img id="phBig" alt="촬영한 사진"><form method="dialog"><button class="btn">닫기</button></form></dialog>
  </div>`);

  const text = $('#text');
  const pending = () => st.photos.some(p => p.status === 'wait' || p.status === 'run');
  const DOCK = {
    before: () => '',
    reading: () => '<button class="sec small" id="cancel">취소</button><div class="main dim">읽는 중…</div>',
    edit: () => `${pending()
      ? '<div class="main dim">사진을 다 읽으면 제출할 수 있어요</div>'
      : `<button class="main" id="submit">${isDone(a) ? '다시 제출하기' : '제출하기'}</button>`}`,
    done: () => '<a class="main" href="#/home">내 과제로 돌아가기</a>',
  };

  function show(view) {
    st.view = view;
    $('#ed').dataset.state = view;
    $('#dock').innerHTML = DOCK[view]();
    const k = stateOf(a);
    $('#pill').textContent = { done: '제출 완료', sending: '보내는 중', fail: '전송 실패', todo: '미제출' }[k];
    $('#pill').className = 'pill ' + { done: 'ok', sending: 'sending', fail: 'fail', todo: '' }[k];
    if (view === 'edit') paintEdit();
  }

  function paintEdit() {
    $('#strip').innerHTML = st.photos.map((p, i) => `
      <button class="ph ${p.status} ${i === st.sel ? 'on' : ''}" data-i="${i}" style="background-image:url(${p.url})" aria-label="사진 ${i + 1} ${STATUS[p.status]}">
        <span class="n">${i + 1}</span><span class="s">${STATUS[p.status]}</span>
        <span class="del" data-del="${i}" role="button" aria-label="사진 ${i + 1} 삭제">✕</span></button>`).join('')
      + (st.photos.length < MAX_PHOTOS ? `<label class="ph add" aria-label="사진 추가">${fileInput}📷<small>사진 추가</small></label>` : '');
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

  // Queue and show "제출했어요" at once; the outbox sends in the background and the card follows it.
  async function send() {
    const body = text.value.trim();
    if (!body) { toast('제출할 내용을 입력해 주세요'); return text.focus(); }
    const photos = st.photos.filter(p => p.status !== 'cancel').map(p => p.base64);
    const item = await outbox.enqueue({ assignmentId: a.id, title: a.title, text: body, photos });
    store.clearDraft(a.id);
    a.text = body;
    store.setCache('me', me);
    $('#sendcard').dataset.id = item.id;
    paintSend(item, item.status === 'fail' ? 'fail' : 'sending');
    show('done');
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
    } else if (t.closest('#submit')) send();
    else if (t.closest('[data-retry]')) outbox.retry(t.closest('[data-retry]').dataset.retry);
  };
  text.oninput = () => store.setDraft(a.id, text.value);

  show(st.view);
}
