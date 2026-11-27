// Extra drawing tools. Pure geometry + canvas drawing. Points are {t, p} (time, price).
export const DEFS = {
  fib: { n: 2, ic: 'Fib', name: ['Fibonacci retracement: tap swing start, then swing end (or drag)', 'فيبوناتشي ارتداد: دوس بداية الموجة وبعدين نهايتها (أو اسحب)'] },
  fibext: { n: 3, ic: 'FibX', name: ['Fibonacci extension: tap A, B, then C', 'فيبوناتشي امتداد: دوس A وبعدين B وبعدين C'] },
};
DEFS.ray = { n: 2, ic: '↗', name: ['Ray: tap start, then a point it passes through', 'شعاع: دوس البداية وبعدين نقطة بيعدي منها'] };
DEFS.hray = { n: 1, ic: '⇥', name: ['Horizontal ray: tap a price', 'شعاع أفقي: دوس على سعر'] };
DEFS.vline = { n: 1, ic: '│', name: ['Vertical line: tap a time', 'خط رأسي: دوس على وقت'] };
DEFS.arrow = { n: 2, ic: '➚', name: ['Arrow: tap start, then the tip (or drag)', 'سهم: دوس البداية وبعدين الرأس (أو اسحب)'] };
DEFS.channel = { n: 3, ic: '▱', name: ['Parallel channel: tap 2 points of the trend line, then a point on the other side', 'قناة موازية: دوس نقطتين للخط وبعدين نقطة للجهة التانية'] };
DEFS.fork = { n: 3, ic: 'Ψ', name: ['Andrews pitchfork: tap pivot, then the next swing high and swing low', 'Pitchfork: دوس نقطة الارتكاز وبعدين القمة والقاع التاليين'] };
DEFS.pos = { n: 3, ic: 'R:R', name: ['Long/short position: tap entry, then stop, then target', 'مركز شراء/بيع: دوس الدخول وبعدين الوقف وبعدين الهدف'] };
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
const ext = (a, b, L = 5000) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: a.x + dx / l * L, y: a.y + dy / l * L }; };
// px segments describing a drawing (used for drawing lines and for hit testing)
export function segs(ch, d) {
  const ps = d.pts.map(q => ch.P(q)), [a, b, c] = ps, W = ch.plotW, H = ch.lay ? ch.lay.mainH : ch.H;
  switch (d.type) {
    case 'pos': { if (!b || !c) return []; const x0 = a.x, x1 = x0 + Math.max(70, Math.max(b.x, c.x) - x0); return [[{ x: x0, y: a.y }, { x: x1, y: a.y }], [{ x: x0, y: b.y }, { x: x1, y: b.y }], [{ x: x0, y: c.y }, { x: x1, y: c.y }]]; }
    case 'ray': return b ? [[a, ext(a, b)]] : [];
    case 'hray': return [[{ x: a.x, y: a.y }, { x: W, y: a.y }]];
    case 'vline': return [[{ x: a.x, y: 0 }, { x: a.x, y: H }]];
    case 'arrow': return b ? [[a, b]] : [];
    case 'channel': { if (!b || !c) return []; const k = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x), dy = c.y - (a.y + k * (c.x - a.x)); return [[a, b], [{ x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }]]; }
    case 'fork': { if (!b || !c) return []; const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, dx = m.x - a.x, dy = m.y - a.y, e = (p) => ({ x: p.x + dx / (Math.hypot(dx, dy) || 1) * 5000, y: p.y + dy / (Math.hypot(dx, dy) || 1) * 5000 }); return [[a, e(a)], [b, e(b)], [c, e(c)]]; }
  }
  return [];
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
    return;
  }
  if (d.type === 'pos') {
    const S0 = segs(ch, d); if (!S0.length) return; const [E, SL, TP] = S0, x0 = E[0].x, x1 = E[1].x, [A, B, C] = d.pts, lw = d.w || (sel ? 2.4 : 1.4);
    const risk = Math.abs(A.p - B.p), rew = Math.abs(C.p - A.p), long = C.p > A.p && B.p < A.p, short = C.p < A.p && B.p > A.p, ok = long || short, rr = risk > 0 ? rew / risk : 0; const pc = v => (v >= 0 ? '+' : '') + (v / A.p * 100).toFixed(2) + '%';
    g.save(); g.beginPath(); g.rect(0, 0, ch.plotW, ch.lay ? ch.lay.mainH : ch.H); g.clip(); g.setLineDash([]);
    g.globalAlpha = .16; g.fillStyle = '#ef5350'; g.fillRect(x0, Math.min(E[0].y, SL[0].y), x1 - x0, Math.abs(SL[0].y - E[0].y)); g.fillStyle = '#26a69a'; g.fillRect(x0, Math.min(E[0].y, TP[0].y), x1 - x0, Math.abs(TP[0].y - E[0].y)); g.globalAlpha = 1;
    const ln = (S, c) => { g.strokeStyle = c; g.lineWidth = lw; g.beginPath(); g.moveTo(S[0].x, S[0].y); g.lineTo(S[1].x, S[1].y); g.stroke(); };
    ln(E, d.color || '#9aa7bd'); ln(SL, '#ef5350'); ln(TP, '#26a69a'); g.font = 'bold 10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const lab = (t, x, y, c) => { g.fillStyle = c; g.fillText(t, x, y); };
    lab(`${ok ? (long ? 'LONG' : 'SHORT') : 'check side'}  R:R ${rr.toFixed(2)}  ${fmtP(A.p, ch.dec)}`, x0 + 4, E[0].y - 4, d.color || '#9aa7bd');
    lab(`Stop ${fmtP(B.p, ch.dec)} (${pc(B.p - A.p)})`, x0 + 4, SL[0].y + (B.p < A.p ? 11 : -4), '#ef5350');
    lab(`Target ${fmtP(C.p, ch.dec)} (${pc(C.p - A.p)})`, x0 + 4, TP[0].y + (C.p < A.p ? 11 : -4), '#26a69a');
    if (!ok) lab('stop and target must be on opposite sides of entry', x0 + 4, E[0].y + 22, '#e6b84a');
    g.restore(); return;
  }
  const S = segs(ch, d); if (!S.length) return; const lw = d.w || (sel ? 2.4 : 1.4); g.save(); g.beginPath(); g.rect(0, 0, ch.plotW, ch.lay ? ch.lay.mainH : ch.H); g.clip(); g.strokeStyle = g.fillStyle = col; g.lineWidth = lw; g.setLineDash([]);
  const line = (a, b) => { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
  if (d.type === 'channel') { const [[a, b], [a2, b2]] = S; g.globalAlpha = .1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b2.x, b2.y); g.lineTo(a2.x, a2.y); g.closePath(); g.fill(); g.globalAlpha = 1; line(a, b); line(a2, b2); g.setLineDash([4, 4]); g.globalAlpha = .7; line({ x: (a.x + a2.x) / 2, y: (a.y + a2.y) / 2 }, { x: (b.x + b2.x) / 2, y: (b.y + b2.y) / 2 }); g.globalAlpha = 1; }
  else if (d.type === 'fork') { const [m, u, l] = S; g.globalAlpha = .08; g.beginPath(); g.moveTo(u[0].x, u[0].y); g.lineTo(u[1].x, u[1].y); g.lineTo(l[1].x, l[1].y); g.lineTo(l[0].x, l[0].y); g.closePath(); g.fill(); g.globalAlpha = 1; line(...m); line(...u); line(...l); g.setLineDash([3, 3]); line(u[0], l[0]); }
  else if (d.type === 'arrow') { const [[a, b]] = S, ang = Math.atan2(b.y - a.y, b.x - a.x), h = 11; line(a, b); g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - h * Math.cos(ang - .45), b.y - h * Math.sin(ang - .45)); g.lineTo(b.x - h * Math.cos(ang + .45), b.y - h * Math.sin(ang + .45)); g.closePath(); g.fill(); }
  else { for (const [a, b] of S) line(a, b); if (d.type === 'hray') { g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(fmtP(d.pts[0].p, ch.dec), Math.max(4, S[0][0].x + 4), S[0][0].y - 5); } }
  g.restore();
}
function fmtP(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
// distance in px from (x,y) to the drawing (for selecting)
export function dist(ch, d, x, y) {
  let best = Infinity; const seg = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((x - a.x) * dx + (y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy))); };
  if (d.type === 'fib' || d.type === 'fibext') { if (d.pts.length < (d.type === 'fib' ? 2 : 3)) return best; const [x1, x2] = xr(ch, d); for (const o of levels(d)) { const yy = ch.ymap(o.p); seg({ x: x1, y: yy }, { x: x2, y: yy }); } const ps = d.pts.map(q => ch.P(q)); for (let i = 0; i < ps.length - 1; i++) seg(ps[i], ps[i + 1]); }
  else for (const [a, b] of segs(ch, d)) seg(a, b);
  if (d.type === 'pos' && best > 0) { const S = segs(ch, d); if (S.length) { const ys = S.map(z => z[0].y), x0 = S[0][0].x, x1 = S[0][1].x; if (x >= x0 && x <= x1 && y >= Math.min(...ys) && y <= Math.max(...ys)) best = Math.min(best, 6); } }
  if (d.type === 'channel' && best > 0) { const S = segs(ch, d); if (S.length) { const [[a, b], [a2, b2]] = S; const inside = (px, py) => { let c = false; const P = [a, b, b2, a2]; for (let i = 0, j = 3; i < 4; j = i++) if ((P[i].y > py) !== (P[j].y > py) && px < (P[j].x - P[i].x) * (py - P[i].y) / (P[j].y - P[i].y) + P[i].x) c = !c; return c; }; if (inside(x, y)) best = Math.min(best, 6); } }
  return best;
}
