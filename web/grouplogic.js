// Random groups (pure, no DOM). opts: { size } students per group, or { count } groups.
// Rules: apart pairs never share a group, together pairs always do. Sizes differ by at most one.
export function makeGroups(studentIds, opts, apart = [], together = [], rand = Math.random) {
  const n = studentIds.length;
  if (!n) return [];
  const k = Math.max(1, Math.min(n, opts.count ? +opts.count : Math.ceil(n / Math.max(1, +opts.size || 4))));
  const pool = studentIds.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const groups = Array.from({ length: k }, () => []);
  pool.forEach((s, i) => groups[i % k].push(s));

  const at = () => { const m = {}; groups.forEach((g, gi) => g.forEach(s => { m[s] = gi; })); return m; };
  const bad = m => apart.filter(([a, b]) => a in m && b in m && m[a] === m[b]).length * 1
    + together.filter(([a, b]) => a in m && b in m && m[a] !== m[b]).length;
  // swap two students in different groups while that lowers the number of broken rules (sizes never change)
  let m = at(), cost = bad(m);
  for (let t = 0; t < 5000 && cost > 0; t++) {
    const g1 = Math.floor(rand() * k), g2 = Math.floor(rand() * k);
    if (g1 === g2) continue;
    const i1 = Math.floor(rand() * groups[g1].length), i2 = Math.floor(rand() * groups[g2].length);
    [groups[g1][i1], groups[g2][i2]] = [groups[g2][i2], groups[g1][i1]];
    const m2 = at(), c2 = bad(m2);
    if (c2 <= cost) { m = m2; cost = c2; } else [groups[g1][i1], groups[g2][i2]] = [groups[g2][i2], groups[g1][i1]];
  }
  return groups;
}
