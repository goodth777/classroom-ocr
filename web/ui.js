import { esc } from './lib.js';

const root = () => document.getElementById('app');
export const render = html => { root().innerHTML = html; };
export const $ = sel => root().querySelector(sel);
export const loading = () => render('<div class="loading">불러오는 중…</div>');
export const fail = e => render(`<section class="center"><div class="card hero error">
  <p>${esc(e.message)}</p><button onclick="location.reload()">다시 시도</button></div></section>`);

// Navigation counter: a view captures currentNav() and skips rendering once a newer route() has started.
let nav = 0;
export const nextNav = () => ++nav;
export const currentNav = () => nav;
export const isCurrent = n => n === nav;
