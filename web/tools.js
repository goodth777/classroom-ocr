// Classroom tools for teaching classes (bundle 1). Everything runs on the teacher's device: no server calls.
// Loaded only when the 수업 도구 tab opens. Per-class settings live in localStorage.
import { render, $, toast } from './ui.js';
import { esc } from './lib.js';
import { fa } from './fa.js';
import { sfx } from './sfx.js';
import { call, quiet } from './api.js';
import { drawVote, drawLight, drawHand, drawQuiz } from './live.js';
import { drawGroups, drawScore, drawNoise, drawClock, drawQr, drawOrder } from './tools2.js';

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const TOOLS = [
  { id: 'timer', name: '타이머', sub: '3분 · 5분 · 직접', icon: 'stopwatch' },
  { id: 'pick', name: '이름 뽑기', sub: '뽑힌 학생 제외', icon: 'user-check' },
  { id: 'dice', name: '주사위·룰렛', sub: '동전 던지기 포함', icon: 'dice' },
  { id: 'board', name: '큰 글씨 판', sub: '지시문·단어 크게', icon: 'font' },
  { id: 'signal', name: '활동 신호판', sub: '조용히·모둠 활동', icon: 'traffic-light' },
  { id: 'sound', name: '효과음판', sub: '집중 종·딩동', icon: 'bell' },
  { id: 'groups', name: '모둠 편성', sub: '규칙·모둠장·인쇄', icon: 'people-group' },
  { id: 'score', name: '모둠 점수판', sub: '숫자키로 +1', icon: 'trophy' },
  { id: 'order', name: '발표 순서', sub: '학생·모둠 차례', icon: 'list-ol' },
  { id: 'noise', name: '소음 측정기', sub: '마이크 · 저장 안 함', icon: 'microphone' },
  { id: 'clock', name: '수업 시계', sub: '교시 · 남은 시간', icon: 'clock' },
  { id: 'qr', name: 'QR 띄우기', sub: '링크를 큰 QR로', icon: 'qrcode' },
];
// Bundle 3: students answer on their phones (1~3 s behind).
const LIVE = [
  { id: 'vote', name: '실시간 투표', sub: '객관식·단어 구름·의견', icon: 'square-poll-horizontal' },
  { id: 'light', name: '이해도 신호등', sub: '🟢🟡🔴 언제든', icon: 'traffic-light' },
  { id: 'hand', name: '손들기·질문함', sub: '익명 질문 · 👍 공감', icon: 'hand' },
  { id: 'quiz', name: '함께 푸는 퀴즈', sub: '한 문제씩 · 순위 없음', icon: 'graduation-cap' },
];
const SOON = [
  ['포스트잇 보드', 'note-sticky'], ['모둠 결과 사진', 'camera'],
];

let ctx = null;
let cleanup = null; // stops the open tool's timers/listeners when leaving it

export function toolsView(c, sub = '') {
  ctx = c;
  if (cleanup) { cleanup(); cleanup = null; }
  const t = [...TOOLS, ...LIVE].find(x => x.id === sub);
  if (!t) return drawHub();
  render(ctx.frame(`<section class="tl-stage" id="tlStage">
      <div class="tl-bar"><a class="btn" href="#/t/${ctx.cls.id}/tools">${fa('chevron-left')}도구 모음</a><b>${t.name}</b><span class="sp"></span>
        <span id="tlActs"></span>
        ${t.id === 'timer' ? '' : `<button type="button" class="btn" id="tlMiniBtn">${fa('stopwatch')}타이머 띄우기</button>`}
        <button type="button" class="btn" id="tlFull">${fa('expand')}전체 화면</button></div>
      <div class="tl-body" id="tlBody"></div>
    </section>`, ''));
  ctx.after();
  $('#tlFull').onclick = () => {
    const st = $('#tlStage');
    if (document.fullscreenElement) document.exitFullscreen(); else if (st.requestFullscreen) st.requestFullscreen().catch(() => {});
  };
  if ($('#tlMiniBtn')) $('#tlMiniBtn').onclick = () => { timer.mini = true; if (!timer.total) setTimer(180); paintMini(); };
  const T = { ctx, acts, body, $, get: lsGet, set: lsSet, sfx, toast, fa, esc, call, quiet };
  cleanup = ({ timer: drawTimer, pick: drawPick, dice: drawDice, board: drawBoard, signal: drawSignal, sound: drawSound,
    groups: drawGroups, score: drawScore, noise: drawNoise, clock: drawClock, qr: drawQr, order: drawOrder,
    vote: drawVote, light: drawLight, hand: drawHand, quiz: drawQuiz })[t.id](T) || null;
}

