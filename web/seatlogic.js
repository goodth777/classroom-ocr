// Pure seating logic (no DOM): desk layout, neighbours, random arrangement with rules. Seat i = row * cols + col, row 0 = front.

export function blankLayout(rows = 5, cols = 6) {
  return { rows, cols, desks: Array(rows * cols).fill(true), pairs: false, assign: {}, fixed: [], apart: [], top: '', bottom: '', base: '' };
}

// Up/down/left/right desks. With pairs on, the aisle after every second column (between c and c+1 when c is odd) separates seats.
export function neighbours(L, i) {
  const r = Math.floor(i / L.cols), c = i % L.cols, out = [];
  const add = (rr, cc) => { if (rr >= 0 && rr < L.rows && cc >= 0 && cc < L.cols && L.desks[rr * L.cols + cc]) out.push(rr * L.cols + cc); };
  add(r - 1, c); add(r + 1, c);
  if (!(L.pairs && (c - 1) % 2 === 1)) add(r, c - 1);
  if (!(L.pairs && c % 2 === 1)) add(r, c + 1);
  return out;
}

const keepSeats = (L, ok) => ({
  ...L,
  assign: Object.fromEntries(Object.entries(L.assign).filter(([i]) => ok(+i))),
  fixed: L.fixed.filter(ok),
});

export function toggleDesk(L, i) {
  const desks = L.desks.slice();
  desks[i] = !desks[i];
  return keepSeats({ ...L, desks }, j => desks[j]);
}

export function resize(L, rows, cols) {
  const map = {}; // old index -> new index
  const desks = Array(rows * cols).fill(true);
  for (let r = 0; r < Math.min(rows, L.rows); r++) for (let c = 0; c < Math.min(cols, L.cols); c++) {
    map[r * L.cols + c] = r * cols + c;
    desks[r * cols + c] = L.desks[r * L.cols + c];
  }
  const assign = {};
  Object.entries(L.assign).forEach(([i, s]) => { const j = map[i]; if (j !== undefined && desks[j]) assign[j] = s; });
  const fixed = L.fixed.map(i => map[i]).filter(j => j !== undefined && desks[j]);
  return { ...L, rows, cols, desks, assign, fixed };
}

export const unplaced = (L, studentIds) => { const sat = new Set(Object.values(L.assign)); return studentIds.filter(s => !sat.has(s)); };

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Random seats for everyone not pinned. Rules: pinned stay; avoid each student's seat in `base`; apart pairs never neighbour.
// Swaps rule-breaking students until clean (or a few thousand tries); apart pairs weigh far more than same-seat.
export function arrange(L, studentIds, base = {}, rand = Math.random) {
  const pinned = {};
  L.fixed.forEach(i => { if (L.desks[i] && L.assign[i] && studentIds.includes(L.assign[i])) pinned[i] = L.assign[i]; });
  const pinnedSet = new Set(Object.values(pinned));
  const free = shuffle(L.desks.map((d, i) => (d && !(i in pinned) ? i : -1)).filter(i => i >= 0), rand);
  const pool = shuffle(studentIds.filter(s => !pinnedSet.has(s)), rand);
  const seat = Array(L.desks.length).fill(null); // seat index -> student
  Object.entries(pinned).forEach(([i, s]) => { seat[i] = s; });
  free.forEach((i, k) => { if (k < pool.length) seat[i] = pool[k]; });
  const unseated = pool.slice(free.length);

  const partner = {};
  (L.apart || []).forEach(([a, b]) => { (partner[a] ??= []).push(b); (partner[b] ??= []).push(a); });
  const nb = L.desks.map((_, i) => neighbours(L, i));
  const apartBad = i => !!seat[i] && nb[i].some(j => seat[j] && (partner[seat[i]] || []).includes(seat[j]));
  const sameBad = i => !!seat[i] && base[i] === seat[i];
  const cost = i => (apartBad(i) ? 1000 : 0) + (sameBad(i) ? 1 : 0);
  const total = () => free.reduce((n, i) => n + cost(i), 0);

  let now = total();
  for (let t = 0; t < 4000 && now > 0; t++) {
    const bad = free.filter(i => cost(i) > 0);
    const a = bad[Math.floor(rand() * bad.length)];
    const b = free[Math.floor(rand() * free.length)];
    if (a === b) continue;
    [seat[a], seat[b]] = [seat[b], seat[a]];
    const next = total();
    if (next <= now) now = next; else [seat[a], seat[b]] = [seat[b], seat[a]];
  }
  const assign = {};
  seat.forEach((s, i) => { if (s) assign[i] = s; });
  return {
    assign,
    same: free.filter(sameBad).length, // pinned students staying put is intended, not counted
    apartFail: free.filter(apartBad).length,
    unseated,
  };
}
