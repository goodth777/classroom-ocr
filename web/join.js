import { call } from './api.js';
import { store } from './store.js';
import { render, $, toast, loading } from './ui.js';
import { esc } from './lib.js';
import { registerClass } from './push.js';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

const ua = navigator.userAgent;
const isAndroid = /Android/i.test(ua);
const inApp = /KAKAOTALK|NAVER\(inapp|Line\/|Instagram|FBAN|FBAV|BAND\/|everytimeApp|DaumApps/i.test(ua);
const ssGet = k => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch {} };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const LOGO = '<img class="appic" src="icons/icon-192.png" alt="">';

// Phones opening the app in a browser tab are asked to install it first (a home-screen app keeps the login
// and can get notifications). Desktop browsers and the installed app go straight to the join steps.
function needsGate() {
  return !standalone && (isIOS || isAndroid) && !ssGet('browserOk');
}

function gate(st, go) {
  const skip = label => `<button class="skip" id="skip">${label}</button>`;
  const clsBox = () => (st.code ? `<div class="clsbox"><div><small>참여할 수업</small><b id="clsName">${st.cls ? esc([st.cls.className, st.cls.section].filter(Boolean).join(' · ')) : '수업 확인 중…'}</b></div><span class="cd">${esc(st.code)}</span></div>` : '');
  const bind = () => { if ($('#skip')) $('#skip').onclick = () => { ssSet('browserOk', '1'); go(); }; };

  if (inApp) {
    const kakao = /KAKAOTALK/i.test(ua);
    const out = kakao ? `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`
      : isAndroid ? `intent://${location.href.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end` : '';
    render(`<section class="gate">${LOGO}<h1>${isIOS ? 'Safari' : 'Chrome'}에서 열어 주세요</h1><p class="lead">이 앱 안의 브라우저에서는 앱을 설치할 수 없어요</p>
      ${isIOS && !kakao ? '<div class="warnbox">오른쪽 아래(또는 위) <b>⋯</b> 메뉴 → <b>Safari로 열기</b>를 눌러 주세요.</div>' : ''}
      ${out ? `<a class="main" href="${esc(out)}">${isIOS ? 'Safari' : 'Chrome'}으로 열기</a>` : '<button class="main" id="copyLink">링크 복사하기</button>'}
      ${skip('그냥 여기서 계속')}</section>`);
    if ($('#copyLink')) $('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('링크를 복사했어요. Safari 주소창에 붙여 넣어 주세요'); } catch { toast(location.href); } };
    return bind();
  }

  if (isIOS) {
    render(`<section class="gate">${LOGO}<h1>먼저 홈 화면에 추가해 주세요</h1><p class="lead">홈 화면 앱으로 써야 알림과 자동 입장이 돼요</p>
      <div class="gsteps"><div><span>1</span>아래 공유 버튼 <em>⬆︎</em> 누르기</div><div><span>2</span><b>홈 화면에 추가</b> 누르기</div><div><span>3</span>홈 화면의 <b>과제 제출</b> 앱 열기</div></div>
      ${st.code ? `<p class="codenote">앱에서 이 코드를 입력하세요<b>${esc(st.code)}</b></p>` : ''}
      ${skip('설치 없이 Safari에서 계속')}</section>
      <div class="sharehint">공유 버튼<span>↓</span></div>`);
    return bind();
  }

  // Android Chrome: our own question first, then the system install sheet.
  render(`<section class="gate">${LOGO}<h1>과제 제출 앱</h1><p class="lead">손글씨를 찍으면 글자로 바꿔서<br>선생님께 바로 제출해요</p>
    ${clsBox()}
    <div class="perks"><div><i>📲</i>홈 화면에서 바로 열기</div><div><i>🔔</i>선생님 메시지·마감 알림 받기</div><div><i>🔑</i>다음부터 로그인 없이 자동 입장</div></div>
    <button class="main" id="install">📲 앱 설치하고 시작하기</button>
    ${skip('설치 없이 브라우저에서 계속')}</section>`);
  bind();
  $('#install').onclick = async () => {
    if (!installPrompt) {
      return toast('이미 설치했다면 홈 화면의 "과제 제출" 앱을 열어 주세요. 아니면 Chrome 메뉴 ⋮ → "앱 설치"를 눌러 주세요');
    }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome !== 'accepted') return;
    render(`<section class="gate">${LOGO}<h1>설치됐어요! 🎉</h1><p class="lead">홈 화면(또는 앱 목록)의 <b>과제 제출</b> 앱을 열어 주세요.<br>수업 코드는 앱에 그대로 이어져요.</p>
      ${skip('여기서 계속하기')}</section>`);
    bind();
  };
  if (st.code && !st.cls) call('peek', { code: st.code }).then(c => { st.cls = c; if ($('#clsName')) $('#clsName').textContent = [c.className, c.section].filter(Boolean).join(' · '); }).catch(() => {});
}

