// Student side of notifications and chat: home badges, the 🔔 list (공지 / 임박 / 메시지) and the 💬 screen.
import { call, quiet } from './api.js';
import { store } from './store.js';
import { render, loading, $, toast, currentNav, isCurrent } from './ui.js';
import { esc, dDay, dueLabel, when } from './lib.js';
import * as outbox from './outbox.js';

const POLL_MS = 4000;
const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const BUBBLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const EMPTY_INBOX = { anns: [], msgs: [], unread: { ann: 0, msg: 0 } };

const inboxOf = me => me.inbox || EMPTY_INBOX;
const save = me => store.setCache('me', me);
// Not submitted (nor waiting in the outbox) and due today or tomorrow.
const imminent = me => me.assignments.filter(a => a.state !== 'TURNED_IN' && !outbox.forAssignment(a.id) && a.due && dDay(a.due) >= 0 && dDay(a.due) <= 1);
const dLabel = d => (d > 0 ? `D-${d}` : 'D-day');
const recount = box => { box.unread = { ann: box.anns.filter(a => !a.read).length, msg: box.msgs.filter(m => m.from === 't' && !m.readAt).length }; };
const badge = (n, cls = '') => (n ? `<span class="n ${cls}">${n > 99 ? '99+' : n}</span>` : '');

// ---------- home pieces ----------

export function homeIcons(me) {
  const box = inboxOf(me);
  const bell = box.unread.ann + imminent(me).length + box.unread.msg;
  return `<div class="icons">
    <a class="ib" href="#/notify" aria-label="알림${bell ? ` ${bell}개` : ''}">${BELL}${badge(bell)}</a>
    <a class="ib" href="#/chat" aria-label="선생님과 대화${box.unread.msg ? ` 새 메시지 ${box.unread.msg}개` : ''}">${BUBBLE}${badge(box.unread.msg, 'g')}</a>
  </div>`;
}

// The newest unread announcement (pinned first) sits above the bento until it is opened.
export function homeNotice(me) {
  const a = inboxOf(me).anns.find(x => !x.read);
  return a ? `<a class="notice" href="#/chat/ann"><div class="ic">📢</div><div><b>선생님 공지 · ${esc(a.title)}</b>
    ${a.body ? `<p>${esc(a.body)}</p>` : ''}<small>${esc(when(a.created))} · 눌러서 자세히 보기</small></div></a>` : '';
}

async function loadMe() {
  let me = store.cache('me');
  if (!me) { loading('page'); me = await call('me'); save(me); }
  return me;
}
async function freshMe() {
  const me = await quiet('me');
  save(me);
  return me;
}

async function markAnnsRead(me) {
  const ids = inboxOf(me).anns.filter(a => !a.read).map(a => a.id);
  if (!ids.length) return;
  inboxOf(me).anns.forEach(a => { a.read = true; });
  recount(inboxOf(me));
  save(me);
  try { await quiet('readAnn', { ids }); } catch {} // ponytail: a lost read mark only means the badge comes back; next open retries
}
async function markMsgsRead(me) {
  const box = inboxOf(me);
  if (!box.unread.msg) return;
  const at = new Date().toISOString();
  box.msgs.forEach(m => { if (m.from === 't' && !m.readAt) m.readAt = at; });
  recount(box);
  save(me);
  try { await quiet('readMsgs'); } catch {}
}

// ---------- 🔔 notifications ----------

