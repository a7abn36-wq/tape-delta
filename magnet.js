// Liquidity magnet score. DERIVED checklist: which resting-liquidity pools are most likely to be targeted, ranked.
// Not a prediction. Inputs: unswept swing highs/lows and equal highs/lows (from candles), previous day/week levels (REAL),
// and live order-book walls (PARTIAL: only what the app has watched since opening, one venue).
import { wilderATR } from './ict.js';
export function magnets(c, ict, levels, walls, tfMs) {
  const n = c.length; if (!ict || n < 40) return null;
  const px = c[n - 1].c, atr = wilderATR(c)[n - 1] || px * 0.002, now = c[n - 1].t;
  const pools = [];
  const untouched = (p, from, side) => { for (let m = from + 1; m < n; m++) if (side === 'up' ? c[m].h > p : c[m].l < p) return false; return true; };
  for (const l of ict.liq) pools.push({ p: l.p, side: l.kind === 'BSL' ? 'up' : 'down', type: l.kind === 'BSL' ? 'swing high' : 'swing low', t0: c[l.i].t, touches: 1 });
  for (const e of ict.eq) { const side = e.kind === 'EQH' ? 'up' : 'down'; if (untouched(e.p, e.i2, side)) pools.push({ p: e.p, side, type: e.kind === 'EQH' ? 'equal highs' : 'equal lows', t0: c[e.i1].t, touches: 2, eq: true }); }
  const lv = levels || {}; const add = (name, p, pts) => { if (p == null || !isFinite(p)) return; pools.push({ p, side: p > px ? 'up' : 'down', type: name, t0: null, touches: 1, ref: pts }); };
  add('PDH', lv.pdh, 20); add('PDL', lv.pdl, 20); add('PWH', lv.pwh, 25); add('PWL', lv.pwl, 25);
  // merge pools within 0.1 ATR (clusters)
  pools.sort((a, b) => a.p - b.p); const out = [];
  for (const q of pools) { const m = out.find(o => o.side === q.side && Math.abs(o.p - q.p) <= 0.1 * atr); if (m) { m.types.push(q.type); m.touches += q.touches; m.eq ||= q.eq; m.ref = Math.max(m.ref || 0, q.ref || 0); if (q.t0 != null) m.t0 = m.t0 == null ? q.t0 : Math.min(m.t0, q.t0); } else out.push({ ...q, types: [q.type] }); }
  const ws = walls || [];
  for (const o of out) {
    o.dist = Math.abs(o.p - px); o.distAtr = o.dist / atr;
    const f = [];
    let s = 0; const pt = (k, v, txt) => { if (v > 0) { s += v; f.push({ k, v: Math.round(v), txt }); } };
    pt('base', o.ref ? o.ref : 20, o.types.join(' + '));
    if (o.touches >= 2) pt('cluster', Math.min(25, 10 + 8 * (o.touches - 1)), o.touches + ' levels stacked here');
    if (o.t0 != null) { const days = (now - o.t0) / 864e5; pt('age', Math.min(15, days * 5), days >= 1 ? Math.round(days) + 'd untouched' : Math.round(days * 24) + 'h untouched'); }
    pt('distance', 25 * Math.max(0, 1 - o.distAtr / 20), o.distAtr.toFixed(1) + ' ATR away');
    const w = ws.filter(x => Math.abs(x.p - o.p) / o.p <= 0.002).sort((a, b) => b.q - a.q)[0]; if (w) pt('book', 15, 'order-book wall near it (live, PARTIAL)');
    o.score = Math.min(100, Math.round(s)); o.factors = f; o.wall = !!w;
  }
  out.sort((a, b) => b.score - a.score);
  const up = out.filter(o => o.side === 'up').sort((a, b) => a.dist - b.dist)[0] || null, dn = out.filter(o => o.side === 'down').sort((a, b) => a.dist - b.dist)[0] || null;
  return { pools: out, nearUp: up, nearDown: dn, px, atr, top: out[0] || null };
}
