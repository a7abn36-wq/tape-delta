// Gold pack. PAXG (a gold-backed token) is a PROXY for spot gold. Everything here is computed from real exchange data.
import { sessionOf } from './flow.js';
export const GOLD = new Set(['PAXGUSDT', 'XAUUSDT']);
export function dailyATR(d, n = 14) { // Wilder ATR on daily candles, excluding the still-forming last candle
  const c = d.slice(0, -1); if (c.length < n + 1) return null; let a = 0;
  for (let i = 1; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); if (i <= n) { a += tr; if (i === n) a /= n; } else a = (a * (n - 1) + tr) / n; }
  return a;
}
// UTC ms of a wall-clock time in an IANA zone on the given zone-local date.
export function zonedMs(tz, y, m, d, h, mi) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const off = t => { const p = {}; for (const x of f.formatToParts(new Date(t))) p[x.type] = +x.value; return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t; };
  let g = Date.UTC(y, m - 1, d, h, mi); g -= off(g); g = Date.UTC(y, m - 1, d, h, mi) - off(g); return g;
}
const ymd = (tz, t) => { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t))) p[x.type] = +x.value; return p; };
// Reference times that matter for gold, for the zone-local days around `now`.
export function goldTimes(now) {
  const ev = [['London open', 'Europe/London', 8, 0], ['LBMA gold AM fix', 'Europe/London', 10, 30], ['US data (8:30 ET)', 'America/New_York', 8, 30], ['COMEX gold open', 'America/New_York', 8, 20], ['LBMA gold PM fix', 'Europe/London', 15, 0], ['COMEX settle', 'America/New_York', 13, 30]];
  const out = [];
  for (const off of [-1, 0, 1]) for (const [name, tz, h, mi] of ev) { const p = ymd(tz, now + off * 864e5); const t = zonedMs(tz, p.year, p.month, p.day, h, mi); const wd = new Date(t).getUTCDay(); if (wd === 0 || wd === 6) continue; out.push({ name, t }); }
  return out.sort((a, b) => a.t - b.t);
}
// Spot gold is closed from Friday 17:00 to Sunday 18:00 New York time. PAXG keeps trading, so moves then are not gold-market moves.
export function goldMarketOpen(now) { const p = {}; for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hourCycle: 'h23', hour: 'numeric' }).formatToParts(new Date(now))) p[x.type] = x.value; const wd = p.weekday, h = +p.hour; if (wd === 'Sat') return false; if (wd === 'Fri' && h >= 17) return false; if (wd === 'Sun' && h < 18) return false; return true; }
export function sessionRanges(c, tfMs) {
  if (tfMs > 3600e3 || !c.length) return []; const out = {}; let cur = null;
  for (let i = 0; i < c.length; i++) { const name = sessionOf(c[i].t); if (!cur || cur.name !== name || c[i].t - c[i - 1].t > 12 * 3600e3) { cur = { name, i1: i, hi: c[i].h, lo: c[i].l, start: c[i].t }; out[name] = cur; } else { cur.hi = Math.max(cur.hi, c[i].h); cur.lo = Math.min(cur.lo, c[i].l); } cur.i2 = i; cur.end = c[i].t + tfMs; }
  const last = c[c.length - 1].t; return ['ASIA', 'LONDON', 'NY'].filter(n => out[n]).map(n => ({ ...out[n], active: sessionOf(last) === n && out[n].i2 === c.length - 1 }));
}
export function usdProxyChange(e, e0, g, g0) { // EURUSDT and GBPUSDT are quoted as USD per foreign unit, so USD strength is the inverse; DXY weights EUR 57.6, GBP 11.9
  const wE = 0.576, wG = 0.119; return -(wE * Math.log(e / e0) + wG * Math.log(g / g0)) / (wE + wG) * 100;
}
export function corr(a, b) { const n = Math.min(a.length, b.length); if (n < 8) return null; const x = a.slice(-n), y = b.slice(-n); const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sx && sy ? sxy / Math.sqrt(sx * sy) : null; }
