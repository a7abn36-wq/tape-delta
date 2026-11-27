// ICT / SMC computations. All layers are independent of each other.
export function wilderATR(c, n = 14) {
  const a = new Array(c.length).fill(NaN); let s = 0;
  for (let i = 0; i < c.length; i++) {
    const tr = i ? Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)) : c[i].h - c[i].l;
    if (i < n) { s += tr; if (i === n - 1) a[i] = s / n; } else a[i] = (a[i - 1] * (n - 1) + tr) / n;
  }
  const first = a.find(x => !isNaN(x)); return a.map(x => isNaN(x) ? (first ?? 0) : x);
}
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false });
export function nyHour(t) { const h = +nyFmt.format(new Date(t)); return h === 24 ? 0 : h; }

export function computeICT(c, tfMs, levels) {
  const n = c.length, L = 3;
  const out = { fvg: [], ob: [], liq: [], eq: [], struct: [], swings: [], sweeps: [], kill: [], levels: [], pd: null, ote: null };
  if (n < 20) return out;
  const atr = wilderATR(c);
  // swings
  const sw = [];
  for (let i = L; i < n - L; i++) {
    let H = true, Lo = true;
    for (let j = 1; j <= L; j++) {
      if (!(c[i].h > c[i - j].h && c[i].h >= c[i + j].h)) H = false;
      if (!(c[i].l < c[i - j].l && c[i].l <= c[i + j].l)) Lo = false;
    }
    if (H) sw.push({ i, type: 'H', p: c[i].h, conf: i + L });
    if (Lo) sw.push({ i, type: 'L', p: c[i].l, conf: i + L });
  }
  sw.sort((a, b) => a.conf - b.conf || a.i - b.i);
  // HH/HL/LH/LL labels
  let pH = null, pL = null;
  for (const s of sw.slice().sort((a, b) => a.i - b.i)) {
    if (s.type === 'H') { s.label = pH ? (s.p > pH.p ? 'HH' : 'LH') : null; pH = s; }
    else { s.label = pL ? (s.p < pL.p ? 'LL' : 'HL') : null; pL = s; }
  }
  out.swings = sw.filter(s => s.label).slice(-14);
  // structure + order blocks
  let lastH = null, lastL = null, trend = null, si = 0;
  const obs = [];
  // the still-forming last candle has a provisional close: a structure break must never be decided on it (it could repaint)
  const kEnd = c[n - 1].t + tfMs > Date.now() ? n - 1 : n;
  for (let k = 0; k < kEnd; k++) {
    while (si < sw.length && sw[si].conf <= k) { const s = sw[si++]; if (s.type === 'H') lastH = { ...s, broken: false }; else lastL = { ...s, broken: false }; }
    if (lastH && !lastH.broken && c[k].c > lastH.p) {
      lastH.broken = true; const kind = trend === 'bear' ? 'CHoCH' : 'BOS'; trend = 'bull';
      out.struct.push({ kind, dir: 'bull', i1: lastH.i, i2: k, p: lastH.p });
      let m = lastH.i; for (let j = lastH.i; j <= k; j++) if (c[j].l < c[m].l) m = j;
      let o = m; for (let j = m; j >= Math.max(0, m - 6); j--) if (c[j].c < c[j].o) { o = j; break; }
      obs.push({ dir: 'bull', i: o, lo: c[o].l, hi: c[o].h, k });
    }
    if (lastL && !lastL.broken && c[k].c < lastL.p) {
      lastL.broken = true; const kind = trend === 'bull' ? 'CHoCH' : 'BOS'; trend = 'bear';
      out.struct.push({ kind, dir: 'bear', i1: lastL.i, i2: k, p: lastL.p });
      let m = lastL.i; for (let j = lastL.i; j <= k; j++) if (c[j].h > c[m].h) m = j;
      let o = m; for (let j = m; j >= Math.max(0, m - 6); j--) if (c[j].c > c[j].o) { o = j; break; }
      obs.push({ dir: 'bear', i: o, lo: c[o].l, hi: c[o].h, k });
    }
  }
  out.trend = trend; out.struct = out.struct.slice(-10);
  out.lastH = [...sw].reverse().find(s => s.type === 'H') || null; out.lastL = [...sw].reverse().find(s => s.type === 'L') || null;
  const seen = new Set();
  for (const o of obs) {
    if (seen.has(o.dir + o.i)) continue; seen.add(o.dir + o.i);
    let end = null;
    for (let m = o.k + 1; m < n; m++) if ((o.dir === 'bull' && c[m].c < o.lo) || (o.dir === 'bear' && c[m].c > o.hi)) { end = m; break; }
    if (end === null) out.ob.push({ ...o, id: 'ob' + o.dir + c[o.i].t });
  }
  out.ob = out.ob.slice(-6);
  // FVG
  const fv = [];
  for (let i = 2; i < n; i++) {
    const min = 0.1 * atr[i];
    if (c[i].l - c[i - 2].h > min) fv.push({ dir: 'bull', i: i - 1, lo: c[i - 2].h, hi: c[i].l, from: i });
    if (c[i - 2].l - c[i].h > min) fv.push({ dir: 'bear', i: i - 1, lo: c[i].h, hi: c[i - 2].l, from: i });
  }
  for (const g of fv) {
    let lo = g.lo, hi = g.hi, filled = false;
    for (let m = g.from + 1; m < n; m++) {
      if (g.dir === 'bull') { if (c[m].l < hi) hi = Math.max(lo, c[m].l); if (hi <= lo) { filled = true; break; } }
      else { if (c[m].h > lo) lo = Math.min(hi, c[m].h); if (lo >= hi) { filled = true; break; } }
    }
    if (!filled) out.fvg.push({ dir: g.dir, i: g.i, lo, hi, id: 'fvg' + g.dir + c[g.i].t });
  }
  out.fvg = out.fvg.slice(-10);
  // liquidity: unswept swing highs/lows, sweeps, equal highs/lows
  const last = c[n - 1].c; const liqH = [], liqL = [];
  for (const s of sw) {
    let swept = -1;
    for (let m = s.conf; m < n; m++) if ((s.type === 'H' && c[m].h > s.p) || (s.type === 'L' && c[m].l < s.p)) { swept = m; break; }
    if (swept < 0) (s.type === 'H' ? liqH : liqL).push(s);
    else if ((s.type === 'H' && c[swept].c < s.p) || (s.type === 'L' && c[swept].c > s.p)) out.sweeps.push({ i: swept, type: s.type, p: s.p, from: s.i });
  }
  const near = (a) => a.sort((x, y) => Math.abs(x.p - last) - Math.abs(y.p - last)).slice(0, 4);
  near(liqH).forEach(s => out.liq.push({ i: s.i, p: s.p, kind: 'BSL', id: 'bsl' + c[s.i].t }));
  near(liqL).forEach(s => out.liq.push({ i: s.i, p: s.p, kind: 'SSL', id: 'ssl' + c[s.i].t }));
  out.sweeps = out.sweeps.slice(-6);
  for (const ty of ['H', 'L']) {
    const arr = sw.filter(s => s.type === ty);
    for (let a = 1; a < arr.length; a++) {
      const s1 = arr[a - 1], s2 = arr[a];
      if (Math.abs(s1.p - s2.p) <= 0.2 * atr[s2.i] && s2.i - s1.i >= 3) out.eq.push({ i1: s1.i, i2: s2.i, p: (s1.p + s2.p) / 2, kind: ty === 'H' ? 'EQH' : 'EQL' });
    }
  }
  out.eq = out.eq.slice(-4);
  // killzones in New York time (Asia 20-24, London 02-05, NY AM 07-10)
  if (tfMs <= 3600e3) {
    const zones = [['ASIA', 20, 24], ['LONDON', 2, 5], ['NY AM', 7, 10]];
    let cur = null;
    for (let i = 0; i < n; i++) {
      const h = nyHour(c[i].t); const z = zones.find(z => h >= z[1] && h < z[2]);
      const key = z ? z[0] + Math.floor((c[i].t - (z[0] === 'ASIA' && h >= 20 ? 0 : 0)) / 864e5) : null;
      if (cur && (!z || cur.key !== key)) { out.kill.push(cur); cur = null; }
      if (z) { if (!cur) cur = { key, name: z[0], i1: i, i2: i, hi: c[i].h, lo: c[i].l }; else { cur.i2 = i; cur.hi = Math.max(cur.hi, c[i].h); cur.lo = Math.min(cur.lo, c[i].l); } }
    }
    if (cur) out.kill.push(cur);
    out.kill = out.kill.slice(-9);
  }
  // session levels from higher timeframe candles
  if (levels) {
    const add = (name, p) => { if (p != null && isFinite(p)) out.levels.push({ name, p }); };
    add('PDH', levels.pdh); add('PDL', levels.pdl); add('D.OPEN', levels.dOpen); add('W.OPEN', levels.wOpen); { const lp = c[n - 1].c, nr = p => p != null && Math.abs(p - lp) / lp < 0.06; /* far weekly/monthly levels stay in the MTF tab, not on the chart */ if (nr(levels.pwh)) add('PWH', levels.pwh); if (nr(levels.pwl)) add('PWL', levels.pwl); if (nr(levels.mOpen)) add('M.OPEN', levels.mOpen); if (nr(levels.pmh)) add('PMH', levels.pmh); if (nr(levels.pml)) add('PML', levels.pml); }
  }
  // premium / discount + OTE from latest confirmed swing pair
  const hs = [...sw].reverse().find(s => s.type === 'H'), ls = [...sw].reverse().find(s => s.type === 'L');
  if (hs && ls) {
    const hi = Math.max(hs.p, ls.p), lo = Math.min(hs.p, ls.p), r = hi - lo;
    out.pd = { hi, lo, eq: lo + r / 2, i: Math.min(hs.i, ls.i) };
    const upLeg = ls.i < hs.i;
    out.ote = upLeg ? { lo: hi - 0.79 * r, hi: hi - 0.62 * r, dir: 'buy', i: Math.min(hs.i, ls.i) } : { lo: lo + 0.62 * r, hi: lo + 0.79 * r, dir: 'sell', i: Math.min(hs.i, ls.i) };
  }
  return out;
}

