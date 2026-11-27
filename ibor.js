// Opening Range (first 15 min) and Initial Balance (first 60 min) for the New York (09:30) and London (03:00, NY clock) sessions.
// DERIVED from candles by exact timestamps, needs a timeframe of 15m or lower. A break is the first candle CLOSE outside the IB after it formed;
// a retest is a later candle that trades back to the broken edge: "held" if it closes back on the break side, "failed" if it closes back inside.
import { wilderATR } from './ict.js';
const fm = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const parts = t => { const o = {}; for (const p of fm.formatToParts(new Date(t))) o[p.type] = p.value; return { day: o.year + '-' + o.month + '-' + o.day, min: (+o.hour % 24) * 60 + +o.minute }; };
export const SESSIONS = [{ name: 'NY', open: 570, end: 960 }, { name: 'LDN', open: 180, end: 480 }];
export function ibor(c, tfMs) {
  const n = c.length; if (!n || tfMs > 15 * 60e3) return null; const atr = wilderATR(c), res = [], by = new Map();
  for (let i = 0; i < n; i++) { const P = parts(c[i].t); for (const S of SESSIONS) { if (P.min >= S.open && P.min < S.end) { const k = S.name + P.day; let s = by.get(k); if (!s) { s = { name: S.name, day: P.day, i0: i, i1: i, minOpen: S.open, end: S.end, bars: [] }; by.set(k, s); res.push(s); } s.i1 = i; s.bars.push([i, P.min]); } } }
  const out = [];
  for (const s of res) {
    const orB = s.bars.filter(b => b[1] < s.minOpen + 15), ibB = s.bars.filter(b => b[1] < s.minOpen + 60);
    if (!orB.length || s.bars[0][1] !== s.minOpen) continue; // session start not in loaded data
    const ext = (B, f, g) => B.reduce((a, b) => g(a, f(c[b[0]])), f === undefined ? 0 : (g === Math.max ? -Infinity : Infinity));
    const orHi = Math.max(...orB.map(b => c[b[0]].h)), orLo = Math.min(...orB.map(b => c[b[0]].l)), ibHi = Math.max(...ibB.map(b => c[b[0]].h)), ibLo = Math.min(...ibB.map(b => c[b[0]].l));
    const orDone = orB.length * tfMs >= 15 * 60e3, ibDone = ibB.length * tfMs >= 60 * 60e3 && s.bars.some(b => b[1] >= s.minOpen + 60); // IB complete only when a later bar exists
    const r = { name: s.name, day: s.day, i0: s.i0, i1: s.i1, orHi, orLo, ibHi, ibLo, orDone, ibDone, brk: null, retest: null };
    if (ibDone) { const after = s.bars.filter(b => b[1] >= s.minOpen + 60).map(b => b[0]);
      for (const i of after) { if (c[i].c > ibHi) { r.brk = { i, dir: 'up', lvl: ibHi }; break; } if (c[i].c < ibLo) { r.brk = { i, dir: 'down', lvl: ibLo }; break; } }
      if (r.brk) { const tol = 0.1 * atr[r.brk.i]; for (const i of after) { if (i <= r.brk.i) continue; const up = r.brk.dir === 'up'; const touched = up ? c[i].l <= r.brk.lvl + tol : c[i].h >= r.brk.lvl - tol; if (touched) { r.retest = { i, held: up ? c[i].c > r.brk.lvl : c[i].c < r.brk.lvl }; break; } } } }
    out.push(r);
  }
  return out.slice(-6);
}
