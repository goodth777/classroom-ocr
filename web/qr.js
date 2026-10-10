import qrcode from './vendor/qrcode.js';

// The library's default keeps only the low byte of each character, which breaks Korean text.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

// SVG QR code for text; cell = pixel size of one module, margin = white border in modules (phones want 4).
export function qrSvg(text, cell = 3, margin = 0) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: margin * cell });
}

// The link a student scans: opens the app with the class code already filled in.
export const joinUrl = code => `${location.origin}${location.pathname}#/join/${code}`;
