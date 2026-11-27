// Session CVD and anchored VWAP. Both are derived from real exchange candle data (taker-buy volume, price, volume).
import { nyHour } from './ict.js';
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
