import { call } from './api.js';
import { store } from './store.js';
import { render, $, toast } from './ui.js';
import { esc } from './lib.js';

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

const steps = n => `<div class="steps">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;

// First visit only: class code → number → PIN → device token. Afterwards the token opens the app directly.
export function joinFlow() {
  const st = { code: '', number: '', name: '', cls: null, pin: '' };

  function stepCode() {
    render(`<section class="join">
      ${steps(1)}
      <div class="logo"></div>
      <h1>수업 코드를<br>입력해 주세요</h1>
      <p class="lead">선생님이 칠판이나 단톡방에 알려 준<br>6자리 코드예요.</p>
      <label class="codebox">
        <input id="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" aria-label="수업 코드">
        <span class="boxes" aria-hidden="true">${'<span></span>'.repeat(6)}</span>
      </label>
      <p class="help">처음 한 번만 하면 돼요. 다음부터는 바로 열려요.</p>
      ${isIOS && !standalone ? `<div class="install">📲 <span><b>먼저 홈 화면에 추가해 주세요.</b> 아래 공유 버튼 <b>⬆</b> → <b>홈 화면에 추가</b> → 새로 생긴 앱에서 참여하면 다음부터 자동으로 들어가요.</span></div>` : ''}
      ${installPrompt && !standalone ? '<button class="ghost" id="install">📲 앱으로 설치하기</button>' : ''}
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
    if ($('#install')) $('#install').onclick = () => installPrompt.prompt();
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
      <h1>내 번호를<br>입력해 주세요</h1>
      <p class="lead">선생님 명단에 있는 번호예요.</p>
      <label class="f">번호<input id="num" class="field" inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="예: 12" value="${esc(st.number)}"></label>
      <label class="f">이름<div class="field name" id="name">번호를 입력하면 이름이 나와요</div></label>
    </section>
    <div class="dock"><button class="sec" id="back" aria-label="이전">‹</button><button class="main" id="next" disabled>맞아요, 다음</button></div>`);
    const num = $('#num');
    let t;
    const look = () => {
      clearTimeout(t);
      $('#next').disabled = true;
      const n = num.value.replace(/\D/g, '');
      num.value = n;
      if (!n) { $('#name').textContent = '번호를 입력하면 이름이 나와요'; return; }
      $('#name').textContent = '찾는 중…';
      t = setTimeout(async () => {
        try {
          const r = await call('peek', { code: st.code, number: +n });
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
        const r = await call('join', { code: st.code, number: +st.number, pin: st.pin });
        store.setToken(r.token);
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

  stepCode();
}
