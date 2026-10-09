// Classroom sound effects made on the device with Web Audio (no sound files to download).
let ac = null;
const ctx = () => (ac = ac || new (window.AudioContext || window.webkitAudioContext)());

function tone(freq, start, dur, { type = 'sine', vol = .2, to } = {}) {
  const a = ctx(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime + start;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + .01);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t + dur + .02);
}

function noise(start, dur, { vol = .25, freq = 2000, q = .7, type = 'bandpass' } = {}) {
  const a = ctx(), len = Math.ceil(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + start;
  s.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(a.destination);
  s.start(t); s.stop(t + dur);
}

const SOUNDS = {
  chime: () => { [880, 1320, 1760].forEach((f, i) => tone(f, i * .02, 1.8, { vol: .16 / (i + 1) })); tone(660, .5, 1.6, { vol: .1 }); },
  ding: () => { tone(988, 0, .35, { vol: .22 }); tone(1319, .16, .6, { vol: .22 }); },
  buzz: () => { tone(220, 0, .35, { type: 'square', vol: .08 }); tone(196, .18, .45, { type: 'square', vol: .08 }); },
  clap: () => { for (let i = 0; i < 14; i++) noise(i * .09 + Math.random() * .04, .08, { vol: .35, freq: 1500 + Math.random() * 800 }); },
  count: () => { [0, 1, 2].forEach(i => tone(660, i, .18, { vol: .2 })); tone(1320, 3, .7, { vol: .22 }); },
  drumroll: () => { for (let i = 0; i < 26; i++) noise(i * .05, .06, { vol: .12 + i * .008, freq: 180, q: 1, type: 'lowpass' }); noise(1.35, .5, { vol: .4, freq: 3000 }); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .12, i === 3 ? .7 : .16, { type: 'triangle', vol: .2 })); },
  shh: () => noise(0, 1.2, { vol: .18, freq: 3500, q: .5 }),
  roll: () => { for (let i = 0; i < 8; i++) noise(i * .07, .05, { vol: .2, freq: 900 + Math.random() * 600, q: 2 }); },
};

export function sfx(name) {
  try {
    if (ctx().state === 'suspended') ac.resume();
    (SOUNDS[name] || (() => {}))();
  } catch { /* no audio on this device: stay silent */ }
}