export function ema(c, n) { // seeded with the SMA of the first n closes, like TradingView
  const k = 2 / (n + 1); const o = new Array(c.length).fill(NaN); if (c.length < n) return o; let e = 0; for (let i = 0; i < n; i++) e += c[i].c; e /= n; o[n - 1] = e;
  for (let i = n; i < c.length; i++) { e = c[i].c * k + e * (1 - k); o[i] = e; } return o;
}
export function rsi(c, n = 14) { // Wilder
  const o = new Array(c.length).fill(NaN); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c, up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return o;
}
export function vwap(c, tfMs) { // resets each UTC day
  const o = []; let pv = 0, vv = 0, day = -1;
  for (const b of c) { const d = Math.floor(b.t / 864e5); if (d !== day) { day = d; pv = 0; vv = 0; } const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; o.push(vv ? pv / vv : NaN); }
  return o;
}

// Daily-reset VWAP with volume-weighted standard-deviation bands of the typical price (hlc3). Bands at 1 and 2 SD. DERIVED from candle volume.
export function vwapBands(c) {
  const n = c.length, o = { v: new Array(n).fill(NaN), u1: [], d1: [], u2: [], d2: [] }; for (const k of ['u1', 'd1', 'u2', 'd2']) o[k] = new Array(n).fill(NaN);
  let pv = 0, vv = 0, p2 = 0, day = -1;
  for (let i = 0; i < n; i++) { const b = c[i], d = Math.floor(b.t / 864e5); if (d !== day) { day = d; pv = 0; vv = 0; p2 = 0; } const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vv += b.v; p2 += tp * tp * b.v;
    if (vv > 0) { const m = pv / vv, sd = Math.sqrt(Math.max(0, p2 / vv - m * m)); o.v[i] = m; o.u1[i] = m + sd; o.d1[i] = m - sd; o.u2[i] = m + 2 * sd; o.d2[i] = m - 2 * sd; } }
  return o;
}
