// Session CVD and anchored VWAP. Both are derived from real exchange candle data (taker-buy volume, price, volume).
import { nyHour, wilderATR } from './ict.js';
// Sessions in New York time, matching the ICT killzone convention used elsewhere in the app.
export function sessionOf(t) { const h = nyHour(t); if (h >= 20 || h < 2) return 'ASIA'; if (h < 8) return 'LONDON'; if (h < 17) return 'NY'; return 'POST'; }
// CVD that restarts at every session boundary. Only meaningful on 1h or lower.
export function sessionCVD(c, tfMs) {
  if (tfMs > 3600e3) return null;
  const v = new Array(c.length), starts = []; let s = 0, cur = null, prevT = null;
  for (let i = 0; i < c.length; i++) {
    const name = sessionOf(c[i].t);
    if (name !== cur || (prevT != null && c[i].t - prevT > 12 * 3600e3)) { cur = name; s = 0; starts.push({ i, name }); }
    s += c[i].d; v[i] = s; prevT = c[i].t;
  }
  return { v, starts };
}
// Volume-weighted average price from candle i0 forward, with a volume-weighted 1 sigma band.
export function avwap(c, i0) {
  const n = c.length, v = new Array(n).fill(NaN), up = new Array(n).fill(NaN), dn = new Array(n).fill(NaN);
  let pv = 0, vv = 0, p2 = 0;
  for (let i = Math.max(0, i0); i < n; i++) {
    const tp = (c[i].h + c[i].l + c[i].c) / 3, w = c[i].v;
    pv += tp * w; vv += w; p2 += tp * tp * w;
    if (vv > 0) { const m = pv / vv, sd = Math.sqrt(Math.max(0, p2 / vv - m * m)); v[i] = m; up[i] = m + sd; dn[i] = m - sd; }
  }
  return { v, up, dn };
}
// Candle index nearest a timestamp (binary search); -1 if outside loaded range.
export function idxAtOrAfter(c, t) { let lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].t >= t) { r = m; hi = m - 1; } else lo = m + 1; } return r; }

// Order-flow signals from real candle data (volume, taker-buy volume). Rule-based, not backtested.
// ABS: heavy volume, small range, one-sided delta, but price did not follow (absorption by passive orders).
// EXH: new local extreme where volume and delta fade versus the previous extreme (exhaustion).
// RUN: liquidity sweep candle with a volume spike (a stop run: stops taken, price closed back).
export function detectFlow(c, ict, last = 60) {
  const n = c.length, out = []; if (n < 30) return out; const atr = wilderATR(c); const from = Math.max(21, n - last);
  const avgV = i => { let s = 0; for (let k = i - 20; k < i; k++) s += c[k].v; return s / 20; };
  for (let i = from; i < n; i++) {
    const x = c[i], rng = x.h - x.l, av = avgV(i), a = atr[i]; if (!(a > 0) || !(av > 0)) continue; const dr = x.v ? x.d / x.v : 0, mid = (x.h + x.l) / 2;
    if (x.v >= 1.5 * av && rng <= 0.8 * a && Math.abs(dr) >= 0.25) { if (dr < 0 && x.c >= mid) out.push({ i, kind: 'ABS', dir: 'bull', note: 'selling absorbed' }); else if (dr > 0 && x.c <= mid) out.push({ i, kind: 'ABS', dir: 'bear', note: 'buying absorbed' }); }
    let hh = -Infinity, ll = Infinity; for (let k = i - 10; k < i; k++) { if (c[k].h > hh) hh = c[k].h; if (c[k].l < ll) ll = c[k].l; }
    if (x.h > hh) { let j = -1; for (let k = i - 10; k < i; k++) if (c[k].h === hh) j = k; if (j >= 0 && x.v < 0.8 * c[j].v && x.d < c[j].d && x.d < 0.1 * x.v) out.push({ i, kind: 'EXH', dir: 'bear', note: 'buying fading at new high' }); }
    if (x.l < ll) { let j = -1; for (let k = i - 10; k < i; k++) if (c[k].l === ll) j = k; if (j >= 0 && x.v < 0.8 * c[j].v && x.d > c[j].d && x.d > -0.1 * x.v) out.push({ i, kind: 'EXH', dir: 'bull', note: 'selling fading at new low' }); }
  }
  if (ict) for (const s of ict.sweeps) { if (s.i < from || s.i >= n) continue; const av = avgV(s.i); if (c[s.i].v >= 1.3 * av) out.push({ i: s.i, kind: 'RUN', dir: s.type === 'L' ? 'bull' : 'bear', note: (s.type === 'L' ? 'sell-side' : 'buy-side') + ' stops run, volume spike' }); }
  return out;
}
// Stacked imbalances inside one footprint candle: 3+ adjacent price rows where one side traded 3x the other.
export function stackedImb(rows) {
  const res = []; let run = null;
  for (let q = 0; q < rows.length; q++) { const [k, r] = rows[q]; const side = r[1] >= 3 * r[0] && r[1] > 0 ? 'buy' : r[0] >= 3 * r[1] && r[0] > 0 ? 'sell' : null; const adj = run && rows[q - 1] && rows[q - 1][0] === k - 1;
    if (side && run && run.side === side && adj) { run.to = k; run.n++; } else { if (run && run.n >= 3) res.push(run); run = side ? { side, from: k, to: k, n: 1 } : null; } }
  if (run && run.n >= 3) res.push(run); return res;
}
