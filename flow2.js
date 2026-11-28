import { wilderATR } from './ict.js';
// Two order-flow indicators built on REAL taker delta per candle (d = taker buy volume - taker sell volume). Rule-based, DERIVED, not backtested.
// Neither is ever drawn on the still-forming candle, and neither changes once drawn:
//  - Absorption is decided when the candle closes.
//  - Delta divergence is decided only when the second swing is confirmed (R closed candles after it), so there is a lag of R candles.
export const ABS_DEF = { volMult: 1.3, minDelta: 0.3, maxMove: 0.15, lookback: 20 };
export const DDIV_DEF = { L: 3, minGap: 5, maxGap: 60, win: 2, margin: 0.15 };
const closedEnd = c => { const n = c.length; if (n < 3) return n; const tf = c[n - 1].t - c[n - 2].t; return c[n - 1].t + tf > Date.now() ? n - 1 : n; };
// sell-delta absorbed (bull): heavy volume, delta at least minDelta of volume on the sell side, yet the candle did not close lower than open by more than maxMove*ATR.
// buy-delta absorbed (bear): mirror.
export function absorption(c, o = {}) {
  const P = { ...ABS_DEF, ...o }, n = closedEnd(c), out = []; if (n < P.lookback + 15) return out; const atr = wilderATR(c);
  let sv = 0; for (let k = 0; k < P.lookback; k++) sv += c[k].v;
  for (let i = P.lookback; i < n; i++) {
    const x = c[i], av = sv / P.lookback, a = atr[i]; sv += x.v - c[i - P.lookback].v; if (!(av > 0) || !(a > 0) || !(x.v > 0)) continue;
    const dr = x.d / x.v; if (x.v < P.volMult * av || Math.abs(dr) < P.minDelta) continue;
    const move = (x.c - x.o) / a; // net candle move in ATR
    if (dr < 0 && move > -P.maxMove) out.push({ i, dir: 'bull', dr, vr: x.v / av, move });
    else if (dr > 0 && move < P.maxMove) out.push({ i, dir: 'bear', dr, vr: x.v / av, move });
  }
  return out;
}
// Delta divergence: two confirmed swing highs (or lows). Bearish: price makes a higher high but the delta summed over the swing candle +-win is lower than at the previous swing high by margin (fraction of the larger |delta|). Bullish mirror.
export function deltaDiv(c, o = {}) {
  const P = { ...DDIV_DEF, ...o }, n = closedEnd(c), out = []; if (n < 40) return out; const L = P.L, atr = wilderATR(c);
  const wd = i => { let s = 0; for (let k = Math.max(0, i - P.win); k <= Math.min(n - 1, i + P.win); k++) s += c[k].d; return s; };
  let pH = null, pL = null;
  for (let i = L; i < n - L; i++) {
    let H = true, Lo = true; for (let j = 1; j <= L; j++) { if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) H = false; if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) Lo = false; }
    if (H) { const d = wd(i); if (pH && i - pH.i >= P.minGap && i - pH.i <= P.maxGap && c[i].h > pH.p + 0.1 * atr[i] && d < pH.d - P.margin * Math.max(Math.abs(d), Math.abs(pH.d), 1e-9)) out.push({ type: 'bear', i1: pH.i, i: i, conf: i + L, p1: pH.p, p2: c[i].h, d1: pH.d, d2: d }); pH = { i, p: c[i].h, d }; }
    if (Lo) { const d = wd(i); if (pL && i - pL.i >= P.minGap && i - pL.i <= P.maxGap && c[i].l < pL.p - 0.1 * atr[i] && d > pL.d + P.margin * Math.max(Math.abs(d), Math.abs(pL.d), 1e-9)) out.push({ type: 'bull', i1: pL.i, i: i, conf: i + L, p1: pL.p, p2: c[i].l, d1: pL.d, d2: d }); pL = { i, p: c[i].l, d }; }
  }
  return out;
}
