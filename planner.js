// Paper trade planner. Pure functions: no orders are ever sent anywhere.
// A trade is {id, sym, dir:'long'|'short', entry, sl, tp, risk (account $ risked), status:'pending'|'open'|'closed', ...}
export function riskDist(t) { return Math.abs(t.entry - t.sl); }
export function validate(dir, entry, sl, tp) {
  if (![entry, sl, tp].every(x => isFinite(x) && x > 0)) return 'Enter entry, stop and target as prices.';
  if (dir === 'long' && !(sl < entry && tp > entry)) return 'Long needs stop below entry and target above entry.';
  if (dir === 'short' && !(sl > entry && tp < entry)) return 'Short needs stop above entry and target below entry.';
  return null;
}
const sgn = t => t.dir === 'long' ? 1 : -1;
export const toR = (t, price) => (price - t.entry) * sgn(t) / riskDist(t);
// Feed one price range (a tick: h = l = price; or a candle's high and low). Mutates and returns events.
export function step(t, h, l, now, source) {
  const ev = [];
  if (t.status === 'closed') return ev;
  if (t.status === 'pending') {
    if (l <= t.entry && t.entry <= h) { t.status = 'open'; t.openedAt = now; t.mae = 0; t.mfe = 0; ev.push('filled'); }
    else return ev;
  }
  // excursions (in price), measured from entry
  const s = sgn(t), adverse = s > 0 ? t.entry - l : h - t.entry, fav = s > 0 ? h - t.entry : t.entry - l;
  const hitSL = s > 0 ? l <= t.sl : h >= t.sl, hitTP = s > 0 ? h >= t.tp : l <= t.tp;
  // price can never be more adverse than the stop, or more favourable than the target, after exit
  t.mae = Math.max(t.mae || 0, Math.min(Math.max(0, adverse), riskDist(t) * (hitSL ? 1 : 99)));
  t.mfe = Math.max(t.mfe || 0, Math.min(Math.max(0, fav), Math.abs(t.tp - t.entry) * (hitTP ? 1 : 99)));
  if (hitSL || hitTP) {
    const sl = hitSL && (!hitTP || true); // both in one candle: assume the stop came first (conservative)
    t.status = 'closed'; t.closedAt = now; t.exit = sl ? t.sl : t.tp; t.result = sl ? 'SL' : 'TP'; t.R = toR(t, t.exit);
    if (hitSL && hitTP) { t.ambiguous = true; if (source === 'tick') t.ambiguous = false; }
    ev.push('closed');
  }
  return ev;
}
export function closeManual(t, price, now) { if (t.status !== 'open') return; t.status = 'closed'; t.closedAt = now; t.exit = price; t.result = 'manual'; t.R = toR(t, price); }
export function stats(list) {
  const done = list.filter(t => t.status === 'closed'); const n = done.length; if (!n) return { n: 0 };
  const w = done.filter(t => t.R > 0), tot = done.reduce((a, t) => a + t.R, 0);
  const maeR = done.reduce((a, t) => a + (t.mae || 0) / riskDist(t), 0) / n, mfeR = done.reduce((a, t) => a + (t.mfe || 0) / riskDist(t), 0) / n;
  return { n, wins: w.length, winRate: w.length / n * 100, totalR: tot, avgR: tot / n, maeR, mfeR };
}
export function csv(list) {
  const cols = ['id', 'sym', 'dir', 'status', 'result', 'entry', 'sl', 'tp', 'exit', 'R', 'mae_R', 'mfe_R', 'risk_usd', 'pnl_usd', 'created', 'opened', 'closed', 'ambiguous', 'why', 'note'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const iso = t => t ? new Date(t).toISOString() : '';
  return [cols.join(',')].concat(list.map(t => { const d = riskDist(t); return [t.id, t.sym, t.dir, t.status, t.result, t.entry, t.sl, t.tp, t.exit, t.R != null ? t.R.toFixed(3) : '', t.mae != null ? (t.mae / d).toFixed(3) : '', t.mfe != null ? (t.mfe / d).toFixed(3) : '', t.risk, t.R != null && t.risk ? (t.R * t.risk).toFixed(2) : '', iso(t.created), iso(t.openedAt), iso(t.closedAt), t.ambiguous ? 'yes' : '', t.why, t.note].map(q).join(','); })).join('\n');
}
