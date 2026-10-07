import { esc } from './lib.js';

const root = () => document.getElementById('app');
export const render = html => { root().innerHTML = html; };
export const $ = sel => root().querySelector(sel);
export const loading = () => render('<div class="loading">불러오는 중…</div>');
export const fail = e => render(`<section class="center"><div class="card hero error">
  <p>${esc(e.message)}</p><button onclick="location.reload()">다시 시도</button></div></section>`);