// ---------- hub ----------

function drawHub() {
  const stars = lsGet('toolStars', ['timer', 'pick']);
  const card = (t, big) => `<a class="tl-card ${big ? 'big' : ''}" href="#/t/${ctx.cls.id}/tools/${t.id}"><span class="tl-ic">${fa(t.icon)}</span><b>${t.name}</b><small>${t.sub}</small>
    <button type="button" class="tl-star ${stars.includes(t.id) ? 'on' : ''}" data-star="${t.id}" aria-label="자주 쓰는 도구로 고정">${fa('star')}</button></a>`;
  const fav = [...TOOLS, ...LIVE].filter(t => stars.includes(t.id));
  render(ctx.frame(`<section class="tl-hub">
      ${fav.length ? `<div class="tl-grp">${fa('star')} 자주 쓰는 도구</div><div class="tl-bento">${fav.map(t => card(t, true)).join('')}</div>` : ''}
      <div class="tl-grp">기본 도구 <small>☆을 누르면 위에 고정돼요</small></div><div class="tl-bento">${TOOLS.map(t => card(t)).join('')}</div>
      <div class="tl-grp">${fa('mobile-screen')} 학생 휴대폰과 함께 <small>학생 앱에 바로 떠요 · 1~3초 늦게 반영</small></div><div class="tl-bento">${LIVE.map(t => card(t)).join('')}</div>
      <div class="tl-grp">곧 추가돼요</div><div class="tl-bento">${SOON.map(([n, i]) => `<div class="tl-card soon"><span class="tl-ic">${fa(i)}</span><b>${n}</b><small>준비 중</small></div>`).join('')}</div>
    </section>`, ''));
  ctx.after();
  $('.tl-hub').onclick = e => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.star;
    lsSet('toolStars', stars.includes(id) ? stars.filter(x => x !== id) : [...stars, id]);
    drawHub();
  };
}

const acts = html => { $('#tlActs').innerHTML = html; };
const body = html => { $('#tlBody').innerHTML = html; };

// ---------- timer (shared with the floating mini timer) ----------

const timer = { mode: 'timer', total: 0, left: 0, endAt: 0, running: false, startedAt: 0, elapsed: 0, mini: false, done: false };
let tick = null;
const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const nowLeft = () => (timer.running ? (timer.endAt - Date.now()) / 1000 : timer.left);
const nowElapsed = () => timer.elapsed + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0);

function setTimer(sec) { Object.assign(timer, { mode: 'timer', total: sec, left: sec, running: false, done: false }); }
function startStop() {
  if (timer.mode === 'timer') {
    if (timer.running) { timer.left = nowLeft(); timer.running = false; }
    else { if (timer.left <= 0) timer.left = timer.total; timer.endAt = Date.now() + timer.left * 1000; timer.running = true; timer.done = false; }
  } else if (timer.running) { timer.elapsed = nowElapsed(); timer.running = false; }
  else { timer.startedAt = Date.now(); timer.running = true; }
  ensureTick();
}
function reset() { timer.running = false; timer.done = false; timer.left = timer.total; timer.elapsed = 0; paintAll(); }
function ensureTick() {
  if (tick) return;
  tick = setInterval(() => {
    if (timer.mode === 'timer' && timer.running && nowLeft() <= 0) {
      timer.running = false; timer.left = 0; timer.done = true;
      sfx('chime');
      document.body.classList.add('tl-flash');
      setTimeout(() => document.body.classList.remove('tl-flash'), 2400);
    }
    paintAll();
    if (!timer.running) { clearInterval(tick); tick = null; }
  }, 200);
  paintAll();
}
function paintAll() { paintBig(); paintMini(); }

