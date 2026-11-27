// Volume profile. APPROXIMATE: built from exchange 1m (week: 5m) candles with each candle's volume spread evenly over its high-low range.
// It is not tick-exact. Real tick profiles would need every trade of the period.
import { fetchKlinesFrom } from './data.js';
import { sessionOf } from './flow.js';
export async function loadProfileCandles(src, sym, mode) {
  const now = Date.now(); const D = 864e5; let start, tf = '1m', step = 60e3;
  if (mode === 'week') { const d0 = Math.floor(now / D) * D; const dow = (new Date(d0).getUTCDay() + 6) % 7; start = d0 - dow * D; tf = '5m'; step = 300e3; }
  else if (mode === 'day') start = Math.floor(now / D) * D;
  else start = now - 1000 * 60e3; // session: last ~16h of 1m, trimmed below
  let out = [], t = start; for (let p = 0; p < 12 && t < now; p++) { const k = await fetchKlinesFrom(src, sym, tf, t, 1000); if (!k.length) break; out = out.concat(k); t = k[k.length - 1].t + step; if (k.length < 1000) break; }
  if (mode === 'session' && out.length) { const cur = sessionOf(out[out.length - 1].t); let i = out.length - 1; while (i > 0 && sessionOf(out[i - 1].t) === cur && out[i].t - out[i - 1].t < 3600e3) i--; out = out.slice(i); }
  return out;
}
export function computeProfile(c, rows = 60) {
  if (c.length < 5) return null; let lo = Infinity, hi = -Infinity; for (const x of c) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; } if (!(hi > lo)) return null;
  const step = (hi - lo) / rows, v = new Array(rows).fill(0), bv = new Array(rows).fill(0);
  for (const x of c) { const a = Math.min(rows - 1, Math.floor((x.l - lo) / step)), b = Math.min(rows - 1, Math.floor((x.h - lo) / step)), n = b - a + 1; for (let i = a; i <= b; i++) { v[i] += x.v / n; bv[i] += (x.bv || 0) / n; } }
  let poc = 0, tot = 0; for (let i = 0; i < rows; i++) { tot += v[i]; if (v[i] > v[poc]) poc = i; }
  let a = poc, b = poc, acc = v[poc]; while (acc < 0.7 * tot && (a > 0 || b < rows - 1)) { const up = b < rows - 1 ? v[b + 1] : -1, dn = a > 0 ? v[a - 1] : -1; if (up >= dn) { b++; acc += v[b]; } else { a--; acc += v[a]; } }
  return { lo, hi, step, v, rows, poc: lo + (poc + .5) * step, vah: lo + (b + 1) * step, val: lo + a * step, a, b, pocI: poc, max: v[poc], total: tot, n: c.length, from: c[0].t };
}
