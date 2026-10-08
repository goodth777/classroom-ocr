// Renders tools/icon.svg into every icon and iPhone splash size with headless Chrome.
// Run: node tools/make-icons.mjs   (needs Google Chrome installed)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'web', 'icons');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(root, 'tools', 'icon.svg'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'icons-'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function shoot(name, w, h, html) {
  const page = join(tmp, name + '.html');
  writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}</style>${html}`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, `--screenshot=${join(out, name)}`, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' });
  console.log('wrote', name);
}

const icon = s => `<div style="width:${s}px;height:${s}px">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div>`;
for (const [name, s] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) shoot(name, s, s, icon(s));

// iPhone launch screens (portrait, device pixels). Android builds its own from the manifest.
const SPLASH = [[750, 1334], [828, 1792], [1125, 2436], [1170, 2532], [1179, 2556], [1242, 2688], [1284, 2778], [1290, 2796]];
for (const [w, h] of SPLASH) {
  const s = Math.round(w * 0.3);
  shoot(`splash-${w}x${h}.png`, w, h, `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
    <div style="width:${w}px;height:${h}px;background:#0a0c0b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(w * 0.05)}px">
      <div style="width:${s}px;height:${s}px;border-radius:${Math.round(s * 0.23)}px;overflow:hidden;box-shadow:0 0 ${Math.round(s * 0.5)}px rgba(47,211,154,.25)">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div>
      <div style="font:700 ${Math.round(w * 0.06)}px 'Pretendard Variable',Pretendard,sans-serif;color:#eef3f0">과제 제출</div>
    </div>`);
}
