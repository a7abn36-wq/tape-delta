// Market regime: trend vs range, plus volatility state. DERIVED from candles with standard formulas, no look-ahead (value at bar i uses bars <= i).
// ADX(14) Wilder, Kaufman efficiency ratio (20), ATR percentile over the last 100 bars. Thresholds are common rules of thumb, not fitted.
import { wilderATR } from './ict.js';
export function adxSeries(c, n = 14) {
  const L = c.length, o = new Array(L).fill(NaN); if (L < 2 * n + 2) return o;
  let tr = 0, pd = 0, md = 0; const dx = [];
  let sTR = 0, sP = 0, sM = 0;
  for (let i = 1; i < L; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l, p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0;
    const t = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (i <= n) { sTR += t; sP += p; sM += m; } else { sTR = sTR - sTR / n + t; sP = sP - sP / n + p; sM = sM - sM / n + m; }
    if (i >= n) { const pi = 100 * sP / sTR, mi = 100 * sM / sTR; dx.push([i, pi + mi ? 100 * Math.abs(pi - mi) / (pi + mi) : 0]); }
  }
  let a = 0; for (let k = 0; k < n; k++) a += dx[k][1]; a /= n; o[dx[n - 1][0]] = a;
  for (let k = n; k < dx.length; k++) { a = (a * (n - 1) + dx[k][1]) / n; o[dx[k][0]] = a; }
  return o;
}
export function regime(c) {
  const n = c.length; if (n < 120) return null; const i = n - 1;
  const adx = adxSeries(c)[i]; const w = 20; const net = Math.abs(c[i].c - c[i - w].c); let path = 0; for (let k = i - w + 1; k <= i; k++) path += Math.abs(c[k].c - c[k - 1].c); const er = path ? net / path : 0;
  const atr = wilderATR(c); const hist = atr.slice(i - 99, i + 1).filter(isFinite).sort((a, b) => a - b); const pct = hist.length ? hist.filter(v => v <= atr[i]).length / hist.length : null;
  const dir = c[i].c > c[i - w].c ? 'up' : 'down';
  let kind = 'transition'; if (adx >= 25 && er >= 0.3) kind = 'trend'; else if (adx < 20 && er < 0.25) kind = 'range';
  const vol = pct == null ? null : pct >= 0.8 ? 'high' : pct <= 0.2 ? 'low' : 'normal';
  return { kind, dir, adx, er, pct, vol };
}