export async function studentNotify(tab = 'ann') {
  const n = currentNav();
  let me = await loadMe();
  if (!isCurrent(n)) return;
  draw();
  try { me = await freshMe(); } catch { return; }
  if (isCurrent(n)) draw();

  function draw() {
    const box = inboxOf(me);
    const dues = me.assignments.filter(a => a.state !== 'TURNED_IN' && !outbox.forAssignment(a.id) && a.due && dDay(a.due) >= 0)
      .sort((a, b) => a.due.localeCompare(b.due));
    const tmsgs = box.msgs.filter(m => m.from === 't').reverse();
    const counts = { ann: box.unread.ann, due: imminent(me).length, msg: box.unread.msg };
    const tabBtn = (k, label) => `<a href="#/notify/${k}" class="${tab === k ? 'on' : ''}">${label}${counts[k] ? `<i>${counts[k]}</i>` : ''}</a>`;
    const row = (href, unread, title, sub, right) => `<a class="nrow ${unread ? 'unread' : ''}" href="${href}"><span class="dot"></span>
      <div class="tx"><b>${title}</b>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${right}</a>`;
    const rows = {
      ann: () => box.anns.map(a => row('#/chat/ann', !a.read, `${a.pinned ? '📌 ' : ''}${esc(a.title)}`, a.body, `<small>${esc(when(a.created))}</small>`)),
      due: () => dues.map(a => {
        const d = dDay(a.due);
        return row(`#/a/${a.id}`, d <= 1, esc(a.title), `아직 제출하지 않았어요 · ${dueLabel(a.due)} 마감`, `<span class="dd ${d > 1 ? 'far' : ''}">${dLabel(d)}</span>`);
      }),
      msg: () => tmsgs.map(m => row('#/chat', !m.readAt, '선생님', m.text, `<small>${esc(when(m.created))}</small>`)),
    }[tab]();
    const empty = { ann: '아직 공지가 없어요', due: '마감이 다가오는 과제가 없어요 👍', msg: '선생님께 받은 메시지가 없어요' }[tab];
    render(`<header class="topbar"><a href="#/home" class="iconbtn" aria-label="뒤로">‹</a><div class="t"><b>알림</b></div>
        ${counts.ann || counts.msg ? '<button class="linkbtn" id="allRead">모두 읽음</button>' : ''}</header>
      <nav class="tabs3">${tabBtn('ann', '공지')}${tabBtn('due', '임박')}${tabBtn('msg', '메시지')}</nav>
      <div class="nlist">${rows.join('') || `<p class="empty">${empty}</p>`}</div>`);
    const all = $('#allRead');
    if (all) all.onclick = async () => { await Promise.all([markAnnsRead(me), markMsgsRead(me)]); draw(); };
  }
}

// ---------- 💬 chat ----------

const dayKey = iso => new Date(Date.parse(iso) + 9 * 36e5).toISOString().slice(0, 10);
const dayLabel = iso => {
  const w = when(iso);
  return /:/.test(w) ? (w.startsWith('어제') ? '어제' : '오늘') : w.replace('/', '월 ') + '일';
};

// Bubbles with day separators; mine show "읽음" once the teacher opened the thread.
export function bubbles(msgs, mine, titleOf) {
  let day = '';
  return msgs.map(m => {
    const sep = dayKey(m.created) !== day ? `<div class="when">${esc(dayLabel(m.created))}</div>` : '';
    day = dayKey(m.created);
    const me = m.from === mine;
    const ref = m.assignmentId && titleOf(m.assignmentId) ? `<span class="ref">📝 ${esc(titleOf(m.assignmentId))}</span>` : '';
    const meta = m.pending ? '보내는 중…' : `${when(m.created)}${me && m.readAt ? ' · 읽음' : ''}`;
    return `${sep}<div class="b ${me ? 'me' : 'them'}">${ref}${esc(m.text)}</div><div class="meta ${me ? 'r' : ''}">${esc(meta)}</div>`;
  }).join('');
}

export function composer(ref) {
  return `<form class="composer" id="composer">
    ${ref ? `<div class="cref">📝 ${esc(ref)}에 대한 질문 <button type="button" id="dropRef" aria-label="과제 꼬리표 빼기">✕</button></div>` : ''}
    <textarea id="msg" rows="1" placeholder="메시지 입력…" aria-label="메시지"></textarea>
    <button class="send" aria-label="보내기">↑</button></form>`;
}

// Auto-grows the box; Enter sends on desktop, Shift+Enter makes a new line.
export function bindComposer(onSend) {
  const box = $('#msg');
  box.oninput = () => { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 120) + 'px'; };
  box.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#composer').requestSubmit(); } };
  $('#composer').onsubmit = e => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text) return;
    box.value = '';
    box.oninput();
    onSend(text);
  };
}

