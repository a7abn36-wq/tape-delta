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
// Candidate signal rule (rule-based, NOT a prediction): a Spring closing back inside the range => BUY candidate, a UTAD => SELL candidate.
// Extra filter: the signal bar must close in the upper half (Spring) / lower half (UTAD) of its own range, and the Spring must not sit inside a
// range that led in from a rally (distribution), nor a UTAD in one that led in from a decline (accumulation).
// Fires on the CLOSE of the event bar; the backtest enters at the NEXT bar's open, stop beyond the event extreme (+0.1 ATR), target rr x risk.
export function wySignalAt(c, k, W) { // c = closed candles, k = index of the last closed bar
  const w = W || wyckoff(c.slice(0, k + 1)); if (!w || !w.ev || w.ev.i !== k) return null; const x = c[k], r = w.range, A = w.A;
  if (w.ev.type === 'spring') { if (r.kind === 'distribution') return null; if (!(x.c > (x.h + x.l) / 2)) return null; const stop = x.l - 0.1 * A; return { dir: 'bull', i: k, stop, ref: x.c, range: r, kind: r.kind }; }
  if (r.kind === 'accumulation') return null; if (!(x.c < (x.h + x.l) / 2)) return null; const stop = x.h + 0.1 * A; return { dir: 'bear', i: k, stop, ref: x.c, range: r, kind: r.kind };
}
export function wyBacktest(c, o = {}) {
  o = { rr: 2, fee: 0.04, maxHold: 60, ...o }; const n = c.length, trades = []; let busy = -1, seen = -1;
  for (let k = 150; k < n - 1; k++) { const s = wySignalAt(c, k); if (!s || k <= busy) continue;
    const bull = s.dir === 'bull', entry = c[k + 1].o, stop = s.stop, risk = Math.abs(entry - stop); if (!(risk > 0) || (bull ? stop >= entry : stop <= entry)) continue;
    const tgt = bull ? entry + o.rr * risk : entry - o.rr * risk; let exit = null, res = null, j = k + 1;
    for (; j < Math.min(n, k + 1 + o.maxHold); j++) { const hitS = bull ? c[j].l <= stop : c[j].h >= stop, hitT = bull ? c[j].h >= tgt : c[j].l <= tgt; if (hitS) { exit = stop; res = 'stop'; break; } if (hitT) { exit = tgt; res = 'target'; break; } }
    if (exit == null) { if (k + 1 + o.maxHold > n) continue; j = k + o.maxHold; exit = c[j].c; res = 'time'; }
    const R = (bull ? exit - entry : entry - exit) / risk - (o.fee / 100 * 2 * entry) / risk; busy = j; trades.push({ dir: s.dir, t: c[k + 1].t, i: k + 1, j, entry, stop, exit, res, R, kind: s.kind });
  }
  return { trades, n, o, from: c[0].t, to: c[n - 1].t };
}