// 5 digits = 학번; shorter = the number used before 학번 was added to the roster.
const idOf = v => (String(v).length === 5 ? { sno: String(v) } : { number: +v });

const steps = n => `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

// First visit only: class code → number → PIN → device token. Afterwards the token opens the app directly.
// code: from the QR link (#/join/CODE); remembered so the installed app (same storage on Android) picks it up.
export function joinFlow(code = '', adding = false) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length === 6) lsSet('pendingCode', code);
  const st = { code: code.length === 6 ? code : lsGet('pendingCode') || '', number: '', name: '', cls: null, pin: '' };

  function stepCode() {
    render(`<section class="join">
      ${adding ? '<a class="cancel" href="#/home">‹ 내 수업으로 돌아가기</a>' : ''}
      ${steps(1)}
      <div class="logo"></div>
      <h1>${adding ? '참여할 수업 코드를' : '수업 코드를'}<br>입력해 주세요</h1>
      <p class="lead">선생님이 칠판이나 단톡방에 알려 준<br>6자리 코드예요.</p>
      <label class="codebox">
        <input id="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-label="수업 코드">
        <span class="boxes" aria-hidden="true">${'<span></span>'.repeat(6)}</span>
      </label>
      <p class="help">처음 한 번만 하면 돼요. 다음부터는 바로 열려요.</p>
    </section>
    <div class="dock"><button class="main" id="next" disabled>다음</button></div>`);
    const input = $('#code');
    const boxes = [...document.querySelectorAll('.boxes span')];
    const paint = () => {
      const v = input.value;
      boxes.forEach((b, i) => { b.textContent = v[i] || ''; b.className = i < v.length ? 'on' : i === v.length ? 'cur' : ''; });
      $('#next').disabled = v.length !== 6;
    };
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); paint(); };
    input.value = st.code;
    paint();
    input.focus();
    $('#next').onclick = async () => {
      const btn = $('#next');
      btn.disabled = true;
      btn.textContent = '확인 중…';
      try {
        st.code = input.value;
        st.cls = await call('peek', { code: st.code });
        stepNumber();
      } catch (e) {
        toast(e.message);
        btn.textContent = '다음';
        paint();
      }
    };
  }

  function stepNumber() {
    render(`<section class="join">
      ${steps(2)}
      <div class="found"><div class="ic">📚</div><div><b>${esc(st.cls.className)}</b><span>${esc(st.cls.section)}</span></div></div>
      <h1>내 학번을<br>입력해 주세요</h1>
      <p class="lead">다섯 자리 학번이에요. 예: 2학년 8반 12번 → 20812</p>
      <label class="f">학번<input id="num" class="field" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="예: 20812" value="${esc(st.number)}"></label>
      <label class="f">이름<div class="field name" id="name">학번을 입력하면 이름이 나와요</div></label>
    </section>
    <div class="dock"><button class="sec" id="back" aria-label="이전">‹</button><button class="main" id="next" disabled>맞아요, 다음</button></div>`);
    const num = $('#num');
    let t;
    const look = () => {
      clearTimeout(t);
      $('#next').disabled = true;
      const n = num.value.replace(/\D/g, '');
      num.value = n;
      if (!n) { $('#name').textContent = '학번을 입력하면 이름이 나와요'; return; }
      $('#name').textContent = '찾는 중…';
      t = setTimeout(async () => {
        try {
          const r = await call('peek', { code: st.code, ...idOf(n) });
          if (num.value !== n) return;
          st.number = n;
          st.name = r.name;
          $('#name').textContent = r.name;
          $('#name').classList.add('ok');
          $('#next').disabled = false;
        } catch (e) {
          if (num.value === n) { $('#name').textContent = e.message; $('#name').classList.remove('ok'); }
        }
      }, 400);
    };
    num.oninput = look;
    num.focus();
    if (st.number) look();
    $('#back').onclick = stepCode;
    $('#next').onclick = stepPin;
  }

  function stepPin() {
    st.pin = '';
    render(`<section class="join">
      ${steps(3)}
      <h1>${esc(st.name)}님,<br>PIN 4자리를 입력해요</h1>
      <p class="lead">선생님께 받은 PIN 카드에 적혀 있어요.</p>
      <div class="pin" id="pin" aria-label="PIN 입력 칸">${'<span></span>'.repeat(4)}</div>
      <p class="note" id="pinNote">PIN을 잊었으면 선생님께 다시 받으세요.</p>
    </section>
    <div class="keypad" id="keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '‹', '0', '⌫']
      .map(k => `<button data-k="${k}" aria-label="${k === '⌫' ? '지우기' : k === '‹' ? '이전' : k}">${k}</button>`).join('')}</div>`);
    const paint = () => [...$('#pin').children].forEach((s, i) => { s.className = i < st.pin.length ? 'fill' : i === st.pin.length ? 'cur' : ''; });
    paint();
    let busy = false;
    $('#keypad').onclick = async e => {
      const k = e.target.closest('button')?.dataset.k;
      if (!k || busy) return;
      if (k === '‹') return stepNumber();
      if (k === '⌫') { st.pin = st.pin.slice(0, -1); return paint(); }
      if (st.pin.length >= 4) return;
      st.pin += k;
      paint();
      if (st.pin.length < 4) return;
      busy = true;
      $('#pinNote').textContent = '확인 중…';
      try {
        const r = await call('join', { code: st.code, ...idOf(st.number), pin: st.pin });
        store.saveClass({ token: r.token, name: r.cls.name, section: r.cls.section, number: r.student.number, student: r.student.name });
        registerClass(r.token);
        lsSet('pendingCode', null);
        welcome(r);
      } catch (err) {
        busy = false;
        st.pin = '';
        paint();
        $('#pin').classList.add('shake');
        setTimeout(() => $('#pin') && $('#pin').classList.remove('shake'), 500);
        $('#pinNote').textContent = err.message;
      }
    };
  }

  function welcome(r) {
    render(`<section class="join welcome">
      <div class="av big">${esc(r.student.name.slice(-2))}</div>
      <h1>환영해요, ${esc(r.student.name)}님!</h1>
      <div class="chips"><span class="chip">${esc(r.cls.name)}</span><span class="chip">${esc([r.cls.section, r.student.number + '번'].filter(Boolean).join(' '))}</span></div>
      <div class="keep">📱 이 기기에 기억해 둘게요. 다음부터는 바로 내 과제가 열려요.</div>
    </section>
    <div class="dock"><a class="main" href="#/home">내 과제 보러 가기</a></div>`);
  }

  // A code from the QR link skips typing: check it and go straight to the number step.
  async function start() {
    if (st.code.length !== 6) return stepCode();
    if (st.cls) return stepNumber();
    loading('page');
    try { st.cls = await call('peek', { code: st.code }); stepNumber(); } catch (e) { toast(e.message); lsSet('pendingCode', null); stepCode(); }
  }
  if (!adding && needsGate()) gate(st, start); else start();
}
