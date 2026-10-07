import { esc } from './lib.js';

const root = () => document.getElementById('app');
export const render = html => { root().innerHTML = html; };
export const $ = sel => root().querySelector(sel);
export const fail = e => render(`<section class="center"><div class="hero-card error">
  <div class="err-ic">📡</div><h2>${e.code === 'offline' ? '연결이 잠시 끊겼어요' : '문제가 생겼어요'}</h2>
  <p class="muted">${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`);

// Shimmering placeholders shaped like the screen that is loading, instead of a bare "loading" line.
const sk = (style, cls = '') => `<div class="sk ${cls}" style="${style}"></div>`;
const SKELETONS = {
  home: () => `<div class="sk-head"><div>${sk('width:120px;height:12px;border-radius:6px;margin-bottom:10px')}${sk('width:190px;height:22px;border-radius:8px')}</div>${sk('width:42px;height:42px;border-radius:50%')}</div>
    <div class="sk-row">${sk('height:200px')}<div class="sk-col">${sk('')}${sk('')}</div></div>
    ${sk('width:70px;height:14px;border-radius:6px;margin-bottom:12px')}${sk('height:150px;margin-bottom:10px')}${sk('height:110px')}`,
  teacher: () => `<div class="t-layout"><aside class="side">${sk('height:28px;width:120px;margin-bottom:24px')}${sk('height:38px;margin-bottom:6px')}${sk('height:38px')}</aside>
    <main class="tmain">${sk('height:30px;width:260px')}<div class="t-bento">${sk('height:128px')}${sk('height:128px')}${sk('height:128px')}${sk('height:128px')}</div>${sk('height:380px')}</main></div>`,
  page: () => `${sk('height:40px;width:60%;margin:8px 0 18px')}${sk('height:260px;margin-bottom:12px')}${sk('height:120px')}`,
};
export const loading = (kind = 'page') => render(SKELETONS[kind]());

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

// Navigation counter: a view captures currentNav() and skips rendering once a newer route() has started.
let nav = 0;
export const nextNav = () => ++nav;
export const currentNav = () => nav;
export const isCurrent = n => n === nav;