export async function studentChat(tab, arg) {
  const n = currentNav();
  let me = await loadMe();
  if (!isCurrent(n)) return;
  const view = tab === 'ann' ? 'ann' : 'dm';
  let refId = tab === 'a' ? arg : '';
  const titleOf = id => (me.assignments.find(a => a.id === id) || {}).title;

  function draw() {
    const box = inboxOf(me);
    const tabs = `<nav class="tabs2"><a href="#/chat" class="${view === 'dm' ? 'on' : ''}">1:1 대화${badge(view === 'dm' ? 0 : box.unread.msg, 'i')}</a>
      <a href="#/chat/ann" class="${view === 'ann' ? 'on' : ''}">반 공지${badge(view === 'ann' ? 0 : box.unread.ann, 'i')}</a></nav>`;
    const body = view === 'ann'
      ? box.anns.map(a => `<article class="ann ${a.pinned ? 'pin' : ''}"><div class="h">${a.pinned ? '<span class="tag">📌 고정</span>' : ''}${esc(when(a.created))}</div>
          <b>${esc(a.title)}</b>${a.body ? `<p>${esc(a.body)}</p>` : ''}</article>`).join('') || '<p class="empty">아직 공지가 없어요</p>'
      : `<div class="thread" id="thread">${bubbles(box.msgs, 's', titleOf) || '<p class="empty">궁금한 점을 선생님께 물어보세요.<br>과제 화면의 💬에서 물어보면 어떤 과제인지 같이 전해져요.</p>'}</div>`;
    render(`<header class="topbar"><a href="#/home" class="iconbtn" aria-label="뒤로">‹</a><div class="av">T</div>
        <div class="t"><b>선생님</b><small>${esc(me.cls.name)}</small></div></header>
      ${tabs}${body}${view === 'dm' ? composer(refId && titleOf(refId)) : ''}`);
    if (view === 'dm') {
      scrollTo(0, document.body.scrollHeight);
      bindComposer(send);
      const drop = $('#dropRef');
      if (drop) drop.onclick = () => { refId = ''; drawKeep(); };
    }
  }
  // Redraw without losing what is being typed.
  function drawKeep() {
    const typed = $('#msg') ? $('#msg').value : '';
    draw();
    if ($('#msg') && typed) { $('#msg').value = typed; $('#msg').oninput(); }
  }

  async function send(text) {
    const box = inboxOf(me);
    const temp = { id: 'tmp' + Date.now(), from: 's', text, assignmentId: refId, created: new Date().toISOString(), readAt: '', pending: true };
    box.msgs.push(temp);
    const assignmentId = refId;
    refId = '';
    drawKeep();
    try {
      Object.assign(temp, await call('send', { text, assignmentId }), { pending: false });
      save(me);
    } catch (e) {
      box.msgs.splice(box.msgs.indexOf(temp), 1);
      toast(`보내지 못했어요. ${e.message}`);
      if ($('#msg') && !$('#msg').value) $('#msg').value = text;
    }
    if (isCurrent(n)) drawKeep();
  }

  draw();
  if (view === 'ann') {
    try { me = await freshMe(); } catch {}
    if (!isCurrent(n)) return;
    draw();
    return markAnnsRead(me);
  }
  // 1:1: mark teacher messages read, then poll while this screen stays open.
  markMsgsRead(me);
  while (isCurrent(n)) {
    try {
      const msgs = await quiet('chat');
      if (!isCurrent(n)) return;
      const box = inboxOf(me);
      const pending = box.msgs.filter(m => m.pending);
      if (JSON.stringify(msgs) !== JSON.stringify(box.msgs.filter(m => !m.pending))) {
        box.msgs = msgs.concat(pending);
        recount(box);
        save(me);
        drawKeep();
        markMsgsRead(me);
      }
    } catch {} // offline: keep showing what we have and try again
    await new Promise(r => setTimeout(r, document.hidden ? POLL_MS * 3 : POLL_MS));
  }
}
