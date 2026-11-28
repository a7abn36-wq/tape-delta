import { wilderATR } from './ict.js';
import { sessionOf, } from './flow.js';
import { nyHour } from './ict.js';
import { absorption } from './flow2.js';
import { sim, wilson, agg, KS, MIN_N, SPLIT } from './stats.js';
// Black Wolf Gold: ONE combined buy/sell score (0-100), computed at the close of each candle, no lookahead.
// Weights are fixed by design BEFORE any testing and are NOT tuned: sweep+reclaim 30, absorption 25, AVWAP bounce 20, session window 10, HTF trend 10, volatility sanity 5.
export const W = { sweep: 30, abs: 25, avwap: 20, sess: 10, trend: 10, vol: 5 };
export const THS = [40, 55, 70];
const HMAP = { '1m': 3600e3, '5m': 3600e3, '15m': 3600e3, '30m': 3600e3, '1h': 14400e3, '2h': 14400e3, '4h': 864e5, '1d': 6048e5 };
export function htfPer(tf) { return HMAP[tf] || 3600e3; }
// last CLOSED higher-timeframe EMA50 trend at each bar (+1 up, -1 down, 0 unknown), built by resampling the same candles
export function htfTrend(c, tfMs, hp) {
  const off = hp === 6048e5 ? 4 * 864e5 : 0, B = []; let cur = null;
  for (const x of c) { const k = Math.floor((x.t - off) / hp); if (!cur || cur.k !== k) { cur = { k, end: (k + 1) * hp + off, c: x.c }; B.push(cur); } else cur.c = x.c; }
  const a = 2 / 51, E = []; let e = null, n = 0, s = 0;
  for (const b of B) { n++; if (n <= 50) { s += b.c; if (n === 50) { e = s / 50; } } else e = b.c * a + e * (1 - a); E.push(n >= 50 ? e : NaN); }
  const out = new Array(c.length).fill(0); let p = -1;
  for (let i = 0; i < c.length; i++) { const T = c[i].t + tfMs; while (p + 1 < B.length && B[p + 1].end <= T) p++; if (p >= 0 && isFinite(E[p])) out[i] = B[p].c > E[p] ? 1 : -1; }
  return out;
}
const kz = t => { const h = nyHour(t); return (h >= 2 && h < 5) || (h >= 8 && h < 11); }; // London open and NY open windows (NY clock). PROXY: no real news calendar.
export function goldScores(c, tfMs, tf) {
  const n = c.length, atr = wilderATR(c), tr = htfTrend(c, tfMs, htfPer(tf)); const ab = absorption(c); const absB = new Array(n).fill(false), absS = new Array(n).fill(false); for (const s of ab) (s.dir === 'bull' ? absB : absS)[s.i] = true;
  // prefix sums for anchored VWAP from the lowest low / highest high of the last 50 bars
  const P = new Float64Array(n + 1), V = new Float64Array(n + 1); for (let i = 0; i < n; i++) { const x = c[i], tp = (x.h + x.l + x.c) / 3; P[i + 1] = P[i] + tp * x.v; V[i + 1] = V[i] + x.v; }
  const LB = 30, SW = 5, AN = 50, out = [];
  const sw = new Array(n).fill(0); // +1 swept lows & reclaimed (bull), -1 swept highs (bear); bar-level
  const swLv = new Array(n).fill(NaN);
  for (let j = LB; j < n; j++) { let mn = Infinity, mx = -Infinity; for (let q = j - LB; q < j; q++) { if (c[q].l < mn) mn = c[q].l; if (c[q].h > mx) mx = c[q].h; } const b = c[j]; if (b.l < mn && b.c > mn) { sw[j] = 1; swLv[j] = mn; } else if (b.h > mx && b.c < mx) { sw[j] = -1; swLv[j] = mx; } }
  for (let i = Math.max(LB + SW, 60); i < n; i++) {
    for (const dir of [1, -1]) {
      const p = { sweep: 0, abs: 0, avwap: 0, sess: 0, trend: 0, vol: 0 };
      for (let j = i - SW + 1; j <= i; j++) if (sw[j] === dir && (dir === 1 ? c[i].c > swLv[j] : c[i].c < swLv[j])) { p.sweep = W.sweep; break; }
      for (let j = i - SW + 1; j <= i; j++) if (dir === 1 ? absB[j] : absS[j]) { p.abs = W.abs; break; }
      let a = i - AN + 1; for (let q = a; q <= i; q++) if (dir === 1 ? c[q].l < c[a].l : c[q].h > c[a].h) a = q;
      if (i - a >= 4 && V[i + 1] - V[a] > 0) { const av = (P[i + 1] - P[a]) / (V[i + 1] - V[a]); let t = false; for (let j = i - 2; j <= i; j++) if (dir === 1 ? c[j].l <= av : c[j].h >= av) t = true; if (t && (dir === 1 ? c[i].c > av : c[i].c < av)) p.avwap = W.avwap; }
      if (kz(c[i].t)) p.sess = W.sess;
      if (tr[i] === dir) p.trend = W.trend;
      let lo = 0, cnt = 0; for (let q = i - 100; q < i; q++) { if (q < 14) continue; cnt++; if (atr[q] < atr[i]) lo++; } const pr = cnt ? lo / cnt : 0.5; if (pr >= 0.2 && pr <= 0.9) p.vol = W.vol;
      const sc = p.sweep + p.abs + p.avwap + p.sess + p.trend + p.vol; if (sc >= THS[0]) out.push({ i, dir: dir === 1 ? 'bull' : 'bear', score: sc, p });
    }
  }
  return { sig: out, atr };
}
// pick the higher-scoring direction per bar, and thin repeats (no new signal within 6 bars in the same direction)
export function goldSignals(c, tfMs, tf, T) {
  const { sig, atr } = goldScores(c, tfMs, tf), by = {}; for (const s of sig) if (s.score >= T) { const o = by[s.i]; if (!o || s.score > o.score) by[s.i] = s; }
  const out = [], last = { bull: -99, bear: -99 }; for (const k of Object.keys(by).map(Number).sort((a, b) => a - b)) { const s = by[k]; if (k - last[s.dir] >= 6) { out.push(s); last[s.dir] = k; } } return { sig: out, atr };
}
export function goldStats(c, tf, tfMs) {
  const n = c.length, cut = Math.floor(n * SPLIT), { sig: all, atr } = goldScores(c, tfMs, tf);
  // thin per threshold
  const thin = T => { const by = {}; for (const s of all) if (s.score >= T) { const o = by[s.i]; if (!o || s.score > o.score) by[s.i] = s; } const out = [], last = { bull: -99, bear: -99 }; for (const k of Object.keys(by).map(Number).sort((a, b) => a - b)) { const s = by[k]; if (k - last[s.dir] >= 6) { out.push(s); last[s.dir] = k; } } return out; };
  let best = null, bestR = -Infinity; const grid = [];
  for (const T of THS) { const L = thin(T), tr = L.filter(s => s.i < cut); for (const k of KS) { const a = agg(tr.map(s => sim(c, atr, s.i, s.dir, k))); grid.push({ T, k, n: a.n, avgR: a.avgR }); if (a.n >= 20 && a.avgR > bestR) { bestR = a.avgR; best = { T, k }; } } }
  const T = best ? best.T : 55, k = best ? best.k : 1, L = thin(T), tr = L.filter(s => s.i < cut), te = L.filter(s => s.i >= cut);
  const A = agg(tr.map(s => sim(c, atr, s.i, s.dir, k))), B = agg(te.map(s => sim(c, atr, s.i, s.dir, k)));
  const nb = te.filter(s => s.dir === 'bull').length, ns = te.length - nb, bb = { a: [], b: [] }, bs = { a: [], b: [] };
  for (let i = 60; i < n - 1; i++) if (i >= cut) { const x = sim(c, atr, i, 'bull', k), y = sim(c, atr, i, 'bear', k); if (x) bb.b.push(x); if (y) bs.b.push(y); }
  const Bb = agg(bb.b), Bs = agg(bs.b), mix = te.length ? (nb * Bb.win + ns * Bs.win) / te.length : NaN, mixR = te.length ? (nb * Bb.avgR + ns * Bs.avgR) / te.length : NaN;
  const [lo, hi] = wilson(B.w, B.w + B.l); let verdict = 'few'; if (B.w + B.l >= MIN_N) verdict = (lo > mix && B.avgR > 0) ? 'maybe' : 'none';
  const hiSc = te.filter(s => s.score >= 85); 
  return { n, cut, tStart: c[0].t, tCut: c[cut].t, tEnd: c[n - 1].t, T, k, picked: !!best, total: L.length, train: A, test: B, ci: [lo, hi], base: mix, baseR: mixR, verdict, grid, tp: hiSc.length };
}
