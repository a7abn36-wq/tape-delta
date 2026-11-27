// Backtest of one rule set: liquidity sweep -> CHoCH -> retrace into the order block. Point-in-time (no look-ahead): swings are used only after confirmation.
// Fills assume limit entry at the OB edge, stop first if stop and target are hit in the same candle, fees applied. Past results do not predict the future.
import { wilderATR, nyHour } from './ict.js';
import { sessionOf } from './flow.js';
import { adxSeries } from './regime.js';
export const DEFAULTS = { rr: 2, fee: 0.04, sweepToChoch: 15, wait: 20, maxHold: 60, kzOnly: false, regime: null, mtf: false, dflip: false };
export function backtest(c, o = {}) {
  o = { ...DEFAULTS, ...o }; const n = c.length, L = 3, atr = wilderATR(c), trades = []; if (n < 100) return { trades, n, o };
  const sw = []; for (let i = L; i < n - L; i++) { let H = true, Lo = true; for (let j = 1; j <= L; j++) { if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) H = false; if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) Lo = false; } if (H) sw.push({ i, type: 'H', p: c[i].h, conf: i + L }); if (Lo) sw.push({ i, type: 'L', p: c[i].l, conf: i + L }); }
  sw.sort((a, b) => a.conf - b.conf || a.i - b.i);
  let si = 0, lastH = null, lastL = null, trend = null; const openSw = { H: [], L: [] }; let sweep = { bull: null, bear: null }; let pend = []; let busyUntil = -1;
  // higher-timeframe bias, point-in-time: factor 4 buckets, only COMPLETED buckets are used (close vs EMA20 of bucket closes)
  const tfm = n > 1 ? c[1].t - c[0].t : 0, F = 4, bk = new Map(), ids = []; for (let i = 0; i < n; i++) { const id = Math.floor(c[i].t / (tfm * F)); if (!bk.has(id)) { bk.set(id, { id, close: c[i].c }); ids.push(id); } else bk.get(id).close = c[i].c; }
  { let e = null; const kk = 2 / 21; ids.forEach((id, q) => { const x = bk.get(id); e = e == null ? x.close : x.close * kk + e * (1 - kk); x.bias = q < 5 ? null : x.close > e ? 'bull' : 'bear'; }); }
  const htf = k => { const id = Math.floor(c[k].t / (tfm * F)); let lo = 0, hi = ids.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (ids[m] < id) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? bk.get(ids[r]).bias : null; };
  const dd0 = (k, dir) => k >= 2 && c[k - 1].d != null && c[k - 2].d != null && (dir === 'bull' ? c[k - 1].d > 0 && c[k - 2].d < 0 : c[k - 1].d < 0 && c[k - 2].d > 0);
  const adxS = o.regime ? adxSeries(c) : null; const erAt = k => { if (k < 21) return 0; let p = 0; for (let q = k - 19; q <= k; q++) p += Math.abs(c[q].c - c[q - 1].c); return p ? Math.abs(c[k].c - c[k - 20].c) / p : 0; };
  const regOk = k => { if (!o.regime) return true; const a = adxS[k - 1], e = erAt(k - 1); if (!isFinite(a)) return false; return o.regime === 'trend' ? a >= 25 && e >= 0.3 : a < 20 && e < 0.25; };
  const kz = t => { const h = nyHour(t); return (h >= 2 && h < 5) || (h >= 7 && h < 10); };
  for (let k = 0; k < n; k++) {
    while (si < sw.length && sw[si].conf <= k) { const s = sw[si++]; if (s.type === 'H') { lastH = { ...s, broken: false }; openSw.H.push(s); } else { lastL = { ...s, broken: false }; openSw.L.push(s); } }
    // sweeps of confirmed, untouched swings (wick through, close back)
    for (const ty of ['H', 'L']) { const arr = openSw[ty]; for (let q = arr.length - 1; q >= 0; q--) { const s = arr[q]; if (k <= s.conf) continue; if (ty === 'L' && c[k].l < s.p) { if (c[k].c > s.p) sweep.bull = { k, p: c[k].l }; arr.splice(q, 1); } else if (ty === 'H' && c[k].h > s.p) { if (c[k].c < s.p) sweep.bear = { k, p: c[k].h }; arr.splice(q, 1); } } if (arr.length > 12) arr.splice(0, arr.length - 12); }
    // structure
    let ev = null;
    if (lastH && !lastH.broken && c[k].c > lastH.p) { lastH.broken = true; ev = { dir: 'bull', choch: trend === 'bear', from: lastH.i }; trend = 'bull'; }
    if (lastL && !lastL.broken && c[k].c < lastL.p) { lastL.broken = true; ev = { dir: 'bear', choch: trend === 'bull', from: lastL.i }; trend = 'bear'; }
    if (ev && ev.choch) { const sp = sweep[ev.dir]; if (sp && k - sp.k <= o.sweepToChoch && k > sp.k) {
      let m = Math.max(0, Math.min(ev.from, sp.k)); if (ev.dir === 'bull') { for (let j = m; j <= k; j++) if (c[j].l < c[m].l) m = j; let ob = m; for (let j = m; j >= Math.max(0, m - 6); j--) if (c[j].c < c[j].o) { ob = j; break; } pend.push({ dir: 'bull', k, lo: c[ob].l, hi: c[ob].h, sp: sp.p }); }
      else { for (let j = m; j <= k; j++) if (c[j].h > c[m].h) m = j; let ob = m; for (let j = m; j >= Math.max(0, m - 6); j--) if (c[j].c > c[j].o) { ob = j; break; } pend.push({ dir: 'bear', k, lo: c[ob].l, hi: c[ob].h, sp: sp.p }); }
      sweep[ev.dir] = null; } }
    // fills
    for (let q = pend.length - 1; q >= 0; q--) { const P = pend[q]; if (k <= P.k) continue; if (k - P.k > o.wait) { pend.splice(q, 1); continue; }
      const bull = P.dir === 'bull'; if ((bull && c[k].c < P.lo) || (!bull && c[k].c > P.hi)) { pend.splice(q, 1); continue; }
      const touched = bull ? c[k].l <= P.hi : c[k].h >= P.lo; if (!touched) continue; pend.splice(q, 1); if (k <= busyUntil) continue;
      if (o.kzOnly && !kz(c[k].t)) continue; if (!regOk(k)) continue; if (o.mtf && htf(k) !== P.dir) continue; if (o.dflip && !dd0(k, P.dir)) continue;
      const entry = bull ? Math.min(P.hi, c[k].o) : Math.max(P.lo, c[k].o); const stop = bull ? Math.min(P.lo, P.sp) - 0.1 * atr[k] : Math.max(P.hi, P.sp) + 0.1 * atr[k]; const risk = Math.abs(entry - stop); if (!(risk > 0) || risk > 4 * atr[k]) continue;
      const tgt = bull ? entry + o.rr * risk : entry - o.rr * risk; let exit = null, res = null, j = k;
      // fill candle: if it also reaches stop, assume stop (conservative)
      for (; j < Math.min(n, k + o.maxHold); j++) { const hitS = bull ? c[j].l <= stop : c[j].h >= stop, hitT = bull ? c[j].h >= tgt : c[j].l <= tgt; if (hitS) { exit = stop; res = 'stop'; break; } if (hitT && j > k) { exit = tgt; res = 'target'; break; } if (hitT && j === k) { /* same candle as fill: target only counts if the candle closed beyond entry */ if (bull ? c[j].c > entry : c[j].c < entry) { exit = tgt; res = 'target'; break; } } }
      if (exit == null) { j = Math.min(n - 1, k + o.maxHold - 1); if (k + o.maxHold > n) { continue; } exit = c[j].c; res = 'time'; }
      const gross = (bull ? exit - entry : entry - exit) / risk, cost = (o.fee / 100 * 2 * entry) / risk, R = gross - cost; busyUntil = j;
      trades.push({ dir: P.dir, t: c[k].t, i: k, j, entry, stop, exit, res, R, session: sessionOf(c[k].t), kz: kz(c[k].t) }); }
    pend = pend.filter(p => k - p.k <= o.wait);
  }
  return { trades, n, o, from: c[0].t, to: c[n - 1].t };
}
export function stats(trades) {
  const n = trades.length; if (!n) return { n: 0 }; const w = trades.filter(t => t.R > 0), l = trades.filter(t => t.R <= 0); const sum = a => a.reduce((s, t) => s + t.R, 0);
  let eq = 0, peak = 0, dd = 0; const curve = [0]; for (const t of trades) { eq += t.R; curve.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const by = f => { const m = {}; for (const t of trades) { const k = f(t); (m[k] ||= []).push(t); } return Object.entries(m).map(([k, a]) => ({ k, n: a.length, win: a.filter(t => t.R > 0).length / a.length, avg: sum(a) / a.length })); };
  return { n, win: w.length / n, avgR: sum(trades) / n, total: sum(trades), pf: sum(l) ? sum(w) / -sum(l) : Infinity, dd, curve, bySession: by(t => t.session), byDir: by(t => t.dir) };
}
