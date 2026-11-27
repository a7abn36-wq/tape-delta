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
  const tfG = c[n - 1].t - c[n - 2].t, nEnd = c[n - 1].t + tfG > Date.now() ? n - 1 : n; // the still-forming candle has provisional volume/delta: no signal is decided on it
  for (let i = from; i < nEnd; i++) {
    const x = c[i], rng = x.h - x.l, av = avgV(i), a = atr[i]; if (!(a > 0) || !(av > 0)) continue; const dr = x.v ? x.d / x.v : 0, mid = (x.h + x.l) / 2;
    if (x.v >= 1.5 * av && rng <= 0.8 * a && Math.abs(dr) >= 0.25) { if (dr < 0 && x.c >= mid) out.push({ i, kind: 'ABS', dir: 'bull', note: 'selling absorbed' }); else if (dr > 0 && x.c <= mid) out.push({ i, kind: 'ABS', dir: 'bear', note: 'buying absorbed' }); }
    let hh = -Infinity, ll = Infinity; for (let k = i - 10; k < i; k++) { if (c[k].h > hh) hh = c[k].h; if (c[k].l < ll) ll = c[k].l; }
    if (x.h > hh) { let j = -1; for (let k = i - 10; k < i; k++) if (c[k].h === hh) j = k; if (j >= 0 && x.v < 0.8 * c[j].v && x.d < c[j].d && x.d < 0.1 * x.v) out.push({ i, kind: 'EXH', dir: 'bear', note: 'buying fading at new high' }); }
    if (x.l < ll) { let j = -1; for (let k = i - 10; k < i; k++) if (c[k].l === ll) j = k; if (j >= 0 && x.v < 0.8 * c[j].v && x.d > c[j].d && x.d > -0.1 * x.v) out.push({ i, kind: 'EXH', dir: 'bull', note: 'selling fading at new low' }); }
  }
  if (ict) for (const s of ict.sweeps) { if (s.i < from || s.i >= nEnd) continue; const av = avgV(s.i); if (c[s.i].v >= 1.3 * av) out.push({ i: s.i, kind: 'RUN', dir: s.type === 'L' ? 'bull' : 'bear', note: (s.type === 'L' ? 'sell-side' : 'buy-side') + ' stops run, volume spike' }); }
  return out;
}
// Stacked imbalances inside one footprint candle: 3+ adjacent price rows where one side traded 3x the other.
export function stackedImb(rows) {
  const res = []; let run = null;
  for (let q = 0; q < rows.length; q++) { const [k, r] = rows[q]; const side = r[1] >= 3 * r[0] && r[1] > 0 ? 'buy' : r[0] >= 3 * r[1] && r[0] > 0 ? 'sell' : null; const adj = run && rows[q - 1] && rows[q - 1][0] === k - 1;
    if (side && run && run.side === side && adj) { run.to = k; run.n++; } else { if (run && run.n >= 3) res.push(run); run = side ? { side, from: k, to: k, n: 1 } : null; } }
  if (run && run.n >= 3) res.push(run); return res;
}

// Price vs cumulative-delta divergence between two CONFIRMED swing points (3 bars each side). DERIVED from real taker-buy delta, rule-based, not backtested.
// Bearish: price makes a higher high but cumulative delta (CVD) made a lower value at that high than at the previous swing high.
// Bullish: price makes a lower low but CVD is higher than at the previous swing low. Only candles up to the confirming bar are used (no look-ahead).
export function cvdDivergence(c, o = {}) {
  const n = c.length, L = 3, minGap = o.minGap || 5, maxGap = o.maxGap || 80; if (n < 40) return [];
  const cum = new Array(n), ab = new Array(n); let s = 0, a = 0; for (let i = 0; i < n; i++) { s += c[i].d; cum[i] = s; a += Math.abs(c[i].d); ab[i] = a / (i + 1); } /* ab[k] = running mean |delta| up to bar k, so thresholds use only past data */ const atr = wilderATR(c);
  const out = []; let pH = null, pL = null;
  for (let i = L; i < n - L; i++) {
    let H = true, Lo = true; for (let j = 1; j <= L; j++) { if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) H = false; if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) Lo = false; }
    if (H) { if (pH && i - pH.i >= minGap && i - pH.i <= maxGap && c[i].h > pH.p + 0.1 * atr[i] && cum[i] < pH.cvd - ab[i + L]) out.push({ type: 'bear', i1: pH.i, i2: i, conf: i + L, p1: pH.p, p2: c[i].h, c1: pH.cvd, c2: cum[i] }); pH = { i, p: c[i].h, cvd: cum[i] }; }
    if (Lo) { if (pL && i - pL.i >= minGap && i - pL.i <= maxGap && c[i].l < pL.p - 0.1 * atr[i] && cum[i] > pL.cvd + ab[i + L]) out.push({ type: 'bull', i1: pL.i, i2: i, conf: i + L, p1: pL.p, p2: c[i].l, c1: pL.cvd, c2: cum[i] }); pL = { i, p: c[i].l, cvd: cum[i] }; }
  }
  return out;
}

// Gate absorption (ABS) to liquidity zones: keep an ABS signal only if the candle's range overlaps a matching zone.
// Selling absorbed (bull ABS) must sit in a support-type zone: bullish order block, bullish FVG, sell-side liquidity (SSL / equal lows), PDL / PWL / PML.
// Buying absorbed (bear ABS) must sit in a resistance-type zone: bearish OB, bearish FVG, BSL / equal highs, PDH / PWH / PMH. Other signal kinds pass unchanged.
// Zones come from the ICT layer (DERIVED); level lines (PDH etc.) are REAL prior-period extremes.
export function gateAbs(sigs, c, ict, levels) {
  if (!ict) return sigs; const atr = wilderATR(c), out = [];
  for (const s of sigs) {
    if (s.kind !== 'ABS') { out.push(s); continue; } const x = c[s.i], a = atr[s.i], bull = s.dir === 'bull'; let z = null;
    const hit = (lo, hi, tol) => x.l <= hi + tol && x.h >= lo - tol;
    for (const o of ict.ob) if (o.dir === s.dir && o.i < s.i && hit(o.lo, o.hi, 0.1 * a)) z = z || (bull ? 'bull OB' : 'bear OB');
    for (const g of ict.fvg) if (g.dir === s.dir && g.i < s.i && hit(g.lo, g.hi, 0.1 * a)) z = z || 'FVG';
    for (const q of ict.liq) if ((q.kind === 'SSL') === bull && hit(q.p, q.p, 0.3 * a)) z = z || q.kind;
    for (const q of ict.eq) if ((q.kind === 'EQL') === bull && hit(q.p, q.p, 0.3 * a)) z = z || q.kind;
    const lv = levels || {}; for (const [k, p] of bull ? [['PDL', lv.pdl], ['PWL', lv.pwl], ['PML', lv.pml]] : [['PDH', lv.pdh], ['PWH', lv.pwh], ['PMH', lv.pmh]]) if (p != null && hit(p, p, 0.3 * a)) z = z || k;
    if (z) out.push({ ...s, zone: z, note: s.note + ' inside ' + z });
  }
  return out;
}
