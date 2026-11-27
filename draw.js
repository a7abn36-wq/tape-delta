// Extra drawing tools. Pure geometry + canvas drawing. Points are {t, p} (time, price).
export const DEFS = {
  fib: { n: 2, ic: 'Fib', name: ['Fibonacci retracement: tap swing start, then swing end (or drag)', 'فيبوناتشي ارتداد: دوس بداية الموجة وبعدين نهايتها (أو اسحب)'] },
  fibext: { n: 3, ic: 'FibX', name: ['Fibonacci extension: tap A, B, then C', 'فيبوناتشي امتداد: دوس A وبعدين B وبعدين C'] },
};
export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIBX = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
const COL = ['#9aa7bd', '#ef5350', '#ff9800', '#e6b84a', '#26a69a', '#4c8dff', '#b58cff', '#ff9ff3'];
const lvCol = i => COL[(i + 1) % COL.length];
const fmtL = l => (Math.round(l * 1000) / 1000).toString();
export const has = t => !!DEFS[t];
// price levels for fib types
export function levels(d) {
  const [A, B, C] = d.pts;
  if (d.type === 'fib') return FIB.map(l => ({ l, p: B.p + (A.p - B.p) * l }));
  if (d.type === 'fibext' && C) return FIBX.map(l => ({ l, p: C.p + (B.p - A.p) * l }));
  return [];
}
function xr(ch, d) { // x span of the levels: from leftmost point to the right edge
  const xs = d.pts.map(q => ch.P(q).x); return [Math.min(...xs), ch.plotW];
}
export function render(ch, g, th, d, sel) {
  const col = d.color || th.gold, [x1, x2] = d.type === 'fib' || d.type === 'fibext' ? xr(ch, d) : [0, 0];
  if (d.type === 'fib' || d.type === 'fibext') {
    if (d.pts.length < (d.type === 'fib' ? 2 : 3)) return; const L = levels(d), ys = L.map(o => ch.ymap(o.p));
    g.save(); g.beginPath(); g.rect(0, 0, ch.plotW, ch.lay ? ch.lay.mainH : ch.H); g.clip();
    for (let i = 0; i < L.length - 1; i++) { g.globalAlpha = .07; g.fillStyle = lvCol(i); g.fillRect(x1, Math.min(ys[i], ys[i + 1]), x2 - x1, Math.abs(ys[i + 1] - ys[i])); }
    g.globalAlpha = 1; g.font = '10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    L.forEach((o, i) => { g.strokeStyle = g.fillStyle = lvCol(i - 1); g.lineWidth = d.w || (sel ? 2.2 : 1.1); g.setLineDash(o.l === 0 || o.l === 1 ? [] : [5, 3]); g.beginPath(); g.moveTo(x1, ys[i]); g.lineTo(x2, ys[i]); g.stroke(); g.setLineDash([]); g.fillText(`${fmtL(o.l)}  ${fmtP(o.p, ch.dec)}`, Math.max(4, x1 + 4), ys[i] - 3); });
    // guide between the user points
    g.strokeStyle = col; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); d.pts.forEach((q, k) => { const a = ch.P(q); k ? g.lineTo(a.x, a.y) : g.moveTo(a.x, a.y); }); g.stroke(); g.setLineDash([]);
    g.restore();
  }
}
function fmtP(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
// distance in px from (x,y) to the drawing (for selecting)
export function dist(ch, d, x, y) {
  let best = Infinity; const seg = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((x - a.x) * dx + (y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))); };
  if (d.type === 'fib' || d.type === 'fibext') { if (d.pts.length < (d.type === 'fib' ? 2 : 3)) return best; const [x1, x2] = xr(ch, d); for (const o of levels(d)) { const yy = ch.ymap(o.p); seg({ x: x1, y: yy }, { x: x2, y: yy }); } const ps = d.pts.map(q => ch.P(q)); for (let i = 0; i < ps.length - 1; i++) seg(ps[i], ps[i + 1]); }
  return best;
}
