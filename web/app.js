import { store } from './store.js';
import { render, fail, toast, nextNav } from './ui.js';
import { joinFlow } from './join.js';
import { studentHome, studentEditor } from './student.js';
import { teacherView } from './teacher.js';
import { studentNotify, studentChat } from './inbox.js';
import * as outbox from './outbox.js';

// The teacher link (#/teacher?key=…) is opened once; the key then stays on this device.
const link = /^#\/teacher\?key=([\w-]+)/.exec(location.hash);
if (link) {
  store.setKey(link[1]);
  history.replaceState(null, '', location.pathname + location.search + '#/t');
}

// Routes — teacher: #/t/{classId}/{grid|roster|msg}; student: #/a/{id}, #/notify/{tab}, #/chat[/ann|/a/{id}], anything else = home.
async function route() {
  nextNav();
  const [, view, a, b, c, d] = location.hash.split('/');
  try {
    if (store.key()) return await teacherView(view === 't' ? a : '', b, c, d);
    if (!store.token() || view === 'join') return joinFlow(view === 'join' ? a : '', !!store.token());
    if (view === 'a') return await studentEditor(a);
    if (view === 'notify') return await studentNotify(a);
    if (view === 'f') return await (await import('./sform.js')).formView(a); // loaded only when a form opens
    if (view === 'chat') return await studentChat(a, b);
    if (view === 'live') return await (await import('./slive.js')).liveView();
    return await studentHome();
  } catch (e) {
    if (e.code !== 'auth') return fail(e);
    if (store.key()) {
      store.clearKey();
      return render(`<section class="center"><div class="hero-card"><div class="logo"></div><h1>교사 링크를 다시 열어 주세요</h1>
        <p class="muted">이 기기에 저장된 교사 키가 맞지 않아요. 설정 때 받은 교사 접속 링크를 다시 열면 돼요.</p></div></section>`);
    }
    const left = store.clearToken();
    toast(e.message);
    if (left) return route();
    joinFlow();
  }
}

addEventListener('hashchange', route);

// Student back button (Android): the app keeps just two history entries — a home "root" and the current screen.
// In-app links replace the current screen, so back always goes up (chat about an assignment → that assignment,
// anything else → home), closes an open sheet first, and on home a second press within 2 s leaves the app.
const parentOf = h => (/^#\/chat\/a\//.test(h) ? h.replace('#/chat/a/', '#/a/') : /^#\/(a|f|chat|notify|live)\b/.test(h) || (/^#\/join/.test(h) && store.token()) ? '#/home' : null);
let screen = location.hash;
let lastBack = 0;
if (!store.key()) {
  history.replaceState({ root: 1 }, '', '#/home');
  history.pushState({ guard: 1 }, '', screen && screen !== '#/' ? screen : '#/home');
  addEventListener('click', e => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href === location.hash) return;
    history.replaceState({ guard: 1 }, '', href);
    screen = href;
    route();
  });
  addEventListener('popstate', e => {
    if (!e.state || !e.state.root) return;
    const open = document.querySelector('dialog[open]');
    const up = parentOf(screen);
    if (open) { open.close(); history.pushState({ guard: 1 }, '', screen); return; }
    if (up) { history.pushState({ guard: 1 }, '', up); screen = up; return; } // hashchange then draws the parent
    if (Date.now() - lastBack < 2000) return history.back(); // leave the app
    lastBack = Date.now();
    history.pushState({ guard: 1 }, '', '#/home');
    toast('뒤로 버튼을 한 번 더 누르면 앱이 종료돼요');
  });
}
// Load queued submissions first so screens can show "보내는 중", then resume sending them.
outbox.init().then(() => {
  route();
  if (store.token()) outbox.flush();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
