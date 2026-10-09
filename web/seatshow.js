// Full-screen seat reveal for the class to watch. The arrangement is already decided; this only stages it.
// mode: 'slot' (names spin, then stop front row first) | 'magnet' (name magnets fly in one by one).
import { gridHtml } from './seats.js';
import { esc } from './lib.js';
import { fa } from './fa.js';

let audio = null;
function beep(kind) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.connect(g); g.connect(audio.destination);
    if (kind === 'tick') { o.type = 'square'; o.frequency.setValueAtTime(900, t); g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.0001, t + .05); o.start(t); o.stop(t + .05); }
    else { o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(880, t + .12); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.0001, t + .18); o.start(t); o.stop(t + .18); }
  } catch { /* no audio: silent */ }
}

export function showSeats({ L, who, title, mode = 'slot', speed = 'normal', sound = true }) {
  return new Promise(resolve => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = document.createElement('div');
    el.className = 'seat-show';
    el.innerHTML = `<div class="seat-show-ttl">${esc(title)} <span>새 자리</span>를 공개합니다</div>
      <div class="seat-room student"><div class="seat-desk">교탁</div>${gridHtml(L, { view: 'student', who, show: true })}</div>
      <button type="button" class="btn seat-show-x" data-end="close">${fa('xmark')}닫기</button>
      <div class="seat-show-ctl"><button type="button" class="btn" id="ssAll">바로 모두 보기</button></div>
      ${speed === 'step' ? '<div class="seat-show-tip">화면을 누르거나 스페이스 키를 누를 때마다 한 명씩 공개돼요</div>' : ''}`;
    document.body.append(el);
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});

    // size cells to the screen
    const aisles = L.pairs ? Math.floor((L.cols - 1) / 2) : 0;
    const w = Math.min(190, (innerWidth - 120 - 14 * (L.cols - 1 + aisles) - 24 * aisles) / L.cols);
    const h = Math.min(100, (innerHeight - 250 - 14 * (L.rows - 1)) / L.rows);
    el.style.setProperty('--seat-w', Math.max(70, w) + 'px');
    el.style.setProperty('--seat-h', Math.max(46, h) + 'px');
    el.style.setProperty('--seat-aisle', '24px');

    const cell = i => el.querySelector(`.seat-cell[data-i="${i}"]`);
    const fixed = new Set(L.fixed);
    const fill = i => {
      const c = cell(i), s = who[L.assign[i]];
      if (!c || !s) return;
      c.dataset.done = 1;
      c.innerHTML = `<b>${esc(s.name)}</b>${fixed.has(i) ? `<span class="seat-pin">${fa('thumbtack')}</span>` : ''}`;
      c.classList.add('done');
    };
    Object.keys(L.assign).map(Number).filter(i => fixed.has(i)).forEach(fill);
    const order = Object.keys(L.assign).map(Number).filter(i => !fixed.has(i)).sort((a, b) => a - b);
    const nameList = order.map(i => who[L.assign[i]].name);

    const timers = [];
    let k = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(t => { clearTimeout(t); clearInterval(t); });
      el.querySelectorAll('.seat-mag, .seat-big').forEach(m => m.remove());
      order.forEach(fill);
      el.querySelector('.seat-show-ctl').innerHTML = `<button type="button" class="btn" data-end="again">${fa('shuffle')}다시 섞기</button><button type="button" class="btn primary" data-end="ok">${fa('check')}이대로 확정</button>`;
      const tip = el.querySelector('.seat-show-tip');
      if (tip) tip.remove();
    };

    let mags = [];
    if (mode === 'magnet' && !reduce) {
      mags = order.map(i => {
        const m = document.createElement('div');
        m.className = 'seat-mag';
        m.textContent = who[L.assign[i]].name;
        m.style.left = (40 + Math.random() * (innerWidth - 200)) + 'px';
        m.style.top = (110 + Math.random() * (innerHeight - 260)) + 'px';
        m.style.setProperty('--r', (Math.random() * 40 - 20) + 'deg');
        el.append(m);
        return m;
      });
    } else if (!reduce) {
      order.forEach(i => cell(i).classList.add('spin'));
      timers.push(setInterval(() => order.forEach(i => { const c = cell(i); if (!c.dataset.done) c.innerHTML = `<b>${esc(nameList[Math.floor(Math.random() * nameList.length)])}</b>`; }), 70));
    }

    const next = () => {
      if (done) return;
      if (k >= order.length) return finish();
      const i = order[k], m = mags[k];
      k++;
      if (m) {
        const to = cell(i).getBoundingClientRect(), from = m.getBoundingClientRect();
        m.classList.add('go');
        const big = document.createElement('div');
        big.className = 'seat-big';
        big.textContent = m.textContent;
        el.append(big);
        big.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .3 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.12)' }], { duration: 800 }).onfinish = () => big.remove();
        const dx = to.left - from.left, dy = to.top - from.top;
        m.animate([
          { transform: 'translate(0,0) rotate(var(--r))' },
          { transform: `translate(${dx / 2}px, ${Math.min(0, dy) / 2 - 140}px) rotate(0) scale(1.18)`, offset: .55 },
          { transform: `translate(${dx}px, ${dy}px) rotate(0) scale(1)` },
        ], { duration: 700, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => {
          m.remove(); fill(i);
          cell(i).animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 300 });
          if (sound) beep('pop');
          if (k >= order.length && speed !== 'step') timers.push(setTimeout(finish, 500));
        };
      } else {
        fill(i);
        cell(i).classList.remove('spin');
        if (!reduce) cell(i).animate([{ transform: 'translateY(-14px)', filter: 'brightness(1.6)' }, { transform: 'translateY(0)', filter: 'none' }], { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' });
        if (sound) beep('tick');
        if (k >= order.length) timers.push(setTimeout(finish, 400));
      }
    };

    if (reduce) finish();
    else if (speed !== 'step') {
      const total = speed === 'fast' ? 5000 : 12000;
      const gap = Math.max(mode === 'magnet' ? 380 : 120, total / Math.max(1, order.length));
      order.forEach((_, n) => timers.push(setTimeout(next, 900 + n * gap)));
    }

    const end = res => {
      timers.forEach(t => { clearTimeout(t); clearInterval(t); });
      removeEventListener('keydown', key);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      el.remove();
      resolve(res);
    };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); end('close'); }
      else if ((e.key === ' ' || e.key === 'Enter') && speed === 'step' && !done) { e.preventDefault(); next(); }
    };
    addEventListener('keydown', key);
    el.onclick = e => {
      const b = e.target.closest('[data-end]');
      if (b) return end(b.dataset.end);
      if (e.target.closest('#ssAll')) return finish();
      if (speed === 'step' && !done && !e.target.closest('button')) next();
    };
  });
}
