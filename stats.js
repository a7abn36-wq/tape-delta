import { wilderATR, ema } from './ict.js';
import { detectFlow, cvdDivergence, sessionOf } from './flow.js';
import { absorption, deltaDiv } from './flow2.js';
// Signal stats: replays each signal on real Binance Spot candles with a fixed rule and reports results on held-out newer data.
// Rule: enter at the CLOSE of the signal candle (for divergences: the close of the candle that confirms the second swing). Stop and target are k x ATR(14) at entry (target = +1R, stop = -1R).
// Candles after entry are checked in order; if one candle touches both levels the trade counts as a LOSS (conservative). No result after MAXH candles = timeout, scored at the close in R.
// No fees, slippage or funding. Spot taker delta, one exchange.
export const MAXH = 48, SPLIT = 0.6, KS = [0.75, 1, 1.5], MIN_N = 30;
export const TYPES = [
  { id: 'abs2', name: ['Absorption (new)', 'Absorption (الجديد)'] },
  { id: 'dd2', name: ['Delta Divergence (new)', 'Delta Divergence (الجديد)'] },
  { id: 'abs1', name: ['ABS (existing, no zone gate)', 'ABS (القديم، من غير فلتر المناطق)'] },
  { id: 'exh', name: ['EXH exhaustion (existing)', 'EXH إرهاق (القديم)'] },
  { id: 'cvd', name: ['CVD divergence (existing)', 'CVD divergence (القديم)'] },
];
export function wilson(k, n) { if (!n) return [0, 1]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - a) / d, (c + a) / d]; }
export function signalsOf(c) {
  const n = c.length, S = { abs2: [], dd2: [], abs1: [], exh: [], cvd: [] };
  for (const s of absorption(c)) S.abs2.push({ i: s.i, dir: s.dir });
  for (const s of deltaDiv(c)) if (s.conf < n) S.dd2.push({ i: s.conf, dir: s.type });
  for (const s of detectFlow(c, null, n)) { if (s.kind === 'ABS') S.abs1.push({ i: s.i, dir: s.dir }); else if (s.kind === 'EXH') S.exh.push({ i: s.i, dir: s.dir }); }
  for (const s of cvdDivergence(c)) if (s.conf < n) S.cvd.push({ i: s.conf, dir: s.type });
  return S;
}
// outcome of one trade: {r, o:'w'|'l'|'t'} or null if not enough later candles
export function sim(c, atr, i, dir, k) {
  const e = c[i].c, risk = k * atr[i]; if (!(risk > 0) || i + 1 >= c.length) return null; const L = dir === 'bull', tp = L ? e + risk : e - risk, sl = L ? e - risk : e + risk;
  const end = Math.min(c.length - 1, i + MAXH);
  for (let j = i + 1; j <= end; j++) { const x = c[j], hitS = L ? x.l <= sl : x.h >= sl, hitT = L ? x.h >= tp : x.l <= tp; if (hitS) return { r: -1, o: 'l' }; if (hitT) return { r: 1, o: 'w' }; }
  if (i + MAXH > c.length - 1) return null; // still open: not resolved yet, excluded
  const r = (L ? c[end].c - e : e - c[end].c) / risk; return { r, o: 't' };
}
export function agg(rs) { let w = 0, l = 0, t = 0, sr = 0; for (const x of rs) { if (!x) continue; if (x.o === 'w') w++; else if (x.o === 'l') l++; else t++; sr += x.r; } const n = w + l + t; return { n, w, l, t, win: w + l ? w / (w + l) : NaN, avgR: n ? sr / n : NaN }; }
// opts: { htf: {t,close,ema} array or null, sess: 'all'|'london'|'ny'|'lny' }
export function compute(c, htf, opts = {}) {
  const n = c.length, atr = wilderATR(c), cut = Math.floor(n * SPLIT), tf = c[1].t - c[0].t; const sig = signalsOf(c);
  const trendAt = i => { if (!htf) return 0; const T = c[i].t + tf; let lo = 0, hi = htf.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (htf[m].t + htf.dt <= T) { r = m; lo = m + 1; } else hi = m - 1; } if (r < 0 || !isFinite(htf[r].ema)) return NaN; return htf[r].close > htf[r].ema ? 1 : -1; };
  const sessOk = i => { const o = opts.sess || 'all'; if (o === 'all') return true; const s = sessionOf(c[i].t); return o === 'london' ? s === 'LONDON' : o === 'ny' ? s === 'NY' : (s === 'LONDON' || s === 'NY'); };
  const ok = (i, dir) => { if (!sessOk(i)) return false; if (htf) { const t = trendAt(i); if (!(t === (dir === 'bull' ? 1 : -1))) return false; } return true; };
  const base = {}; for (const k of KS) { base[k] = { bull: { a: [], b: [] }, bear: { a: [], b: [] } }; for (let i = 30; i < n - 1; i++) for (const d of ['bull', 'bear']) { if (!ok(i, d)) continue; const r = sim(c, atr, i, d, k); if (r) (i < cut ? base[k][d].a : base[k][d].b).push(r); } }
  const out = [];
  for (const T of TYPES) {
    const L = sig[T.id].filter(s => s.i >= 30 && ok(s.i, s.dir)); const tr = L.filter(s => s.i < cut), te = L.filter(s => s.i >= cut);
    // fit on the older part: choose k with the best average R (needs >= 20 resolved trades, else k = 1)
    let kBest = 1, best = -Infinity; if (tr.length >= 20) for (const k of KS) { const a = agg(tr.map(s => sim(c, atr, s.i, s.dir, k))); if (a.n >= 20 && a.avgR > best) { best = a.avgR; kBest = k; } }
    const A = agg(tr.map(s => sim(c, atr, s.i, s.dir, kBest))), B = agg(te.map(s => sim(c, atr, s.i, s.dir, kBest)));
    // random-entry baseline in the same period, same stop rule, same filters, same long/short mix as the signals
    const nb = te.filter(s => s.dir === 'bull').length, ns = te.length - nb, bb = agg(base[kBest].bull.b), bs = agg(base[kBest].bear.b);
    const mix = te.length ? (nb * bb.win + ns * bs.win) / te.length : NaN, mixR = te.length ? (nb * bb.avgR + ns * bs.avgR) / te.length : NaN;
    const [lo, hi] = wilson(B.w, B.w + B.l); let verdict = 'few';
    if (B.w + B.l >= MIN_N) verdict = (lo > mix && B.avgR > 0) ? 'maybe' : 'none';
    out.push({ id: T.id, name: T.name, total: L.length, k: kBest, train: A, test: B, ci: [lo, hi], base: mix, baseR: mixR, verdict });
  }
  return { out, n, cut, tStart: c[0].t, tCut: c[cut].t, tEnd: c[n - 1].t };
}
export function htfSeries(h, per = 50) { const e = ema(h, per); const o = h.map((x, i) => ({ t: x.t, close: x.c, ema: e[i] })); return o; }
