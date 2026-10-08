import qrcode from './vendor/qrcode.js';

// SVG QR code for text; cell = pixel size of one module.
export function qrSvg(text, cell = 3) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 0 });
}

// The link a student scans: opens the app with the class code already filled in.
export const joinUrl = code => `${location.origin}${location.pathname}#/join/${code}`;