function paintMini() {
  let m = document.getElementById('tlMini');
  const show = timer.mini && (timer.total || timer.mode === 'watch') && !document.getElementById('tlRing');
  if (!show) { if (m) m.remove(); return; }
  if (!m) {
    m = document.createElement('div');
    m.id = 'tlMini';
    m.className = 'tl-mini';
    document.body.append(m);
    m.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.m === 'go') startStop();
      if (b.dataset.m === 'x') { timer.mini = false; paintMini(); }
    };
  }
  const t = timer.mode === 'timer' ? fmt(nowLeft()) : fmt(nowElapsed());
  m.classList.toggle('done', timer.done);
  m.innerHTML = `${fa('stopwatch')}<b>${t}</b><button type="button" data-m="go" aria-label="${timer.running ? '멈춤' : '시작'}">${fa(timer.running ? 'pause' : 'play')}</button><button type="button" data-m="x" aria-label="닫기">${fa('xmark')}</button>`;
}

function paintBig() {
  const ring = document.getElementById('tlRing');
  if (!ring) return;
  const isT = timer.mode === 'timer';
  const left = nowLeft();
  const p = isT ? (timer.total ? Math.max(0, left) / timer.total : 0) : (nowElapsed() % 60) / 60;
  ring.style.setProperty('--p', p);
  ring.classList.toggle('done', timer.done);
  $('#tlTime').textContent = isT ? fmt(left) : fmt(nowElapsed());
  $('#tlSub').textContent = isT ? (timer.done ? '끝! 🔔' : `${fmt(timer.total)} 타이머 · 끝나면 종소리`) : '스톱워치';
  $('#tlGo').innerHTML = `${fa(timer.running ? 'pause' : 'play')} ${timer.running ? '일시정지' : '시작'}`;
}

function drawTimer() {
  if (!timer.total && timer.mode === 'timer') setTimer(lsGet('timerLast', 180));
  acts(`<div class="seg2" id="tlMode"><button type="button" data-mode="timer" class="${timer.mode === 'timer' ? 'on' : ''}">타이머</button><button type="button" data-mode="watch" class="${timer.mode === 'watch' ? 'on' : ''}">스톱워치</button></div>`);
  body(`<div class="tl-timer"><div class="tl-ring" id="tlRing"><div><b id="tlTime"></b><small id="tlSub"></small></div></div>
    <div class="tl-chips">${timer.mode === 'timer' ? [60, 180, 300, 600].map(s => `<button type="button" data-set="${s}" class="${timer.total === s ? 'on' : ''}">${s / 60}분</button>`).join('')
      + `<label class="tl-custom"><input type="number" min="1" max="180" id="tlMin" placeholder="분" aria-label="분 직접 입력"><button type="button" id="tlSetMin">설정</button></label>` : ''}
      <button type="button" class="go" id="tlGo"></button><button type="button" id="tlReset">${fa('rotate')} 처음으로</button>
      <button type="button" id="tlMiniOn">${fa('compress')} 작게 띄우기</button></div></div>`);
  paintAll();
  const root = $('#tlBody');
  root.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.set) { setTimer(+b.dataset.set); lsSet('timerLast', +b.dataset.set); drawTimer(); }
    else if (b.id === 'tlSetMin') { const m = +$('#tlMin').value; if (m > 0) { setTimer(Math.round(m * 60)); lsSet('timerLast', Math.round(m * 60)); drawTimer(); } }
    else if (b.id === 'tlGo') startStop();
    else if (b.id === 'tlReset') reset();
    else if (b.id === 'tlMiniOn') { timer.mini = true; location.hash = `#/t/${ctx.cls.id}/tools`; }
  };
  $('#tlMode').onclick = e => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === timer.mode) return;
    Object.assign(timer, { mode: b.dataset.mode, running: false, elapsed: 0, done: false });
    if (timer.mode === 'timer') setTimer(lsGet('timerLast', 180));
    drawTimer();
  };
  const key = e => { if (e.key === ' ' && !e.target.closest('input')) { e.preventDefault(); startStop(); } };
  addEventListener('keydown', key);
  return () => { removeEventListener('keydown', key); setTimeout(paintMini, 0); };
}

// ---------- name picker ----------

