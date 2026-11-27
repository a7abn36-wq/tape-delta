// Wyckoff range detector. DERIVED, rules-based pattern recognition, not a prediction and not backtested.
// Finds the most recent sideways range (height <= 12 ATR, >=2 touches near each edge, >=30 bars), the move that led into it
// (accumulation after a decline, distribution after a rally), and a Spring (dip below support closing back inside) or UTAD
// (poke above resistance closing back inside) in the last 15 bars. Only closed bars are used.
import { wilderATR } from './ict.js';
export function wyckoff(c) {
  const n = c.length; if (n < 150) return null; const atr = wilderATR(c), A = atr[n - 1]; if (!(A > 0)) return null;
  let best = null;
  for (const W of [40, 60, 90, 120]) {
    const end = n - 1 - 15 > 0 ? n - 1 : n - 1; const s0 = n - W, core = c.slice(s0, n - 8); // core excludes the last 8 bars so a spring can sit just after it
    let hi = -Infinity, lo = Infinity; for (const x of core) { hi = Math.max(hi, x.h); lo = Math.min(lo, x.l); }
    const H = hi - lo; if (H > 12 * A || H < 1.2 * A) continue;
    const tol = 0.6 * A; let tl = 0, th = 0, lastL = -9, lastH = -9; core.forEach((x, i) => { if (x.l <= lo + tol && i - lastL >= 3) { tl++; lastL = i; } if (x.h >= hi - tol && i - lastH >= 3) { th++; lastH = i; } });
    if (tl < 2 || th < 2) continue;
    const pre = c[s0 - 1].c, pre2 = c[Math.max(0, s0 - 40)].c; const lead = pre - pre2; const mid = (hi + lo) / 2;
    const kind = lead < -1.5 * H ? 'accumulation' : lead > 1.5 * H ? 'distribution' : 'undetermined';
    if (!best || W > best.W) best = { W, s0, hi, lo, H, tl, th, kind, lead };
  }
  if (!best) return { state: 'none' };
  const r = best, avgV = c.slice(r.s0, n - 8).reduce((s, x) => s + x.v, 0) / (n - 8 - r.s0);
  let ev = null;
  for (let i = n - 15; i < n; i++) { const x = c[i]; if (i < r.s0 + 20) continue;
    if (x.l < r.lo - 0.05 * A && x.l > r.lo - 2 * A && x.c > r.lo) ev = { type: 'spring', i, vol: x.v / avgV, depth: (r.lo - x.l) / A };
    if (x.h > r.hi + 0.05 * A && x.h < r.hi + 2 * A && x.c < r.hi) ev = { type: 'utad', i, vol: x.v / avgV, depth: (x.h - r.hi) / A }; }
  const px = c[n - 1].c, broke = px > r.hi + 0.5 * A ? 'up' : px < r.lo - 0.5 * A ? 'down' : null;
  return { state: ev ? ev.type : broke ? 'broken' : 'range', range: r, ev, broke, px, A, bars: n - r.s0, avgV };
}
