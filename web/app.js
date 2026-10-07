import { run, getToken, hasToken } from './api.js';
import { render, $, fail, nextNav } from './ui.js';
import { studentHome, studentEditor } from './student.js';
import { teacherHome, teacherCourse } from './teacher.js';

let me = null;
// A still-valid token plus the cached profile lets the installed app skip the login card.
try { if (hasToken()) me = JSON.parse(localStorage.getItem('me') || 'null'); } catch {}

function login() {
  render(`<section class="center"><div class="card hero">
    <h1>과제 제출</h1><p class="muted">학교 구글 계정으로 시작해요</p>
    <button id="login" class="primary">로그인</button></div></section>`);
  $('#login').onclick = async () => {
    try {
      await getToken();
      me = await run('whoami');
      try { localStorage.setItem('me', JSON.stringify(me)); } catch {}
      route();
    } catch (e) { fail(e); }
  };
}

async function route() {
  nextNav();
  if (!me) return login();
  const [, view, a, b] = location.hash.split('/');
  try {
    if (view === 'a') return await studentEditor(a, b);
    if (view === 't') return await teacherCourse(a, me);
    return me.teaching.length ? teacherHome(me) : await studentHome();
  } catch (e) { fail(e); }
}

addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
