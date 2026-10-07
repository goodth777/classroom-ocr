import { esc } from './lib.js';

const root = () => document.getElementById('app');
export const render = html => { root().innerHTML = html; };
export const $ = sel => root().querySelector(sel);
export const loading = () => render('<div class="loading">불러오는 중…</div>');
export const fail = e => render(`<section class="center"><div class="hero-card error">
  <p>${esc(e.message)}</p><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`);

let toastTimer;
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// Navigation counter: a view captures currentNav() and skips rendering once a newer route() has started.
let nav = 0;
export const nextNav = () => ++nav;
export const currentNav = () => nav;
export const isCurrent = n => n === nav;
