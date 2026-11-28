import { wilderATR } from './ict.js';
// FROZEN RULE (do not edit after FREEZE_T): "S4 trend-momentum" on PAXGUSDT Binance Spot 4h.
// Signal at a CLOSED 4h candle i: Efficiency Ratio(20) > 0.50 and sign of (close[i] - close[i-12]) -> long if > 0, short if < 0.
// ER(20) = |close[i]-close[i-20]| / sum(|close[k]-close[k-1]|, k=i-19..i). Same direction signals at least 6 candles apart (chain starts fresh at FREEZE_T).
// Entry = close of the signal candle. Stop = 1 x ATR14 (Wilder) at entry. Targets +1R and +2R, tracked separately. Stop first if a candle touches both. No result after 48 candles = timeout, scored at the close in R. Gross: no fees or slippage.
export const FREEZE_T = 1795857404000; // 2026-11-28T09:16:44Z, rule frozen at this moment
export const SYM = 'PAXGUSDT', TF = '4h', PER = 14400e3, MAXH = 48;
function er(c, i, n = 20) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += Math.abs(c[j].c - c[j - 1].c); return s ? Math.abs(c[i].c - c[i - n].c) / s : 0; }
function resolve(c, i, dir, atr, mult) {
  const e = c[i].c, risk = atr, L = dir > 0, tp = e + dir * mult * risk, sl = e - dir * risk, end = Math.min(c.length - 1, i + MAXH);
  for (let j = i + 1; j <= end; j++) { const x = c[j], hs = L ? x.l <= sl : x.h >= sl, ht = L ? x.h >= tp : x.l <= tp; if (hs) return { o: 'l', r: -1, t: x.t + PER }; if (ht) return { o: 'w', r: mult, t: x.t + PER }; }
  if (i + MAXH <= c.length - 1) return { o: 't', r: dir * (c[end].c - e) / risk, t: c[end].t + PER };
  return { o: 'open' };
}
// c = CLOSED candles only. Returns signals with candle close time >= freezeT.
export function forwardLog(c, freezeT) {
  const atr = wilderATR(c), out = [], last = { 1: -1e18, '-1': -1e18 };
  for (let i = 21; i < c.length; i++) {
    const closeT = c[i].t + PER; if (closeT < freezeT) continue;
    const e = er(c, i); if (!(e > 0.5)) continue; const rr = c[i].c - c[i - 12].c; const dir = rr > 0 ? 1 : rr < 0 ? -1 : 0; if (!dir) continue;
    if (closeT - last[dir] < 6 * PER) continue; last[dir] = closeT;
    const r = atr[i], ent = c[i].c; out.push({ t: closeT, dir: dir > 0 ? 'long' : 'short', entry: ent, stop: ent - dir * r, t1p: ent + dir * r, t2p: ent + dir * 2 * r, er: +e.toFixed(3), atr: +r.toFixed(4), r1: resolve(c, i, dir, r, 1), r2: resolve(c, i, dir, r, 2) });
  }
  return out;
}
export function wilson(k, n) { if (!n) return [0, 1]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), a = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - a) / d, (c + a) / d]; }
export function board(log, key) { let w = 0, l = 0, t = 0, o = 0, sr = 0; for (const s of log) { const x = s[key]; if (x.o === 'open') o++; else { if (x.o === 'w') w++; else if (x.o === 'l') l++; else t++; sr += x.r; } } const n = w + l + t; return { n, w, l, t, open: o, win: w + l ? w / (w + l) : NaN, avgR: n ? sr / n : NaN, ci: wilson(w, w + l) }; }
