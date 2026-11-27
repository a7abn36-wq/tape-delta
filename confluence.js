// ICT confluence engine. A rules-based checklist, not a prediction and not backtested.
import { nyHour, wilderATR } from './ict.js';
const f1 = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export function confluence(c, ict, levels, scvd, tfMs) {
  const n = c.length; if (!ict || n < 40) return null;
  const px = c[n - 1].c, atr = wilderATR(c)[n - 1], dec = px >= 100 ? 2 : px >= 1 ? 3 : 5;
  const near = Math.max(30, Math.round(24 * 900e3 / tfMs / 4)); // "recent" window in bars, shorter for slow charts
  const recent = i => n - 1 - i <= near;
  const res = { bull: { s: 0, f: [] }, bear: { s: 0, f: [] } };
  const put = (d, name, pts, text) => { res[d].s += pts; res[d].f.push({ name, pts, text }); };
  // 1 structure
  const st = ict.struct[ict.struct.length - 1];
  if (st) { const d = st.dir; const rec = recent(st.i2); if (st.kind === 'CHoCH') put(d, 'Structure', rec ? 20 : 12, `${st.kind} ${d === 'bull' ? 'up' : 'down'} ${fmtAge(n - 1 - st.i2, tfMs)} ago`); else put(d, 'Structure', rec ? 15 : 10, `${st.kind} ${d === 'bull' ? 'up' : 'down'} ${fmtAge(n - 1 - st.i2, tfMs)} ago`); }
  // 2 sweep of opposite liquidity
  const sw = [...ict.sweeps].reverse().find(s => recent(s.i));
  if (sw) { const d = sw.type === 'L' ? 'bull' : 'bear'; put(d, 'Liquidity', 20, `${sw.type === 'L' ? 'sell-side' : 'buy-side'} liquidity swept at ${f1(sw.p, dec)} ${fmtAge(n - 1 - sw.i, tfMs)} ago`); }
  // 3 premium / discount and OTE
  if (ict.pd) { const pos = (px - ict.pd.lo) / (ict.pd.hi - ict.pd.lo); const d = pos < 0.5 ? 'bull' : 'bear'; const depth = Math.round((d === 'bull' ? pos : 1 - pos) * 100);
    let pts = 10, tx = `${d === 'bull' ? 'discount' : 'premium'} (${Math.round(pos * 100)}% of range)`; if (ict.ote && ict.ote.dir === (d === 'bull' ? 'buy' : 'sell') && px >= ict.ote.lo && px <= ict.ote.hi) { pts = 15; tx += ', inside OTE'; } put(d, 'Zone', pts, tx); }
  // 4 point of interest: unmitigated FVG / OB touching price
  const tol = 0.25 * atr; let poi = null;
  for (const o of ict.ob) if (px >= o.lo - tol && px <= o.hi + tol) poi = { d: o.dir, text: `inside ${o.dir === 'bull' ? 'bullish' : 'bearish'} order block ${f1(o.lo, dec)} to ${f1(o.hi, dec)}`, lo: o.lo, hi: o.hi };
  if (!poi) for (const g of ict.fvg) if (px >= g.lo - tol && px <= g.hi + tol) poi = { d: g.dir, text: `inside ${g.dir === 'bull' ? 'bullish' : 'bearish'} FVG ${f1(g.lo, dec)} to ${f1(g.hi, dec)}`, lo: g.lo, hi: g.hi };
  if (poi) put(poi.d, 'POI', 20, poi.text);
  // 5 killzone (New York time)
  const h = nyHour(c[n - 1].t); const kz = h >= 2 && h < 5 ? 'London' : h >= 7 && h < 10 ? 'NY AM' : h >= 20 ? 'Asia' : null; const kzPts = kz === 'Asia' ? 5 : kz ? 10 : 0;
  // 6 order flow: last 3 bars delta and session CVD slope
  const d3 = c[n - 1].d + c[n - 2].d + c[n - 3].d; let slope = 0; if (scvd) { const k = Math.min(10, n - 1); slope = scvd.v[n - 1] - scvd.v[n - 1 - k]; if (scvd.starts.length && scvd.starts[scvd.starts.length - 1].i > n - 1 - k) slope = scvd.v[n - 1]; } else { let s = 0; for (let i = n - 10; i < n; i++) s += c[i].d; slope = s; }
  for (const d of ['bull', 'bear']) { const sg = d === 'bull' ? 1 : -1; const a = d3 * sg > 0, b = slope * sg > 0; if (a || b) res[d].f.push({ name: 'Flow', pts: a && b ? 15 : 7, text: `${a ? 'last 3 bars delta ' + (d === 'bull' ? 'positive' : 'negative') : ''}${a && b ? ', ' : ''}${b ? (scvd ? 'session CVD' : 'CVD') + ' rising'.replace('rising', d === 'bull' ? 'rising' : 'falling') : ''}` }), res[d].s += a && b ? 15 : 7; }
  // 7 day bias from daily open
  if (levels && levels.dOpen) { const d = px > levels.dOpen ? 'bull' : 'bear'; put(d, 'Day bias', 10, `price ${d === 'bull' ? 'above' : 'below'} day open ${f1(levels.dOpen, dec)}`); }
  let dir = res.bull.s >= res.bear.s ? 'bull' : 'bear'; const me = res[dir], opp = res[dir === 'bull' ? 'bear' : 'bull'];
  if (kz) for (const d of [dir]) { me.s += kzPts; me.f.push({ name: 'Time', pts: kzPts, text: kz + ' killzone' }); }
  const score = Math.min(100, me.s), oppScore = Math.min(100, opp.s), margin = score - oppScore;
  const label = score < 35 || margin < 15 ? 'NO EDGE' : dir === 'bull' ? 'LONG BIAS' : 'SHORT BIAS';
  // invalidation and target
  let inv = null, tgt = null;
  if (label !== 'NO EDGE') {
    if (dir === 'bull') { inv = poi && poi.d === 'bull' ? poi.lo : (ict.lastL ? ict.lastL.p : null); tgt = ict.liq.filter(l => l.kind === 'BSL' && l.p > px).sort((a, b) => a.p - b.p)[0]?.p ?? null; if (inv != null && inv >= px) inv = null; }
    else { inv = poi && poi.d === 'bear' ? poi.hi : (ict.lastH ? ict.lastH.p : null); tgt = ict.liq.filter(l => l.kind === 'SSL' && l.p < px).sort((a, b) => b.p - a.p)[0]?.p ?? null; if (inv != null && inv <= px) inv = null; }
  }
  const rr = inv != null && tgt != null && Math.abs(px - inv) > 0 ? Math.abs(tgt - px) / Math.abs(px - inv) : null;
  const why = label === 'NO EDGE' ? `No edge: long ${res.bull.s}, short ${res.bear.s}. Not enough aligned factors.` : me.f.filter(f => f.pts > 0).map(f => f.text).join(' · ');
  return { dir, label, score, oppScore, factors: me.f, opp: opp.f, why, inv, tgt, rr, px, dec, killzone: kz };
}
function fmtAge(bars, tfMs) { const m = bars * tfMs / 60000; return m >= 1440 ? Math.round(m / 1440) + 'd' : m >= 60 ? Math.round(m / 60) + 'h' : Math.round(m) + 'm'; }