function drawPick() {
  const roster = (ctx.v.roster || []).slice().sort((a, b) => String(a.sno || '').localeCompare(String(b.sno || '')) || a.number - b.number);
  const key = 'pickUsed:' + ctx.cls.id;
  let used = new Set(lsGet(key, []));
  let excl = lsGet('pickExcl', true);
  let count = 1;
  let last = [];
  let spinning = null;
  const pool = () => roster.filter(s => !excl || !used.has(s.id));
  const paint = () => {
    acts(`<div class="seg2" id="tlCount">${[1, 2, 3].map(n => `<button type="button" data-n="${n}" class="${count === n ? 'on' : ''}">${n}명</button>`).join('')}</div>
      <label class="tl-check"><input type="checkbox" id="tlExcl" ${excl ? 'checked' : ''}> 뽑힌 학생 제외</label>
      <button type="button" class="btn primary" id="tlPick">${fa('shuffle')}뽑기</button>`);
    body(`<div class="tl-pick">
      <div class="tl-names" id="tlNames">${last.length ? last.map(s => `<b>${esc(s.name)}</b>`).join('') : '<b class="idle">뽑기를 눌러 주세요</b>'}</div>
      <div class="tl-psub">${roster.length ? `${excl ? `남은 학생 ${pool().length}명` : `전체 ${roster.length}명`}${last.length ? ` · ${last.map(s => s.sno || `${s.number}번`).join(', ')}` : ''}` : '학생 명단이 비어 있어요'}</div>
      <div class="tl-used">${roster.map(s => `<button type="button" data-u="${s.id}" class="${used.has(s.id) ? 'out' : ''}" title="눌러서 제외/복귀">${esc(s.name)}</button>`).join('')}</div>
      ${used.size ? `<button type="button" class="tl-link" id="tlClear">${fa('rotate')} 처음부터 다시 (제외 ${used.size}명 풀기)</button>` : ''}</div>`);
  };
  const go = () => {
    if (spinning) return;
    let p = pool();
    if (!p.length && excl) { used = new Set(); lsSet(key, []); p = pool(); toast('모두 뽑혀서 처음부터 다시 뽑아요'); }
    if (!p.length) return toast('학생 명단을 먼저 넣어 주세요');
    const n = Math.min(count, p.length);
    const pick = [];
    const left = p.slice();
    for (let i = 0; i < n; i++) pick.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
    const box = $('#tlNames');
    let t0 = Date.now();
    sfx('drumroll');
    spinning = setInterval(() => {
      box.innerHTML = Array.from({ length: n }, () => `<b class="spin">${esc(p[Math.floor(Math.random() * p.length)].name)}</b>`).join('');
      if (Date.now() - t0 > 1400) {
        clearInterval(spinning); spinning = null;
        last = pick;
        if (excl) { pick.forEach(s => used.add(s.id)); lsSet(key, [...used]); }
        sfx('fanfare');
        paint();
        $('#tlNames').animate([{ transform: 'scale(.7)', opacity: .3 }, { transform: 'scale(1.06)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      }
    }, 70);
  };
  paint();
  $('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (b && b.dataset.n) { count = +b.dataset.n; paint(); }
    else if (b && b.id === 'tlPick') go();
  };
  $('#tlActs').onchange = e => { if (e.target.id === 'tlExcl') { excl = e.target.checked; lsSet('pickExcl', excl); paint(); } };
  $('#tlBody').onclick = e => {
    const u = e.target.closest('[data-u]');
    if (u) { used.has(u.dataset.u) ? used.delete(u.dataset.u) : used.add(u.dataset.u); lsSet(key, [...used]); paint(); }
    if (e.target.closest('#tlClear')) { used = new Set(); lsSet(key, []); last = []; paint(); }
  };
  const k = e => { if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('input, button')) { e.preventDefault(); go(); } };
  addEventListener('keydown', k);
  return () => { removeEventListener('keydown', k); if (spinning) clearInterval(spinning); };
}

// ---------- dice / coin / wheel ----------

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const die = n => `<div class="tl-die">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i + 1) ? 'on' : ''}"></i>`).join('')}</div>`;
const WHEEL_COLORS = ['#2fd39a', '#16352a', '#ffc58a', '#2f5c4b', '#8fb6ff', '#1d2a24', '#ff8a6b', '#3a4a43'];

function drawDice() {
  let mode = lsGet('diceMode', 'dice');
  let n = lsGet('diceCount', 2);
  const wkey = 'wheel:' + ctx.cls.id;
  let items = lsGet(wkey, ['1모둠', '2모둠', '3모둠', '4모둠', '5모둠', '6모둠']);
  let rot = 0;
  let busy = false;
  const paint = () => {
    acts(`<div class="seg2" id="tlDM">${[['dice', '주사위'], ['coin', '동전'], ['wheel', '룰렛']].map(([k, t]) => `<button type="button" data-m="${k}" class="${mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      ${mode === 'dice' ? `<div class="seg2" id="tlDN">${[1, 2, 3].map(k => `<button type="button" data-k="${k}" class="${n === k ? 'on' : ''}">${k}개</button>`).join('')}</div>` : ''}
      ${mode === 'wheel' ? `<button type="button" class="btn" id="tlWEdit">${fa('pen')}항목</button>` : ''}
      <button type="button" class="btn primary" id="tlRoll">${fa(mode === 'wheel' ? 'dharmachakra' : mode === 'coin' ? 'coins' : 'dice')}${mode === 'wheel' ? '돌리기' : mode === 'coin' ? '던지기' : '굴리기'}</button>`);
    if (mode === 'dice') body(`<div class="tl-dice" id="tlDice">${Array.from({ length: n }, () => die(6)).join('')}</div><div class="tl-res" id="tlRes"></div>`);
    else if (mode === 'coin') body(`<div class="tl-coin" id="tlCoin"><span>앞</span></div><div class="tl-res" id="tlRes"></div>`);
    else {
      const seg = 360 / items.length;
      const grad = items.map((_, i) => `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',');
      body(`<div class="tl-wheelwrap"><div class="tl-needle"></div><div class="tl-wheel" id="tlWheel" style="background:conic-gradient(${grad});transform:rotate(${rot}deg)">
        ${items.map((t, i) => `<span style="transform:rotate(${i * seg + seg / 2}deg) translateY(calc(var(--wr) * -.34)) rotate(${-(i * seg + seg / 2) - rot}deg)">${esc(t)}</span>`).join('')}</div></div><div class="tl-res" id="tlRes"></div>`);
    }
  };
  const roll = () => {
    if (busy) return;
    busy = true;
    if (mode === 'dice') {
      const box = $('#tlDice');
      const final = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
      sfx('roll');
      let k = 0;
      const t = setInterval(() => {
        box.innerHTML = Array.from({ length: n }, (_, i) => die(k > 9 ? final[i] : 1 + Math.floor(Math.random() * 6))).join('');
        box.querySelectorAll('.tl-die').forEach((d, i) => { d.style.transform = `rotate(${k > 9 ? (i % 2 ? 8 : -8) : Math.random() * 60 - 30}deg)`; });
        if (++k > 10) { clearInterval(t); busy = false; $('#tlRes').textContent = n > 1 ? `${final.join(' + ')} = ${final.reduce((a, b) => a + b, 0)}` : String(final[0]); sfx('ding'); }
      }, 70);
    } else if (mode === 'coin') {
      const head = Math.random() < .5;
      const c = $('#tlCoin');
      sfx('roll');
      c.animate([{ transform: 'rotateY(0) translateY(0)' }, { transform: 'rotateY(900deg) translateY(-120px)', offset: .5 }, { transform: `rotateY(${head ? 1800 : 1980}deg) translateY(0)` }], { duration: 1100, easing: 'ease-in-out' }).onfinish = () => {
        c.querySelector('span').textContent = head ? '앞' : '뒤';
        c.classList.toggle('tail', !head);
        $('#tlRes').textContent = head ? '앞면' : '뒷면';
        busy = false;
        sfx('ding');
      };
    } else {
      if (items.length < 2) { busy = false; return toast('항목을 두 개 이상 넣어 주세요'); }
      const seg = 360 / items.length;
      const win = Math.floor(Math.random() * items.length);
      // needle at top: the winning slice centre must end at 0°
      const target = 360 - (win * seg + seg / 2) + (Math.random() - .5) * seg * .6;
      rot = rot - (rot % 360) + 360 * 6 + target;
      const w = $('#tlWheel');
      w.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.15,1)';
      w.style.transform = `rotate(${rot}deg)`;
      w.querySelectorAll('span').forEach((s, i) => { s.style.transition = 'transform 4.2s cubic-bezier(.12,.7,.15,1)'; s.style.transform = `rotate(${i * seg + seg / 2}deg) translateY(calc(var(--wr) * -.34)) rotate(${-(i * seg + seg / 2) - rot}deg)`; });
      sfx('drumroll');
      setTimeout(() => { busy = false; $('#tlRes').textContent = items[win]; sfx('fanfare'); }, 4300);
    }
  };
  paint();
  $('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b || busy) return;
    if (b.dataset.m) { mode = b.dataset.m; lsSet('diceMode', mode); paint(); }
    else if (b.dataset.k) { n = +b.dataset.k; lsSet('diceCount', n); paint(); }
    else if (b.id === 'tlRoll') roll();
    else if (b.id === 'tlWEdit') {
      const names = (ctx.v.roster || []).map(s => s.name);
      const d = document.createElement('dialog');
      d.className = 'sheet';
      d.innerHTML = `<form method="dialog" class="seat-form"><h3>${fa('dharmachakra')} 룰렛 항목</h3><p class="muted small">한 줄에 하나씩 (2~16개)</p>
        <textarea rows="8" id="tlWItems">${esc(items.join('\n'))}</textarea>
        <div class="acts"><button type="button" class="btn" data-names>학생 이름 불러오기</button><span class="sp"></span><button type="button" class="btn" data-x>취소</button><button class="btn primary">저장</button></div></form>`;
      document.body.append(d);
      d.showModal();
      d.querySelector('[data-names]').onclick = () => { d.querySelector('#tlWItems').value = names.slice(0, 16).join('\n'); };
      d.querySelector('[data-x]').onclick = () => { d.close(); d.remove(); };
      d.querySelector('form').onsubmit = e2 => {
        e2.preventDefault();
        const list = d.querySelector('#tlWItems').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 16);
        if (list.length < 2) return toast('항목을 두 개 이상 넣어 주세요');
        items = list; lsSet(wkey, items); rot = 0;
        d.close(); d.remove(); paint();
      };
    }
  };
  const k = e => { if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('input, button, textarea, dialog')) { e.preventDefault(); roll(); } };
  addEventListener('keydown', k);
  return () => removeEventListener('keydown', k);
}

// ---------- big text board ----------

function drawBoard() {
  const key = 'board:' + ctx.cls.id;
  let slides = lsGet(key, ['Read the passage and find the main idea.\n지문을 읽고 주제를 찾아보세요']);
  let at = 0;
  let editing = false;
  const fit = () => {
    const el = $('#tlBoard');
    if (!el) return;
    const box = $('#tlBody');
    let size = 160;
    el.style.fontSize = size + 'px';
    while (size > 24 && (el.scrollHeight > box.clientHeight - 80 || el.scrollWidth > box.clientWidth - 60)) { size -= 6; el.style.fontSize = size + 'px'; }
  };
  const paint = () => {
    acts(editing ? `<button type="button" class="btn primary" id="tlBDone">${fa('check')}다 썼어요</button>`
      : `<button type="button" class="btn" id="tlBPrev" ${at ? '' : 'disabled'}>${fa('chevron-left')}</button><span class="tl-pg">${at + 1} / ${slides.length}</span><button type="button" class="btn" id="tlBNext" ${at < slides.length - 1 ? '' : 'disabled'}>${fa('chevron-right')}</button><button type="button" class="btn" id="tlBEdit">${fa('pen')}편집</button>`);
    if (editing) {
      body(`<div class="tl-bedit"><p class="muted small">한 칸이 한 장이에요. 첫 줄은 크게, 둘째 줄부터는 작은 글씨로 보여요.</p>
        ${slides.map((s, i) => `<div class="tl-bslide"><span>${i + 1}</span><textarea data-i="${i}" rows="3">${esc(s)}</textarea><button type="button" data-del="${i}" aria-label="이 장 지우기">${fa('trash-can')}</button></div>`).join('')}
        <button type="button" class="sv-addq" id="tlBAdd">${fa('plus')} 장 추가</button></div>`);
    } else {
      const [first, ...rest] = String(slides[at] || '').split('\n');
      body(`<div class="tl-board" id="tlBoard">${esc(first)}${rest.length ? `<small>${esc(rest.join('\n'))}</small>` : ''}</div>
        <div class="tl-dots">${slides.map((_, i) => `<i class="${i === at ? 'on' : ''}"></i>`).join('')}</div>`);
      requestAnimationFrame(fit);
    }
  };
  paint();
  $('#tlActs').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'tlBPrev' && at) at--;
    else if (b.id === 'tlBNext' && at < slides.length - 1) at++;
    else if (b.id === 'tlBEdit') editing = true;
    else if (b.id === 'tlBDone') { slides = slides.map(s => s.trim()).filter(Boolean); if (!slides.length) slides = ['']; lsSet(key, slides); at = Math.min(at, slides.length - 1); editing = false; }
    paint();
  };
  $('#tlBody').oninput = e => { const t = e.target.closest('[data-i]'); if (t) { slides[+t.dataset.i] = t.value; lsSet(key, slides); } };
  $('#tlBody').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'tlBAdd') { slides.push(''); paint(); $(`[data-i="${slides.length - 1}"]`).focus(); }
    else if (b.dataset.del) { slides.splice(+b.dataset.del, 1); if (!slides.length) slides = ['']; paint(); }
  };
  const k = e => {
    if (editing || e.target.closest('input, textarea')) return;
    if ((e.key === 'ArrowRight' || e.key === 'PageDown') && at < slides.length - 1) { at++; paint(); }
    if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && at) { at--; paint(); }
  };
  addEventListener('keydown', k);
  addEventListener('resize', fit);
  document.addEventListener('fullscreenchange', fit);
  return () => { removeEventListener('keydown', k); removeEventListener('resize', fit); document.removeEventListener('fullscreenchange', fit); };
}

// ---------- activity signal ----------

const SIGNALS = [['🤫', '조용히'], ['🤝', '짝 활동'], ['👥', '모둠 활동'], ['🎤', '발표'], ['🧹', '정리']];

function drawSignal() {
  const key = 'signals:' + ctx.cls.id;
  let list = lsGet(key, SIGNALS);
  let on = lsGet('signalOn:' + ctx.cls.id, 0);
  let editing = false;
  const paint = () => {
    acts(`<button type="button" class="btn" id="tlSEdit">${fa(editing ? 'check' : 'pen')}${editing ? '다 썼어요' : '문구 편집'}</button>`);
    if (editing) {
      body(`<div class="tl-bedit">${list.map(([e, t], i) => `<div class="tl-bslide"><input data-e="${i}" value="${esc(e)}" maxlength="4" class="tl-emoji" aria-label="이모지"><input data-t="${i}" value="${esc(t)}" maxlength="16" aria-label="문구"></div>`).join('')}</div>`);
    } else {
      const cur = list[on] || list[0];
      body(`<div class="tl-signal"><div class="tl-sigbig">${esc(cur[0])} ${esc(cur[1])}</div>
        <div class="tl-sigs">${list.map(([e, t], i) => `<button type="button" class="${i === on ? 'on' : ''}" data-s="${i}"><i>${esc(e)}</i>${esc(t)}</button>`).join('')}</div></div>`);
    }
  };
  paint();
  $('#tlActs').onclick = e => { if (e.target.closest('#tlSEdit')) { editing = !editing; paint(); } };
  $('#tlBody').oninput = e => {
    const t = e.target;
    if (t.dataset.e) list[+t.dataset.e][0] = t.value;
    if (t.dataset.t) list[+t.dataset.t][1] = t.value;
    lsSet(key, list);
  };
  $('#tlBody').onclick = e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    on = +b.dataset.s;
    lsSet('signalOn:' + ctx.cls.id, on);
    sfx(list[on][1].includes('조용') ? 'shh' : 'chime');
    paint();
  };
}

// ---------- sound board ----------

const SOUNDS = [['chime', 'bell', '집중 종'], ['ding', 'circle-check', '딩동 · 정답'], ['buzz', 'circle-xmark', '띠링 · 오답'], ['clap', 'hands-clapping', '박수'],
  ['count', 'hourglass-half', '3 · 2 · 1'], ['drumroll', 'drum', '드럼롤'], ['fanfare', 'trophy', '팡파르'], ['shh', 'volume-xmark', '조용히']];

function drawSound() {
  body(`<div class="tl-sounds">${SOUNDS.map(([k, i, t], n) => `<button type="button" data-snd="${k}"><i>${fa(i)}</i>${t}<small>${n + 1}</small></button>`).join('')}</div>`);
  const play = k => { sfx(k); const b = $(`[data-snd="${k}"]`); if (b) b.animate([{ transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 200 }); };
  $('#tlBody').onclick = e => { const b = e.target.closest('[data-snd]'); if (b) play(b.dataset.snd); };
  const k = e => { const i = +e.key; if (i >= 1 && i <= SOUNDS.length && !e.target.closest('input, textarea')) play(SOUNDS[i - 1][0]); };
  addEventListener('keydown', k);
  return () => removeEventListener('keydown', k);
}
