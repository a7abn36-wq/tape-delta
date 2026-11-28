import { ema, rsi, vwap, vwapBands } from './ict.js';
import { ibor } from './ibor.js';
import * as DR from './draw.js';
import { absorption, deltaDiv } from './flow2.js';
import { isAr as isArLocal } from './i18n.js';
import { goldSignals } from './bwgold.js';
import { computeSK } from './wolfsk.js';
import { sessionCVD, avwap, idxAtOrAfter, detectFlow, cvdDivergence, gateAbs } from './flow.js';
const TH = {
  dark: { bg: '#0b0e14', panel: '#10151e', grid: '#1a2130', text: '#8b97ad', ax: '#c5cee0', up: '#26a69a', dn: '#ef5350', cu: '#00ffe0', cd: '#ff3d1f', cross: '#5d6b85', gold: '#e6b84a', blue: '#4c8dff' },
  light: { bg: '#ffffff', panel: '#f4f6fa', grid: '#e6eaf1', text: '#5b6578', ax: '#1c2433', up: '#13967f', dn: '#d43b3b', cu: '#00a89a', cd: '#e0340f', cross: '#8a94a8', gold: '#b8860b', blue: '#1f6feb' },
};
const BG = new Image(); BG.src = 'icons/bg.jpg'; BG.onload = () => { try { window.app && window.app.chart.invalidate(); } catch (e) {} };
let AXW = 68; const AXH = 24, SUBH = 92;
function nice(step) { const e = Math.pow(10, Math.floor(Math.log10(step))); const f = step / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
function fmtP(p, dec) { return p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
let FXM = false; export function setFx(v) { FXM = !!v; }
export function decimals(price) { if (FXM) return price >= 20 ? 3 : 5; return price >= 1000 ? 2 : price >= 100 ? 2 : price >= 1 ? 3 : price >= 0.1 ? 4 : price >= 0.01 ? 5 : price >= 0.0001 ? 6 : 8; }
function fmtV(v) { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3); }

export class Chart {
  constructor(canvas, app) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.app = app;
    this.view = { barW: 9, right: 0, yz: 1, yc: 0 }; this.mouse = null; this.pending = null; this.hover = null;
    this.dirty = true; this.cache = {};
    this._bind(); new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    const loop = () => { if (this.dirty) { this.dirty = false; try { this.draw(); } catch (e) { console.error(e); } } requestAnimationFrame(loop); };
    loop();
  }
  invalidate() { this.dirty = true; }
  resize() { const p = this.cv.parentElement, r = devicePixelRatio || 1; this.W = p.clientWidth; this.H = p.clientHeight; this.cv.width = this.W * r; this.cv.height = this.H * r; this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px'; this.ctx.setTransform(r, 0, 0, r, 0, 0); this.dirty = true; }
  get c() { return this.app.visibleCandles(); }
  resetView(keepZoom) { const n = this.c.length; if (!keepZoom) this.view.barW = this.W < 600 ? 7 : 9; this.view.right = n - 1 + 6; this.view.yz = 1; this.view.yc = 0; this.invalidate(); }
  snapshot() { return { ...this.view }; }
  restore(v) { this.view = { ...v }; this.invalidate(); }
  // geometry
  get plotW() { return this.W - AXW; }
  subs() { const i = this.app.state.ind; return ['delta', 'scvd', 'cvd', 'rsi'].filter(k => i[k]); }
  layout() { const subs = this.subs(); const mainH = Math.max(120, this.H - AXH - subs.length * SUBH); return { mainH, subs, subTop: k => mainH + subs.indexOf(k) * SUBH }; }
  xOf(i) { return this.plotW - (this.view.right - i) * this.view.barW; }
  iOf(x) { return this.view.right - (this.plotW - x) / this.view.barW; }
  idxOfT(t) { const c = this.c; if (!c.length) return 0; return (t - c[0].t) / this.app.tfMs(); }
  tOfIdx(i) { const c = this.c; return c[0].t + i * this.app.tfMs(); }
  yOf(p) { return this.ymap ? this.ymap(p) : 0; }
  pOf(y) { return this.pmap ? this.pmap(y) : 0; }
  range() {
    const c = this.c; if (!c.length) return [0, 1];
    const i0 = Math.max(0, Math.floor(this.iOf(0))), i1 = Math.min(c.length - 1, Math.ceil(this.iOf(this.plotW)));
    let lo = Infinity, hi = -Infinity; for (let i = i0; i <= i1; i++) { if (c[i].l < lo) lo = c[i].l; if (c[i].h > hi) hi = c[i].h; }
    if (!isFinite(lo)) { lo = c[c.length - 1].l; hi = c[c.length - 1].h; }
    const pad = (hi - lo) * 0.08 || hi * 0.001; lo -= pad; hi += pad;
    const mid = (lo + hi) / 2 + this.view.yc * (hi - lo), half = (hi - lo) / 2 * this.view.yz;
    return [mid - half, mid + half, i0, i1];
  }
  draw() {
    const { ctx: g, app } = this; const th = TH[app.state.theme]; this.th = th;
    const W = this.W, H = this.H; g.clearRect(0, 0, W, H); g.fillStyle = th.bg; g.fillRect(0, 0, W, H); if (this.app.state.bgImg !== false && th === TH.dark && BG.complete && BG.naturalWidth) { const s = Math.max(W / BG.naturalWidth, H / BG.naturalHeight), iw = BG.naturalWidth * s, ih = BG.naturalHeight * s; g.save(); g.globalAlpha = .14; g.drawImage(BG, (W - iw) / 2, (H - ih) / 2, iw, ih); g.restore(); }
    const c = this.c; if (!c.length) { g.fillStyle = th.text; g.font = '14px system-ui'; g.fillText(app.loadMsg || 'Loading...', 20, 40); return; }
    { const vis = this.plotW / this.view.barW; if (isFinite(vis)) this.view.right = Math.min(Math.max(this.view.right, vis * 0.4), c.length + vis * 0.6); } // keep some candles on screen: never scroll into an empty range
    const lay = this.layout(); this.lay = lay; const [lo, hi, i0, i1] = this.range(); this.rg = [lo, hi, i0, i1];
    const mh = lay.mainH; this.ymap = p => mh - (p - lo) / (hi - lo) * mh; this.pmap = y => lo + (mh - y) / mh * (hi - lo);
    const dec = decimals(c[c.length - 1].c); this.dec = dec; AXW = dec >= 8 ? 96 : dec >= 6 ? 80 : 68; const bw = this.view.barW;
    // grid + price axis
    g.font = '11px ui-monospace,Menlo,monospace'; g.textBaseline = 'middle';
    const step = nice((hi - lo) / Math.max(3, mh / 55));
    g.strokeStyle = th.grid; g.lineWidth = 1; g.fillStyle = th.text; g.textAlign = 'left';
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) { const y = Math.round(this.ymap(p)) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(this.plotW, y); g.stroke(); g.fillText(fmtP(p, step < 1 ? Math.max(dec, 2) : (step % 1 ? 2 : 0)), this.plotW + 6, y); }
    this.drawTimeAxis(i0, i1, lay);
    g.save(); g.beginPath(); g.rect(0, 0, this.plotW, mh); g.clip();
    this.labels = [];
    // killzones, ICT boxes
    const st = app.state, ict = app.ict, z = st.ict;
    if (ict && st.ind.ict) {
      if (z.kill) for (const k of ict.kill) { const x1 = this.xOf(k.i1) - bw / 2, x2 = this.xOf(k.i2) + bw / 2; g.fillStyle = k.name === 'ASIA' ? 'rgba(120,140,255,.10)' : k.name === 'LONDON' ? 'rgba(255,170,60,.10)' : 'rgba(60,200,150,.10)'; g.fillRect(x1, 0, x2 - x1, mh); g.strokeStyle = 'rgba(160,170,200,.35)'; g.setLineDash([3, 3]); const y1 = this.ymap(k.hi), y2 = this.ymap(k.lo); g.strokeRect(x1, y1, x2 - x1, y2 - y1); g.setLineDash([]); this.label(k.name, x1 + 3, 10, th.text); }
      if (z.pd && ict.pd) { const x = Math.max(0, this.xOf(ict.pd.i)); const pd = ict.pd; g.fillStyle = 'rgba(239,83,80,.06)'; g.fillRect(x, this.ymap(pd.hi), this.plotW - x, this.ymap(pd.eq) - this.ymap(pd.hi)); g.fillStyle = 'rgba(38,166,154,.06)'; g.fillRect(x, this.ymap(pd.eq), this.plotW - x, this.ymap(pd.lo) - this.ymap(pd.eq)); this.hline(pd.eq, 'EQ 50%', th.text, [2, 4]); this.edge(pd.hi, 'PREMIUM', th.dn); this.edge(pd.lo, 'DISCOUNT', th.up); }
      if (z.ote && ict.ote) { const o = ict.ote, x = Math.max(0, this.xOf(o.i)); g.fillStyle = 'rgba(230,184,74,.13)'; g.fillRect(x, this.ymap(o.hi), this.plotW - x, this.ymap(o.lo) - this.ymap(o.hi)); this.label('OTE ' + o.dir.toUpperCase(), this.plotW - 70, this.ymap(o.hi) + 8, th.gold); this.edge(o.hi, 'OTE', th.gold); this.edge(o.lo, 'OTE', th.gold); }
      if (z.fvg) for (const f of ict.fvg) { const x = this.xOf(f.i) - bw / 2; g.fillStyle = f.dir === 'bull' ? 'rgba(38,166,154,.22)' : 'rgba(239,83,80,.22)'; g.fillRect(x, this.ymap(f.hi), this.plotW - x, Math.max(1, this.ymap(f.lo) - this.ymap(f.hi))); this.label('FVG', Math.max(x, 2) + 2, this.ymap(f.hi) + 8, f.dir === 'bull' ? th.up : th.dn); }
      if (z.ob) for (const o of ict.ob) { const x = this.xOf(o.i) - bw / 2; g.fillStyle = o.dir === 'bull' ? 'rgba(76,141,255,.22)' : 'rgba(230,120,60,.22)'; g.fillRect(x, this.ymap(o.hi), this.plotW - x, Math.max(1, this.ymap(o.lo) - this.ymap(o.hi))); g.strokeStyle = o.dir === 'bull' ? '#4c8dff' : '#e6783c'; g.strokeRect(x, this.ymap(o.hi), this.plotW - x, Math.max(1, this.ymap(o.lo) - this.ymap(o.hi))); this.label((o.dir === 'bull' ? 'Bull' : 'Bear') + ' OB', Math.max(x, 2) + 2, this.ymap(o.lo) - 7, o.dir === 'bull' ? '#4c8dff' : '#e6783c'); }
    }
    // candles / footprint
    const fp = st.chartType === 'footprint' && bw >= 46 && (!app.replay || app.replay.cur != null);
    this.fpActive = fp; if (fp) { app.fpWant((hi - lo) / (mh / 14)); app.fpEnsure(i0, i1); }
    if (st.ind.liq && !app.replay) this.drawLiq(g, th, c, lo, hi, mh, fp);
    { const P = { u: { w: new Path2D(), b: new Path2D(), col: th.cu }, d: { w: new Path2D(), b: new Path2D(), col: th.cd } };
    for (let i = i0; i <= i1; i++) {
      const b = c[i], x = this.xOf(i), up = b.c >= b.o;
      if (fp && app.drawFootprint(g, this, i, b, x, bw, th)) continue;
      const Q = up ? P.u : P.d, xr = Math.round(x) + .5; Q.w.moveTo(xr, this.ymap(b.h)); Q.w.lineTo(xr, this.ymap(b.l));
      const yo = this.ymap(b.o), yc = this.ymap(b.c), w = Math.max(1, bw * 0.7); Q.b.rect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yo - yc)));
    }
    const glow = st.candleGlow !== false;
    for (const Q of [P.d, P.u]) { g.strokeStyle = Q.col; g.fillStyle = Q.col; if (glow) { g.save(); g.globalAlpha = .2; g.lineWidth = 4; g.stroke(Q.w); g.lineWidth = 3; g.stroke(Q.b); g.restore(); } g.lineWidth = 1; g.stroke(Q.w); g.fill(Q.b); } }
    // overlays
    const ind = st.ind; const line = (arr, col, w = 1.3) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let s = false; for (let i = Math.max(0, i0 - 1); i <= Math.min(c.length - 1, i1 + 1); i++) { if (isNaN(arr[i])) { s = false; continue; } const x = this.xOf(i), y = this.ymap(arr[i]); if (!s) { g.moveTo(x, y); s = true; } else g.lineTo(x, y); } g.stroke(); };
    const lastB = c[c.length - 1]; const cacheKey = c.length + ':' + lastB.t + ':' + c[0].t + ':' + lastB.c + ':' + lastB.v;
    if (this.cache.key !== cacheKey) this.cache = { key: cacheKey };
    for (const n of [9, 21, 50, 200]) if (ind['ema' + n]) line(this.cache['e' + n] ||= ema(c, n), { 9: '#ffd54f', 21: '#ff9800', 50: '#4c8dff', 200: '#e040fb' }[n]);
    if (ind.vwap) line(this.cache.vw ||= vwap(c, app.tfMs()), '#00bcd4');
    if (ind.vwapBands) { const vb = this.cache.vb ||= vwapBands(c); line(vb.v, '#00bcd4', 1.6); g.setLineDash([5, 3]); line(vb.u1, '#4dd0e1', 1); line(vb.d1, '#4dd0e1', 1); g.setLineDash([2, 3]); line(vb.u2, '#80deea', 1); line(vb.d2, '#80deea', 1); g.setLineDash([]); }
    this.drawAVWAP(g, th, c, line, i0, i1);
    if (app.integ && app.integ.issues.size) for (let i = i0; i <= i1; i++) if (app.integ.issues.has(i)) { g.fillStyle = th.gold; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText('!', this.xOf(i), this.ymap(c[i].h) - 8); g.textAlign = 'left'; }
    // ICT lines
    if (ict && ind.ict) {
      if (z.liq) for (const l of ict.liq) { const x = this.xOf(l.i); this.seg(x, l.p, this.plotW, l.p, l.kind === 'BSL' ? th.dn : th.up, [5, 4]); this.label(l.kind, this.plotW - 34, this.ymap(l.p) - 7, l.kind === 'BSL' ? th.dn : th.up); this.edge(l.p, l.kind, l.kind === 'BSL' ? th.dn : th.up); }
      if (z.liq) for (const e of ict.eq) { this.seg(this.xOf(e.i1), e.p, this.xOf(e.i2), e.p, th.gold, [2, 2]); this.label(e.kind, (this.xOf(e.i1) + this.xOf(e.i2)) / 2 - 10, this.ymap(e.p) - 7, th.gold); }
      if (z.liq) for (const s of ict.sweeps) { const x = this.xOf(s.i); g.fillStyle = th.gold; g.beginPath(); const y = this.ymap(s.type === 'H' ? c[s.i].h : c[s.i].l) + (s.type === 'H' ? -6 : 6); g.arc(x, y, 3, 0, 7); g.fill(); }
      if (z.struct) {
        for (const s of ict.struct) { const col = s.dir === 'bull' ? th.up : th.dn; this.seg(this.xOf(s.i1), s.p, this.xOf(s.i2), s.p, col, [4, 3]); this.label(s.kind, (this.xOf(s.i1) + this.xOf(s.i2)) / 2 - 12, this.ymap(s.p) + (s.dir === 'bull' ? -8 : 9), col); }
        for (const s of ict.swings) { this.label(s.label, this.xOf(s.i) - 8, this.ymap(s.p) + (s.type === 'H' ? -9 : 10), s.label[1] === 'H' ? th.up : th.dn); }
      }
      if (z.sessions) for (const l of ict.levels) { this.hline(l.p, l.name, th.blue, [6, 3]); this.edge(l.p, l.name, th.blue); }
    }
    if (app.state.ind.wyckoff && app.state.ind.wySig && app.getWySigs) { for (const s of app.getWySigs()) { if (s.i < i0 - 1 || s.i > i1 + 1) continue; const b = c[s.i], x = this.xOf(s.i), up = s.dir === 'bull'; g.save(); g.fillStyle = up ? '#39ff9c' : '#ff4f6d'; g.beginPath(); const y = up ? this.ymap(b.l) + 6 : this.ymap(b.h) - 6; if (up) { g.moveTo(x, y); g.lineTo(x - 6, y + 11); g.lineTo(x + 6, y + 11); } else { g.moveTo(x, y); g.lineTo(x - 6, y - 11); g.lineTo(x + 6, y - 11); } g.fill(); g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(up ? 'WY BUY?' : 'WY SELL?', x, up ? y + 23 : y - 15); g.restore(); } }
    if (app.state.ind.wyckoff && app.getWy) { const W = app.getWy(); if (W && W.range) { const r = W.range, x1 = Math.max(0, this.xOf(r.s0)), x2 = this.plotW; const y1 = this.ymap(r.hi), y2 = this.ymap(r.lo); g.save(); g.fillStyle = 'rgba(180,140,255,.08)'; g.fillRect(x1, y1, x2 - x1, y2 - y1); g.strokeStyle = 'rgba(180,140,255,.8)'; g.setLineDash([5, 3]); g.strokeRect(x1, y1, x2 - x1, y2 - y1); g.setLineDash([]); g.restore(); this.label('WYCKOFF ' + ({ accumulation: 'ACC?', distribution: 'DIST?', undetermined: 'RANGE' }[r.kind]), x1 + 4, y1 + 12, '#b48cff'); if (W.ev) { const x = this.xOf(W.ev.i); this.label(W.ev.type === 'spring' ? 'SPRING' : 'UTAD', x - 14, this.ymap(W.ev.type === 'spring' ? r.lo : r.hi) + (W.ev.type === 'spring' ? 16 : -8), '#b48cff'); } } }
    if (app.goldSourceTag) { const gt = app.goldSourceTag(); if (gt) { g.save(); g.font = '600 10px sans-serif'; const w = Math.min(this.plotW - 8, g.measureText(gt).width + 12); g.fillStyle = 'rgba(15,19,28,.85)'; g.fillRect(8, 56, w, 16); g.strokeStyle = th.gold; g.strokeRect(8.5, 56.5, w - 1, 15); g.fillStyle = th.gold; g.textBaseline = 'middle'; g.fillText(gt, 14, 64.5); g.restore(); } }
    if (app.regimeTag) { const rt = app.regimeTag(); if (rt) { g.save(); g.font = '600 11px sans-serif'; const w = g.measureText(rt.text).width + 12; const x0 = 8, y0 = 34; g.fillStyle = 'rgba(15,19,28,.85)'; g.fillRect(x0, y0, w, 18); g.strokeStyle = rt.kind === 'trend' ? th.up : rt.kind === 'range' ? th.gold : th.blue; g.strokeRect(x0 + .5, y0 + .5, w - 1, 17); g.fillStyle = g.strokeStyle; g.textBaseline = 'middle'; g.fillText(rt.text, x0 + 6, y0 + 9); g.restore(); } }
    if (app.magnetLines) for (const l of app.magnetLines()) { this.hline(l.p, l.name, th.gold, [1, 5]); this.edge(l.p, l.name, th.gold); }
    const gp = app.goldLevels && app.goldLevels(); if (gp) {
      for (const l of gp.levels) { this.hline(l.p, l.name, th.gold, [2, 4]); this.edge(l.p, l.name, th.gold); }
      for (const e of gp.times) { const x = this.xOf(this.idxOfT(e.t)); if (x < 0 || x > this.plotW) continue; g.strokeStyle = th.gold; g.globalAlpha = .5; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, mh); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; g.save(); g.translate(x - 3, 70); g.rotate(-Math.PI / 2); g.fillStyle = th.gold; g.font = '9px system-ui'; g.textAlign = 'left'; g.fillText(e.name, 0, 0); g.restore(); }
    }
    this.drawings(g, th, c);
    this.alertLines(g, th); this.tradeLines(g, th);
    // last price
    const last = c[c.length - 1]; const ly = this.ymap(last.c);
    g.strokeStyle = last.c >= last.o ? th.up : th.dn; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, ly); g.lineTo(this.plotW, ly); g.stroke(); g.setLineDash([]);
    if (app.replay) { g.fillStyle = th.gold; g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.fillText('REPLAY', 8, mh - 12); }
    if (st.chartType === 'footprint' && !fp && !app.replay) { g.fillStyle = th.gold; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('Zoom in (scroll or pinch) to see footprint cells', 8, mh - 12); }
    if (st.chartType === 'footprint' && app.replay && app.replay.cur == null) { g.fillStyle = th.gold; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('Footprint needs tick data: not shown in candle-step replay. Switch step to 1 s / 5 s / 15 s', 8, mh - 12); }
    g.restore(); if (this.selLbl && this.app.state.beginner !== false) { const m = this.labels.find(l => l.txt === this.selLbl.txt && Math.abs(l.x - this.selLbl.x) < 60); if (m) { g.save(); g.strokeStyle = '#e6b84a'; g.lineWidth = 1.5; g.strokeRect(m.x - 3, m.y - 11, m.w + 4, 14); g.restore(); } }
    // axis tag for last price
    g.fillStyle = last.c >= last.o ? th.up : th.dn; g.fillRect(this.plotW, ly - 9, AXW, 18); g.fillStyle = '#fff'; g.font = 'bold 11px ui-monospace,Menlo,monospace'; g.textAlign = 'left'; g.fillText(fmtP(last.c, dec), this.plotW + 5, ly);
    if (app.state.ind.bubbles) { app.loadBubbles(); const B = app.bub; this.bubHits = []; if (B && B.key === app.state.symbol) { const vis = []; const base = app.state.symbol.replace(/USDT$/, ''); for (const x of B.big) { let lo = 0, hi = c.length - 1; if (x.t < c[0].t) continue; while (lo < hi) { const md = (lo + hi + 1) >> 1; if (c[md].t <= x.t) lo = md; else hi = md - 1; } if (lo < i0 - 1 || lo > i1 + 1) continue; const px = this.xOf(lo), py = this.ymap(x.p), r = Math.max(4, Math.min(22, 4 + 18 * Math.sqrt(x.q / B.max))); g.save(); g.globalAlpha = .45; g.fillStyle = x.side === 'buy' ? '#26a69a' : '#ef5350'; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.globalAlpha = .95; g.strokeStyle = g.fillStyle; g.lineWidth = 1.2; g.stroke(); g.restore(); vis.push(x); this.bubHits.push({ x: px, y: py, r, b: x }); }
      const sum = { buy: [0, 0, 0], sell: [0, 0, 0] }; for (const x of vis) { const k = sum[x.side]; k[0]++; k[1] += x.q; k[2] += x.q * x.p; }
      const kf = v => v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0), qf = v => v >= 100 ? v.toFixed(1) : v.toFixed(3), tf = t => new Date(t).toTimeString().slice(0, 8);
      g.save(); g.font = 'bold 10px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const lab = []; for (const h of this.bubHits.slice().sort((a, b) => b.b.q - a.b.q)) { if (lab.length >= 3) break; if (lab.some(l => Math.abs(l.y - h.y) < 13)) continue; lab.push(h); const x = h.b, tx = qf(x.q) + ' ' + base + ' · $' + kf(x.q * x.p); g.fillStyle = '#fff'; g.fillText(tx, Math.min(this.plotW - g.measureText(tx).width - 2, Math.max(2, h.x + h.r + 3)), h.y + 3); }
      if (this.selBub) { const h = this.bubHits.find(z => z.b.id === this.selBub); if (h) { const x = h.b, L = [(x.side === 'buy' ? 'BUY (taker)' : 'SELL (taker)') + ' · ' + tf(x.t), 'Size ' + x.q + ' ' + base, 'Notional $' + (x.q * x.p).toLocaleString('en-US', { maximumFractionDigits: 0 }), 'Price ' + x.p]; const w = 150, hh = 14 * L.length + 8; let bx = Math.min(this.plotW - w - 2, Math.max(2, h.x - w / 2)), by = h.y - h.r - hh - 4; if (by < 20) by = h.y + h.r + 4; g.fillStyle = 'rgba(8,14,24,.95)'; g.fillRect(bx, by, w, hh); g.strokeStyle = x.side === 'buy' ? '#39ff9c' : '#ff6b6b'; g.lineWidth = 1.2; g.strokeRect(bx, by, w, hh); g.fillStyle = '#eaf2ff'; L.forEach((l, k) => g.fillText(l, bx + 6, by + 14 + 14 * k - 3)); } }
      g.fillStyle = '#39ff9c'; g.fillText('Big BUY ' + sum.buy[0] + ' · ' + qf(sum.buy[1]) + ' ' + base + ' · $' + kf(sum.buy[2]), 6, this.H - 36); g.fillStyle = '#ff6b6b'; g.fillText('Big SELL ' + sum.sell[0] + ' · ' + qf(sum.sell[1]) + ' ' + base + ' · $' + kf(sum.sell[2]), 6, this.H - 48);
      g.fillStyle = '#b0bec5'; g.font = '10px sans-serif'; g.fillText('PARTIAL: top 1% of last ' + B.n + ' trades (≥' + B.thr + ') since ' + new Date(B.t0).toTimeString().slice(0, 5) + ' · tap bubble', 6, this.H - 24); g.restore(); } else { g.save(); g.fillStyle = '#b0bec5'; g.font = '10px sans-serif'; g.fillText('BUBBLES: loading trades…', 6, this.H - 24); g.restore(); } }
    if (app.state.ind.ibor && app.tfMs() <= 15 * 60e3) { const lc = c[c.length - 1], key = c.length + ':' + lc.t + ':' + lc.c; if (this.ibK !== key) { this.ibK = key; this.ib = ibor(c, app.tfMs()); } for (const s of this.ib || []) { if (s.i1 < i0 - 2 || s.i0 > i1 + 2) continue; const x1 = this.xOf(s.i0), x2 = Math.min(this.plotW, this.xOf(s.i1) + 6); const col = s.name === 'NY' ? '#ffb74d' : '#4fc3f7'; g.save(); g.fillStyle = col; g.globalAlpha = .07; g.fillRect(x1, this.ymap(s.ibHi), x2 - x1, this.ymap(s.ibLo) - this.ymap(s.ibHi)); g.globalAlpha = .9; g.strokeStyle = col; g.lineWidth = 1; g.setLineDash(s.ibDone ? [] : [3, 3]); for (const p of [s.ibHi, s.ibLo]) { g.beginPath(); g.moveTo(x1, this.ymap(p)); g.lineTo(x2, this.ymap(p)); g.stroke(); } g.setLineDash([1, 3]); for (const p of [s.orHi, s.orLo]) { g.beginPath(); g.moveTo(x1, this.ymap(p)); g.lineTo(x1 + (x2 - x1) * .6, this.ymap(p)); g.stroke(); } g.restore(); this.label(s.name + ' IB' + (s.ibDone ? '' : '...'), x1 + 3, this.ymap(s.ibHi) - 4, col); if (s.brk) { const bx = this.xOf(s.brk.i); this.label(s.brk.dir === 'up' ? 'IB BRK▲' : 'IB BRK▼', bx - 14, this.ymap(s.brk.lvl) + (s.brk.dir === 'up' ? -12 : 20), col); } if (s.retest) { this.label(s.retest.held ? 'RT held' : 'RT failed', this.xOf(s.retest.i) - 12, this.ymap(s.brk.lvl) + (s.brk.dir === 'up' ? 22 : -14), s.retest.held ? th.up : th.dn); } } }
    if (app.state.ind.cvdDiv) { const lc = c[c.length - 1], key = c.length + ':' + lc.t + ':' + Math.round(c[c.length - 4].d * 1e3); if (this.dvK !== key) { this.dvK = key; this.dv = cvdDivergence(c); } for (const d of this.dv) { if (d.i2 < i0 - 2 || d.i1 > i1 + 2) continue; const bear = d.type === 'bear', col = bear ? th.dn : th.up; this.seg(this.xOf(d.i1), d.p1, this.xOf(d.i2), d.p2, col, [3, 3]); this.label(bear ? 'DIV▼' : 'DIV▲', this.xOf(d.i2) - 12, this.ymap(d.p2) + (bear ? -18 : 20), col); } }
    if (app.state.ind.flowsig !== false && !app.replay) { const lc = c[c.length - 1], key = c.length + ':' + Math.round(lc.v * 1e3) + ':' + lc.c + ':' + (app.ict ? app.ict.sweeps.length + ':' + app.ict.ob.length + ':' + app.ict.fvg.length : 0) + ':' + (app.state.ind.absGate ? 1 : 0) + ':' + (app.ict ? 1 : 0); if (this.fsK !== key) { this.fsK = key; this.fsig = detectFlow(c, app.ict); if (app.state.ind.absGate) this.fsig = gateAbs(this.fsig, c, app.zoneIct(), app.levels); } g.save(); g.beginPath(); g.rect(0, 0, this.plotW, this.H); g.clip(); g.font = 'bold 9px system-ui'; g.textAlign = 'center'; const col = { ABS: '#e6b84a', EXH: '#c792ea', RUN: '#ff9e64' };
    for (const s of this.fsig) { if (s.i < i0 - 1 || s.i > i1 + 1) continue; const b = c[s.i], x = this.xOf(s.i), up = s.dir === 'bull', y = up ? this.ymap(b.l) + 12 + (s.kind === 'EXH' ? 10 : s.kind === 'RUN' ? 20 : 0) : this.ymap(b.h) - 6 - (s.kind === 'EXH' ? 10 : s.kind === 'RUN' ? 20 : 0); g.fillStyle = col[s.kind]; g.fillText(s.kind + (up ? '↑' : '↓') + (s.zone ? ' @' + s.zone : ''), x, y); } g.restore(); }
    if ((app.state.ind.absorb || app.state.ind.dDiv) && !app.replay && c.length > 40) {
      const lc = c[c.length - 1], key = c.length + ':' + lc.t + ':' + (Date.now() > lc.t + app.tfMs() ? 1 : 0) + ':' + app.state.symbol;
      if (this.f2K !== key) { this.f2K = key; this.f2a = absorption(c); this.f2d = deltaDiv(c); }
      g.save(); g.beginPath(); g.rect(0, 0, this.plotW, this.H); g.clip(); g.textAlign = 'center'; this.f2hits = [];
      if (app.state.ind.absorb) for (const s of this.f2a) { if (s.i < i0 - 1 || s.i > i1 + 1) continue; const b = c[s.i], x = this.xOf(s.i), up = s.dir === 'bull', y = up ? this.ymap(b.l) + 14 : this.ymap(b.h) - 14; g.fillStyle = '#b061ff'; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 9px system-ui'; g.fillText('A', x, y + 3); this.f2hits.push({ x, y, k: 'abs', s }); }
      if (app.state.ind.dDiv) for (const s of this.f2d) { if (s.i < i0 - 2 || s.i1 > i1 + 2) continue; const bear = s.type === 'bear', col = bear ? th.dn : th.up, x = this.xOf(s.i), y = bear ? this.ymap(s.p2) - 16 : this.ymap(s.p2) + 16, d = bear ? 1 : -1; this.seg(this.xOf(s.i1), s.p1, x, s.p2, col, [2, 3]); g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 9 * d); g.lineTo(x - 8, y - 6 * d); g.lineTo(x + 8, y - 6 * d); g.closePath(); g.fill(); g.stroke(); this.f2hits.push({ x, y, k: 'dd', s }); }
      g.restore();
    }
    if (app.state.ind.bwg && !app.replay && c.length > 120) { // Black Wolf Gold score >= 55, closed candles only
      const lc = c[c.length - 1], key = c.length + ':' + lc.t + ':' + (Date.now() > lc.t + app.tfMs() ? 1 : 0) + ':' + app.state.symbol + app.state.tf;
      if (this.bwK !== key) { this.bwK = key; this.bw = goldSignals(c, app.tfMs(), app.state.tf, 55).sig; }
      g.save(); g.beginPath(); g.rect(0, 0, this.plotW, this.H); g.clip(); g.textAlign = 'center';
      for (const s of this.bw) { if (s.i < i0 - 1 || s.i > i1 + 1) continue; const b = c[s.i], x = this.xOf(s.i), up = s.dir === 'bull', y = up ? this.ymap(b.l) + 22 : this.ymap(b.h) - 22; g.fillStyle = up ? '#1fbf75' : '#e5484d'; g.strokeStyle = '#ffd34a'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x - 15, y - 9, 30, 18, 5); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 10px system-ui'; g.fillText((up ? 'B ' : 'S ') + s.score, x, y + 3.5); }
      g.restore();
    }
    if (app.state.ind.wsk) this.drawSK(g, c, th, i0, i1);
    if (app.state.ind.vp && app.vp && !app.replay) { const V = app.vp, mw = this.plotW * 0.26; g.save(); g.beginPath(); g.rect(0, 0, this.plotW, this.H); g.clip(); for (let i = 0; i < V.rows; i++) { const y1 = this.ymap(V.lo + (i + 1) * V.step), y0 = this.ymap(V.lo + i * V.step); const w = V.v[i] / V.max * mw; g.fillStyle = i >= V.a && i <= V.b ? 'rgba(88,166,255,.38)' : 'rgba(150,160,180,.22)'; if (i === V.pocI) g.fillStyle = 'rgba(240,185,11,.6)'; g.fillRect(this.plotW - w, y1 + .5, w, Math.max(1, y0 - y1 - 1)); }
      const ln = (p, col, lab, dash) => { const y = Math.round(this.ymap(p)) + .5; g.strokeStyle = col; g.lineWidth = 1; g.setLineDash(dash); g.beginPath(); g.moveTo(this.plotW - mw - 40, y); g.lineTo(this.plotW, y); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(lab + ' ' + fmtP(p, dec), this.plotW - mw - 40, y - 3); };
      ln(V.poc, '#f0b90b', 'POC', []); ln(V.vah, '#58a6ff', 'VAH', [4, 3]); ln(V.val, '#58a6ff', 'VAL', [4, 3]); g.fillStyle = th.text; g.font = '9px system-ui'; g.textAlign = 'right'; g.fillText('VP ' + V.label + ' · approx', this.plotW - 4, this.H - 36); g.restore(); }
    if (app.state.countdown !== false && !app.replay && c.length) { const lc = c[c.length - 1], sk = app.feed.skew || 0, left = Math.max(0, lc.t + app.tfMs() - (Date.now() - sk)); const s = Math.floor(left / 1000), dd = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60, p2 = n => String(n).padStart(2, '0'); const txt = dd ? dd + 'd ' + p2(hh) + ':' + p2(mm) : hh ? p2(hh) + ':' + p2(mm) + ':' + p2(ss) : p2(mm) + ':' + p2(ss); const warn = left < 10000; g.fillStyle = warn ? th.gold : th.panel2 || '#1e2430'; g.fillRect(this.plotW, ly + 9, AXW, 16); g.fillStyle = warn ? '#000' : th.text; g.font = '11px ui-monospace,Menlo,monospace'; g.textAlign = 'left'; g.fillText(txt, this.plotW + 5, ly + 17); }
    this.drawSubs(g, th, c, lay, i0, i1);
    this.drawCross(g, th, c, lay);
    app.onDraw && app.onDraw();
  }
  drawLiq(g, th, c, lo, hi, mh, fpOn) {
    const L = this.app.liq, S = L.snaps; if (S.length < 2) return; const tf = this.app.tfMs(), bw = this.view.barW, now = Date.now();
    const xT = t => this.xOf((t - c[0].t) / tf); const bin = L.bin; if (!bin) return;
    const key = [S.length, S[S.length - 1].t, lo.toFixed(4), hi.toFixed(4), bw.toFixed(3), this.view.right.toFixed(3), this.plotW, mh, c[0].t, tf, this.app.state.theme].join('|');
    if (this._heatKey !== key) {
      this._heatKey = key; const oc = this._heat && this._heat.width === this.cv.width && this._heat.height === this.cv.height ? this._heat : (this._heat = document.createElement('canvas')); oc.width = this.cv.width; oc.height = this.cv.height;
      const r = devicePixelRatio || 1, h = oc.getContext('2d'); h.setTransform(r, 0, 0, r, 0, 0); h.clearRect(0, 0, this.W, this.H);
      const stride = Math.max(1, Math.floor(S.length / 320));
      for (let n = 0; n < S.length; n += stride) {
        const s0 = S[n], s1 = S[Math.min(S.length - 1, n + stride)], x1 = xT(s0.t), x2 = Math.max(x1 + 1, xT(s1.t === s0.t ? s0.t + 2000 : s1.t)); if (x2 < 0 || x1 > this.plotW) continue; const ref = s0.big * 3;
        for (const [side, arr] of [['b', s0.B], ['a', s0.A]]) for (const [k, q] of arr) {
          const p1 = (k + 1) * bin, p0 = k * bin; if (p1 < lo || p0 > hi) continue; const a = Math.min(1, Math.pow(q / ref, 0.6)); if (a < 0.06) continue;
          const y1 = this.ymap(p1), y2 = this.ymap(p0); h.fillStyle = a > 0.8 ? `rgba(255,214,90,${0.55})` : side === 'b' ? `rgba(38,166,154,${(a * 0.5).toFixed(3)})` : `rgba(239,120,80,${(a * 0.5).toFixed(3)})`; h.fillRect(x1, y1, x2 - x1 + 0.5, Math.max(1, y2 - y1));
        }
      }
    }
    if (!fpOn) g.drawImage(this._heat, 0, 0, this.W, this.H);
    // pulled-wall ghosts: fade with age
    let shown = 0; for (const e of L.events.slice().reverse()) { if (shown >= 5) break; const al = L.ghostAlpha(e, now); if (al < 0.05 || e.kind !== 'pulled' || e.p < lo || e.p > hi) continue; shown++; const x = xT(e.t), y = this.ymap(e.p); g.globalAlpha = al; g.strokeStyle = e.side === 'b' ? th.up : th.dn; g.setLineDash([3, 3]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - 40, y); g.lineTo(Math.min(this.plotW, x + 60 + (now - e.t) * 0), y); g.stroke(); g.setLineDash([]); g.fillStyle = th.gold; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); g.fill(); g.font = '9px system-ui'; g.textAlign = 'left'; g.fillText('PULLED ' + fmtV(e.qty), x + 7, y - 6); g.globalAlpha = 1; }
  }
  drawAVWAP(g, th, c, line, i0, i1) {
    const app = this.app, st = app.state, list = []; const user = st.avwaps[st.symbol] || [];
    for (const a of user) { const i = idxAtOrAfter(c, a.t); if (i >= 0) list.push({ i, name: 'AVWAP', col: '#ba68c8', t: a.t }); }
    const ict = app.ict; if (st.ind.avwapAuto && ict && st.ind.ict) { if (ict.lastH) list.push({ i: ict.lastH.i, name: 'AVWAP H', col: '#ff9800', t: c[ict.lastH.i].t }); if (ict.lastL) list.push({ i: ict.lastL.i, name: 'AVWAP L', col: '#4c8dff', t: c[ict.lastL.i].t }); }
    for (const a of list) {
      const key = 'av' + a.t; const av = this.cache[key] ||= avwap(c, a.i); line(av.v, a.col, 1.6);
      g.globalAlpha = .45; g.setLineDash([2, 3]); line(av.up, a.col, 1); line(av.dn, a.col, 1); g.setLineDash([]); g.globalAlpha = 1;
      const x = this.xOf(a.i); const v = av.v[a.i]; if (isFinite(v)) { g.fillStyle = a.col; g.beginPath(); g.arc(x, this.ymap(v), 3.5, 0, 7); g.fill(); }
      const lastV = av.v[c.length - 1]; if (isFinite(lastV)) this.label(a.name + ' ' + fmtP(lastV, this.dec), this.plotW - 100, this.ymap(lastV) - 6, a.col);
    }
  }
  drawSK(g, c, th, i0, i1) {
    const app = this.app, k = app.state.sk ||= { htf: 'H4', e1: true, e2: true, max: 4 }, tf = app.tfMs(), sym = app.state.symbol, gold = /PAXG|XAU/.test(sym), lc = c[c.length - 1];
    const key = c.length + ':' + lc.t + ':' + k.htf + sym + app.state.tf + (Date.now() > lc.t + tf ? 1 : 0);
    if (this.skK !== key) { this.skK = key; app.wskRes = this.sk = (tf <= 1800e3 && 1800e3 % tf === 0) ? computeSK(c, tf, { hp: k.htf === 'H2' ? 7200e3 : 14400e3, stopFix: gold ? 2.0 : 0 }, app.replay ? (app.replay.cur != null ? lc.t : lc.t + tf) : Date.now()) : { err: 'tf' }; }
    const R = this.sk; g.save(); g.beginPath(); g.rect(0, 0, this.plotW, this.H); g.clip();
    const ar = isArLocal(); const msg = !R ? '' : R.err === 'tf' ? (ar ? 'Wolf SK: محتاج شارت 30 دقيقة أو أقل' : 'Wolf SK needs a 30m or lower chart') : R.err ? (ar ? 'Wolf SK: داتا مش كفاية (اسحب الشارت لورا)' : 'Wolf SK: not enough data (scroll back)') : '';
    if (msg) { g.fillStyle = th.text; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText(msg, 8, this.H - 50); g.restore(); return; }
    const X = t => this.xOf(this.idxOfT(t)), Y = p => this.ymap(p), now = this.plotW, dp = (lc.c < 100 ? 4 : 2);
    const live = R.seqs.filter(q => q.status === 'FORMING' || q.status === 'ACTIVE' || q.status === 'E2'), rest = R.seqs.filter(q => !live.includes(q)), show = live.slice(-k.max).concat(rest.slice(-Math.max(0, k.max - live.length)));
    const pt = (p, txt, col, above) => { const x = X(p.t), y = Y(p.p); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillStyle = col; g.fillText(txt, x, y + (above ? -8 : 15)); };
    const stCol = { FORMING: '#00f0ff', ACTIVE: '#4c8dff', E2: '#b061ff', INVALID: '#888', EXPIRED: '#888', DONE: '#888' }, stAr = { FORMING: 'بيتكوّن', ACTIVE: 'نشط', E2: 'دخول E2', INVALID: 'ملغي', EXPIRED: 'انتهى', DONE: 'خلص' };
    for (const S of show) {
      const dead = !(S.status === 'FORMING' || S.status === 'ACTIVE' || S.status === 'E2'), al = dead ? 0.45 : 1, up = S.d > 0, endT = S.endT || null, xe = endT ? Math.min(now, X(endT)) : now, x0 = X(S.m0t);
      if (xe < 0 && X(S.a.t) < 0) continue; g.globalAlpha = al; const col = up ? '#00f0ff' : '#ff9f43';
      if (k.e1 && (S.status === 'FORMING' || S.fills.some(f => f.mode === 'E1'))) { const z1 = S.a.p - 0.5 * (S.a.p - S.o.p), z2 = S.a.p - 0.667 * (S.a.p - S.o.p), xr = S.aBreakT ? X(S.aBreakT) : xe; if (k.e1) { g.fillStyle = up ? 'rgba(0,240,255,.16)' : 'rgba(255,159,67,.16)'; g.fillRect(x0, Math.min(Y(z1), Y(z2)), Math.max(2, xr - x0), Math.abs(Y(z2) - Y(z1))); g.font = '9px system-ui'; g.textAlign = 'left'; g.fillStyle = col; g.fillText('E1 0.5-0.667', Math.max(4, x0) + 2, (Y(z1) + Y(z2)) / 2 + 3); } }
      g.lineWidth = 1.6; this.seg(X(S.o.t), S.o.p, X(S.a.t), S.a.p, col, []); if (S.b) this.seg(X(S.a.t), S.a.p, X(S.b.t), S.b.p, col, [4, 3]); if (S.b && (S.cc || S.cp)) { const C = S.cc || S.cp; this.seg(X(S.b.t), S.b.p, X(C.t), C.p, col, [4, 3]); }
      pt(S.o, '0', col, !up); pt(S.a, 'A', col, up); if (S.b) pt(S.b, 'B', col, !up); if (S.cc) pt(S.cc, 'C', col, up); else if (S.cp) pt(S.cp, 'C?', col, up);
      // 0 invalidation line and status badge
      this.seg(x0, S.o.p, xe, S.o.p, 'rgba(229,72,77,.6)', [2, 4]); g.font = '9px system-ui'; g.textAlign = 'left'; g.fillStyle = 'rgba(229,72,77,.9)'; g.fillText(ar ? 'إلغاء (0)' : 'invalid below 0', Math.max(4, x0 + 2), Y(S.o.p) + (up ? 10 : -3));
      const bx = Math.max(4, Math.min(this.plotW - 120, X(S.a.t) + 6)), by = Y(S.a.p) + (up ? -22 : 24), t = 'SK ' + (up ? '▲' : '▼') + ' ' + (ar ? stAr[S.status] : S.status);
      g.font = 'bold 10px system-ui'; const w = g.measureText(t).width + 10; g.fillStyle = stCol[S.status]; g.beginPath(); g.roundRect(bx, by - 10, w, 15, 4); g.fill(); g.fillStyle = '#000'; g.textAlign = 'left'; g.fillText(t, bx + 5, by + 1);
      if (S.b && k.e2 && (S.cc)) { const cp = S.cc.p, b = S.b.p, z1 = cp - 0.5 * (cp - b), z2 = cp - 0.667 * (cp - b), xs = X(S.cc.t); g.fillStyle = 'rgba(176,97,255,.16)'; g.fillRect(xs, Math.min(Y(z1), Y(z2)), Math.max(2, xe - xs), Math.abs(Y(z2) - Y(z1))); g.fillStyle = '#b061ff'; g.font = '9px system-ui'; g.fillText('E2 0.5-0.667', Math.max(4, xs) + 2, (Y(z1) + Y(z2)) / 2 + 3); }
      if (S.b && S.status !== 'INVALID') { const ty = [[S.b.p + S.d * 1.618 * Math.abs(S.a.p - S.o.p), '161.8%'], [S.b.p + S.d * 2 * Math.abs(S.a.p - S.o.p), '200%']]; for (const [p, tx] of ty) { this.seg(X(S.a.t), p, xe, p, '#ff9f43', [6, 3]); g.fillStyle = '#ff9f43'; g.font = '9px system-ui'; g.textAlign = 'right'; g.fillText('TP ' + tx + ' ' + p.toFixed(2), xe - 3, Y(p) - 3); } }
      for (const q of S.pend) { if (!(k.e1 && S.status === 'FORMING') && !(k.e2 && S.status === 'E2')) continue; const xs = S.status === 'E2' ? X(S.cc.t) : x0; this.seg(xs, q.pr, now, q.pr, up ? '#00f0ff' : '#ff9f43', [3, 3]); g.fillStyle = up ? '#00f0ff' : '#ff9f43'; g.font = '9px system-ui'; g.textAlign = 'right'; g.fillText((S.status === 'E2' ? 'E2 ' : 'E1 ') + q.f + (up ? ' BUY ' : ' SELL ') + q.pr.toFixed(dp), now - 3, Y(q.pr) - 3); }
      for (const f of S.fills) { if ((f.mode === 'E1' && !k.e1) || (f.mode === 'E2' && !k.e2)) continue; const x = X(f.t), xo = Math.min(now, X(f.tEnd)), y = Y(f.pr); g.globalAlpha = 1; this.seg(x, f.sl, xo, f.sl, '#e5484d', [3, 3]); this.seg(x, f.t3, xo, f.t3, '#1fbf75', [3, 3]); this.seg(x, f.pr, xo, f.pr, up ? '#00f0ff' : '#ff9f43', []);
        g.fillStyle = f.d === undefined && !up ? '#e5484d' : (up ? '#1fbf75' : '#e5484d'); g.beginPath(); if (up) { g.moveTo(x, y - 2); g.lineTo(x - 6, y + 9); g.lineTo(x + 6, y + 9); } else { g.moveTo(x, y + 2); g.lineTo(x - 6, y - 9); g.lineTo(x + 6, y - 9); } g.closePath(); g.fill(); const bw30 = Math.max(3, this.view.barW * (1800e3 / tf)); if (x > -bw30 && x < this.plotW + bw30) { g.fillStyle = up ? 'rgba(31,191,117,.16)' : 'rgba(229,72,77,.16)'; g.fillRect(x - bw30 / 2, 0, bw30, this.H); const tx = 'SIGNAL ' + (up ? 'BUY ' : 'SELL ') + f.mode + ' ' + f.f + ' @' + f.pr.toFixed(dp); g.font = 'bold 10px system-ui'; const tw = g.measureText(tx).width + 10, bx2 = Math.min(this.plotW - tw - 2, Math.max(2, x - tw / 2)), by2 = y + (up ? 26 : -26); g.fillStyle = up ? '#1fbf75' : '#e5484d'; g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.roundRect(bx2, by2 - 10, tw, 16, 5); g.fill(); g.stroke(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(tx, bx2 + 5, by2 + 2); g.textAlign = 'center'; } if (xo > 0 && xo < this.plotW) { g.fillStyle = f.out === 'SL' ? '#e5484d' : f.out === 'T3R' ? '#1fbf75' : th.text; g.fillText(f.out === 'SL' ? 'SL ' + f.sl.toFixed(dp) + ' (-1R)' : f.out === 'T3R' ? 'TP ' + f.t3.toFixed(dp) + ' (+3R)' : f.out === 'OPEN' ? 'open · SL ' + f.sl.toFixed(dp) + ' · TP ' + f.t3.toFixed(dp) : f.r.toFixed(1) + 'R', Math.min(this.plotW - 60, Math.max(60, xo)), Y(f.out === 'SL' ? f.sl : f.t3) + (f.out === 'SL' ? (up ? 11 : -4) : (up ? -4 : 11))); } }
      g.globalAlpha = 1;
    }
    const L = live[live.length - 1];
    if (L && L.pend.length) { const up = L.d > 0, rows = L.pend.map(q => { const tp = q.pr + L.d * 3 * q.sd, sl = q.pr - L.d * q.sd; return (up ? 'BUY LIMIT ' : 'SELL LIMIT ') + q.pr.toFixed(dp) + '  SL ' + sl.toFixed(dp) + '  TP ' + tp.toFixed(dp); });
      const lg = Math.abs(L.a.p - L.o.p), ext = L.status === 'E2' && L.b ? 'TP2 161.8%: ' + (L.b.p + L.d * 1.618 * lg).toFixed(dp) + ' · 200%: ' + (L.b.p + L.d * 2 * lg).toFixed(dp) : 'TP2 = entry ' + (up ? '+' : '-') + (1.618 * lg).toFixed(dp) + ' (161.8% of 0-A)';
      const hd = (L.status === 'E2' ? 'E2 ' : 'E1 ') + (ar ? 'أوامر معلقة (دخول / ستوب / هدف 3R)' : 'pending orders (entry / stop / 3R target)'), lines = [hd].concat(rows, [ext]), ph = lines.length * 12 + 6; g.font = '10px ui-monospace,monospace'; const pw = Math.min(this.plotW - 8, Math.max(...lines.map(s => g.measureText(s).width)) + 12), py = this.H - 58 - ph;
      g.fillStyle = 'rgba(8,12,20,.82)'; g.strokeStyle = '#00f0ff'; g.lineWidth = 1; g.beginPath(); g.roundRect(4, py, pw, ph, 5); g.fill(); g.stroke(); g.textAlign = 'left'; lines.forEach((s, i) => { g.fillStyle = i === 0 ? '#00f0ff' : i === lines.length - 1 ? '#ff9f43' : th.text; g.fillText(s, 10, py + 14 + i * 12); }); }
    g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.fillStyle = th.text; g.fillText('Wolf SK ' + k.htf + '/M30 · ' + (L ? (L.d > 0 ? '▲ ' : '▼ ') + (ar ? stAr[L.status] : L.status) : (ar ? 'مفيش تسلسل شغال' : 'no live sequence')) + (ar ? ' · بقواعد، مفيش ميزة مثبتة' : ' · rule-based, no proven edge'), 8, this.H - 50);
    g.restore();
  }
  label(txt, x, y, col) { // collision-avoiding label
    const g = this.ctx; g.font = '10px system-ui'; const w = g.measureText(txt).width + 4;
    for (let t = 0; t < 4; t++) { const r = { x, y: y - t * 11, w, h: 11 }; if (!this.labels.some(o => Math.abs(o.x - r.x) < (o.w + r.w) / 2 + 2 && Math.abs(o.y - r.y) < 11)) { r.txt = txt; this.labels.push(r); g.fillStyle = col; g.textAlign = 'left'; g.fillText(txt, r.x, r.y); return; } }
  }
  seg(x1, p1, x2, p2, col, dash) { const g = this.ctx; g.strokeStyle = col; g.lineWidth = 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x1, this.ymap(p1)); g.lineTo(x2, this.ymap(p2)); g.stroke(); g.setLineDash([]); }
  hline(p, txt, col, dash) { this.seg(0, p, this.plotW, p, col, dash); if (txt) this.label(txt, 4, this.ymap(p) - 7, col); }
  edge(p, txt, col) { // tag when level is off-screen so it never silently disappears
    const [lo, hi] = this.rg; const g = this.ctx, mh = this.lay.mainH; if (p >= lo && p <= hi) return;
    const up = p > hi; const y = up ? 9 : mh - 9; const key = txt + p; this.edgeN = (this.edgeN || 0);
    g.fillStyle = col; g.globalAlpha = .9; g.font = '10px system-ui'; g.textAlign = 'right';
    const off = (this.edgeSlot[up ? 'u' : 'd']++) * 12; g.fillText((up ? '▲ ' : '▼ ') + txt + ' ' + fmtP(p, this.dec), this.plotW - 4, up ? y + off : y - off); g.globalAlpha = 1;
  }
  drawTimeAxis(i0, i1, lay) {
    const g = this.ctx, th = this.th, c = this.c, tf = this.app.tfMs(); const y = this.H - AXH / 2; const utc = this.app.state.tz === 'UTC';
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: utc ? 'UTC' : undefined, hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', hourCycle: 'h23' });
    const parts = t => { const o = {}; for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value; return o; };
    g.fillStyle = th.text; g.font = '11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const every = Math.max(1, Math.round(90 / this.view.barW)); let prevDay = null;
    const target = Math.max(1, Math.ceil(90 / this.view.barW)); // bars between labels
    const stepBars = [1, 2, 3, 5, 10, 15, 30, 60, 120, 240, 480].find(s => s >= target) || 480;
    for (let i = Math.max(0, i0 - 1); i <= i1 + 1; i++) {
      if (!c[i]) continue; const p = parts(c[i].t); const newDay = p.day + p.month !== prevDay; 
      if (i % stepBars !== 0 && !(newDay && tf < 864e5 && prevDay !== null && false)) { prevDay = p.day + p.month; continue; }
      const x = this.xOf(i); if (x < 10 || x > this.plotW - 10) { prevDay = p.day + p.month; continue; }
      g.fillStyle = th.text; const txt = tf >= 864e5 ? `${p.day} ${p.month}` : (p.hour === '00' && p.minute === '00' ? `${p.day} ${p.month}` : `${p.hour}:${p.minute}`);
      if (txt.includes(' ')) { g.fillStyle = th.ax; g.font = 'bold 11px system-ui'; } else g.font = '11px system-ui';
      g.fillText(txt, x, y); prevDay = p.day + p.month;
    }
    g.textAlign = 'right'; g.fillStyle = th.text; g.fillText(utc ? 'UTC' : 'UTC' + (-new Date().getTimezoneOffset() / 60 >= 0 ? '+' : '') + (-new Date().getTimezoneOffset() / 60), this.W - 6, y);
    g.textAlign = 'left';
  }
  drawSubs(g, th, c, lay, i0, i1) {
    const app = this.app;
    for (const k of lay.subs) {
      const top = lay.subTop(k), h = SUBH; g.save(); g.beginPath(); g.rect(0, top, this.plotW, h); g.clip();
      g.fillStyle = th.panel; g.fillRect(0, top, this.plotW, h); g.strokeStyle = th.grid; g.beginPath(); g.moveTo(0, top + .5); g.lineTo(this.W, top + .5); g.stroke();
      let vals; const bw = this.view.barW;
      if (k === 'scvd') { const sc = this.cache.scvd ||= (sessionCVD(c, app.tfMs()) || { none: 1 }); vals = sc.none ? c.map(() => NaN) : sc.v; if (sc.none) { g.fillStyle = th.text; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('Session CVD needs a 1h or lower timeframe', 8, top + 46); } else { g.strokeStyle = th.grid; g.setLineDash([2, 3]); g.fillStyle = th.text; g.font = '9px system-ui'; g.textAlign = 'left'; for (const st2 of sc.starts) { if (st2.i < i0 - 1 || st2.i > i1 + 1) continue; const x2 = this.xOf(st2.i) - bw / 2; g.beginPath(); g.moveTo(x2, top); g.lineTo(x2, top + h); g.stroke(); g.fillText(st2.name, x2 + 3, top + h - 6); } g.setLineDash([]); } }
      else if (k === 'delta') vals = c.map(b => b.d); else if (k === 'cvd') { vals = this.cache.cvd ||= (() => { let s = 0; return c.map(b => (s += b.d)); })(); } else vals = this.cache.rsi ||= rsi(c);
      let mn = Infinity, mx = -Infinity; for (let i = i0; i <= i1; i++) { const v = vals[i]; if (isNaN(v)) continue; mn = Math.min(mn, v); mx = Math.max(mx, v); }
      if (!isFinite(mn) || !isFinite(mx)) { mn = 0; mx = 0; }
      if (k === 'delta') { const m = Math.max(Math.abs(mn), Math.abs(mx)) || 1; mn = -m; mx = m; } else if (k === 'rsi') { mn = 0; mx = 100; } else { if (!isFinite(mn)) { mn = 0; mx = 1; } const pd = (mx - mn) * .1 || 1; mn -= pd; mx += pd; }
      const y = v => top + 14 + (1 - (v - mn) / (mx - mn)) * (h - 22);
      if (k === 'delta') {
        g.strokeStyle = th.grid; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(this.plotW, y(0)); g.stroke();
        for (let i = i0; i <= i1; i++) { const v = vals[i]; g.fillStyle = v >= 0 ? th.up : th.dn; const yy = y(v), y0 = y(0); g.fillRect(this.xOf(i) - Math.max(1, bw * .35), Math.min(yy, y0), Math.max(1, bw * .7), Math.max(1, Math.abs(yy - y0))); if (bw >= 34) { g.fillStyle = th.text; g.font = '9px ui-monospace,monospace'; g.textAlign = 'center'; g.fillText(fmtV(v), this.xOf(i), v >= 0 ? yy - 6 : yy + 8); } }
      } else {
        if (k === 'rsi') { g.strokeStyle = th.grid; for (const lv of [30, 70]) { g.beginPath(); g.moveTo(0, y(lv)); g.lineTo(this.plotW, y(lv)); g.stroke(); } }
        g.strokeStyle = k === 'cvd' ? th.blue : k === 'scvd' ? th.gold : '#b388ff'; g.lineWidth = 1.4; g.beginPath(); let s = false;
        for (let i = Math.max(0, i0 - 1); i <= Math.min(c.length - 1, i1 + 1); i++) { if (isNaN(vals[i])) continue; const xx = this.xOf(i), yy = y(vals[i]); if (!s) { g.moveTo(xx, yy); s = true; } else g.lineTo(xx, yy); } g.stroke();
      }
      g.fillStyle = th.text; g.font = '10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const lastv = vals[Math.min(vals.length - 1, i1)];
      g.fillText(k === 'delta' ? 'DELTA (taker buy - sell)' : k === 'cvd' ? 'CVD (cumulative delta, from first loaded bar)' : k === 'scvd' ? 'SESSION CVD (resets at Asia / London / NY, New York time)' : 'RSI 14', 6, top + 8);
      g.restore();
      g.fillStyle = th.text; g.textAlign = 'left'; g.font = '10px ui-monospace,monospace'; g.fillText(k === 'rsi' ? '70' : fmtV(mx), this.plotW + 6, top + 16); g.fillText(k === 'rsi' ? '30' : fmtV(mn), this.plotW + 6, top + h - 8);
    }
  }
  drawCross(g, th, c, lay) {
    const m = this.mouse; if (!m || m.x > this.plotW) return;
    const i = Math.round(this.iOf(m.x)); const x = this.xOf(i);
    g.strokeStyle = th.cross; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + .5, 0); g.lineTo(Math.round(x) + .5, this.H - AXH); g.stroke();
    if (m.y < lay.mainH) { g.beginPath(); g.moveTo(0, m.y); g.lineTo(this.plotW, m.y); g.stroke(); g.setLineDash([]); const p = this.pOf(m.y); g.fillStyle = th.cross; g.fillRect(this.plotW, m.y - 9, AXW, 18); g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '11px ui-monospace,monospace'; g.fillText(fmtP(p, this.dec), this.plotW + 5, m.y); } else g.setLineDash([]);
    this.hoverIdx = c[i] ? i : null; this.app.updateLegend(this.hoverIdx);
  }
  // drawings
  P(pt) { return { x: this.xOf(this.idxOfT(pt.t)), y: this.ymap(pt.p) }; }
  drawings(g, th, c) {
    const list = this.app.drawingsFor(); const sel = this.app.selDraw;
    for (const d of list) {
      g.strokeStyle = d.color || th.gold; g.fillStyle = d.color || th.gold; g.lineWidth = d.w ? d.w + (d.id === sel ? 1.2 : 0) : (d.id === sel ? 3 : 1.6); g.setLineDash([]);
      const a = d.pts[0] && this.P(d.pts[0]), b = d.pts[1] && this.P(d.pts[1]);
      if (d.type === 'hline') { g.beginPath(); g.moveTo(0, a.y); g.lineTo(this.plotW, a.y); g.stroke(); g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(fmtP(d.pts[0].p, this.dec), 4, a.y - 6); }
      else if (d.type === 'trend' && b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); for (const q of [a, b]) { g.beginPath(); g.arc(q.x, q.y, 3, 0, 7); g.fill(); } }
      else if (d.type === 'rect' && b) { g.globalAlpha = .15; g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.globalAlpha = 1; g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else if (d.type === 'text') { g.font = 'bold 13px system-ui'; g.textAlign = 'left'; g.fillText(d.text, a.x, a.y); }
      else if (d.type === 'brush') { g.beginPath(); d.pts.forEach((p, k) => { const q = this.P(p); k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke(); }
      else if (d.type === 'measure' && b) this.measure(g, th, d.pts[0], d.pts[1], true);
      else if (DR.has(d.type)) DR.render(this, g, th, d, d.id === sel);
    }
    const sd = list.find(d => d.id === sel); if (sd && sd.type !== 'brush') { for (const q of this.handlePts(sd)) { g.setLineDash([]); g.fillStyle = '#fff'; g.strokeStyle = sd.color || th.gold; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 7, 0, 7); g.fill(); g.stroke(); } }
    this.app.syncDrawBar && this.app.syncDrawBar();
    const p = this.pending; if (p && p.pts.length) {
      const m = this.mouse; const cur = m ? { t: this.tOfIdx(Math.round(this.iOf(m.x))), p: this.pOf(m.y) } : p.pts[0];
      const a = this.P(p.pts[0]), b = this.P(p.pts[1] || cur);
      g.strokeStyle = th.gold; g.lineWidth = 1.5; g.setLineDash([4, 3]);
      if (DR.has(p.type)) { const n = DR.DEFS[p.type].n, pts = p.pts.slice(); while (pts.length < n) pts.push(pts.length > 1 ? pts[pts.length - 1] : cur); g.setLineDash([]); DR.render(this, g, th, { type: p.type, pts, color: th.gold }, false); for (const q of p.pts) { const z = this.P(q); g.fillStyle = '#fff'; g.beginPath(); g.arc(z.x, z.y, 5, 0, 7); g.fill(); } }
      else if (p.type === 'rect') g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      else if (p.type === 'brush') { g.beginPath(); p.pts.forEach((pt, k) => { const q = this.P(pt); k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke(); }
      else if (p.type === 'measure') this.measure(g, th, p.pts[0], p.pts[1] || cur, false);
      else { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      g.setLineDash([]);
    }
  }
  measure(g, th, p1, p2, done) {
    const a = this.P(p1), b = this.P(p2); const dp = p2.p - p1.p, pc = dp / p1.p * 100, bars = Math.round(this.idxOfT(p2.t) - this.idxOfT(p1.t)); const ms = Math.abs(p2.t - p1.t);
    const dur = ms >= 864e5 ? Math.floor(ms / 864e5) + 'd ' + Math.floor(ms % 864e5 / 36e5) + 'h' : ms >= 36e5 ? Math.floor(ms / 36e5) + 'h ' + Math.floor(ms % 36e5 / 6e4) + 'm' : Math.floor(ms / 6e4) + 'm';
    const col = dp >= 0 ? th.up : th.dn; g.fillStyle = col; g.globalAlpha = .15; g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.globalAlpha = 1; g.strokeStyle = col; g.setLineDash([]); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const txt = `${dp >= 0 ? '+' : ''}${fmtP(dp, this.dec)} (${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%)  ${Math.abs(bars)} bars, ${dur}`; g.font = 'bold 11px system-ui'; const w = g.measureText(txt).width + 12;
    const tx = Math.min(Math.max(4, (a.x + b.x) / 2 - w / 2), this.plotW - w - 4), ty = Math.min(a.y, b.y) - 26 < 4 ? Math.max(a.y, b.y) + 8 : Math.min(a.y, b.y) - 26;
    g.fillStyle = col; g.fillRect(tx, ty, w, 20); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(txt, tx + 6, ty + 10);
  }
  alertLines(g, th) {
    for (const a of this.app.state.alerts) { if (a.sym !== this.app.state.symbol) continue; const y = this.ymap(a.level); g.strokeStyle = th.gold; g.setLineDash([6, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(this.plotW, y); g.stroke(); g.setLineDash([]); g.fillStyle = th.gold; g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText('🔔 ' + fmtP(a.level, this.dec), 6, y - 7); }
  }
  tradeLines(g, th) {
    const app = this.app; for (const t of app.openTrades(app.state.symbol)) {
      const open = t.status === 'open', x0 = open && t.openedAt ? Math.max(0, this.xOf(this.idxOfT(t.openedAt))) : 0, w = this.plotW - x0; const R = app.tradeLive(t);
      const yE = this.ymap(t.entry), yS = this.ymap(t.sl), yT = this.ymap(t.tp);
      g.fillStyle = 'rgba(239,83,80,.10)'; g.fillRect(x0, Math.min(yE, yS), w, Math.abs(yS - yE)); g.fillStyle = 'rgba(38,166,154,.10)'; g.fillRect(x0, Math.min(yE, yT), w, Math.abs(yT - yE));
      const ln = (y, col, dash) => { g.strokeStyle = col; g.lineWidth = 1.3; g.setLineDash(dash); g.beginPath(); g.moveTo(x0, y); g.lineTo(this.plotW, y); g.stroke(); g.setLineDash([]); };
      ln(yE, th.blue, open ? [] : [6, 4]); ln(yS, th.dn, [4, 3]); ln(yT, th.up, [4, 3]);
      g.font = 'bold 10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
      const tag = (y, txt, col) => { g.fillStyle = col; g.fillText(txt, 6, y - 7); };
      tag(yE, `${t.dir.toUpperCase()} ${open ? 'open' : 'waiting'} ${fmtP(t.entry, this.dec)}${R != null ? ' · ' + (R >= 0 ? '+' : '') + R.toFixed(2) + 'R' : ''}`, th.blue); tag(yS, 'SL ' + fmtP(t.sl, this.dec), th.dn); tag(yT, 'TP ' + fmtP(t.tp, this.dec), th.up);
    }
  }
  handlePts(d) { if (d.type === 'hline') { const q = this.P(d.pts[0]); return [{ x: Math.min(Math.max(q.x, 24), this.plotW - 24), y: q.y }]; } return d.pts.slice(0, d.type === 'text' ? 1 : 99).map(q => this.P(q)); }
  hit(x, y, tol = 9) { // find drawing near point
    let best = null, bd = tol;
    for (const d of this.app.drawingsFor()) {
      const ps = d.pts.map(p => this.P(p)); let dist = Infinity;
      if (d.type === 'hline') dist = Math.abs(y - ps[0].y);
      else if (d.type === 'text') dist = Math.hypot(x - ps[0].x - 20, y - ps[0].y + 5) * .6;
      else if (d.type === 'brush') for (const q of ps) dist = Math.min(dist, Math.hypot(x - q.x, y - q.y));
      else if (DR.has(d.type)) dist = DR.dist(this, d, x, y);
      else if (ps.length > 1) {
        const [a, b] = ps; if (d.type === 'trend') { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((x - a.x) * dx + (y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); dist = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)); }
        else { const inx = x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4, iny = y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4; dist = inx && iny ? 0 : Infinity; }
      }
      if (dist < bd) { bd = dist; best = d; }
    }
    if (!best) { const st = this.app.state; for (const a of (st.avwaps[st.symbol] || [])) { const av = this.cache['av' + a.t]; if (!av) continue; const i = Math.round(this.iOf(x)); for (const arr of [av.v, av.up, av.dn]) { const v = arr && arr[i]; if (v != null && isFinite(v) && Math.abs(this.ymap(v) - y) < tol) { best = { id: a.id, type: 'avwap', pts: [] }; break; } } if (best) break; } }
    return best;
  }
  _bind() {
    const cv = this.cv, ptrs = new Map(); let drag = null, pinch = null, moved = false;
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId); const p = pos(e); ptrs.set(e.pointerId, p); moved = false;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), bw: this.view.barW }; drag = null; return; }
      const tool = this.app.state.tool;
      if (tool === 'cursor' && p.x <= this.plotW && this.app.selDraw) { const sd = this.app.drawingsFor().find(d => d.id === this.app.selDraw); if (sd && sd.type !== 'brush') { const hp = this.handlePts(sd); let hi = -1, hd = 20; hp.forEach((q, i) => { const dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < hd) { hd = dd; hi = i; } }); if (hi >= 0) { drag = { mode: 'handle', d: sd, i: hi }; return; } const h = this.hit(p.x, p.y, 16); if (h && h.id === sd.id) { drag = { mode: 'move', d: sd, x: p.x, y: p.y, orig: sd.pts.map(q => ({ ...q })), i0: this.iOf(p.x), p0: this.pOf(p.y) }; return; } } }
      if (p.x > this.plotW) { drag = { mode: 'axis', y: p.y, yz: this.view.yz }; return; }
      if (tool !== 'cursor' && p.y < (this.lay?.mainH || 0)) { this.app.toolDown(p, this.snap(p)); return; }
      drag = { mode: 'pan', x: p.x, right: this.view.right, y: p.y, yc: this.view.yc };
    });
    cv.addEventListener('pointermove', e => {
      const p = pos(e); this.mouse = e.pointerType === 'touch' && !ptrs.size ? null : p; if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); this.view.barW = Math.min(120, Math.max(2, pinch.bw * d / pinch.d)); this.invalidate(); return; }
      if (this.app.state.tool !== 'cursor' && !drag) { this.app.toolMove(p, this.snap(p)); this.invalidate(); return; }
      if (drag && (drag.mode === 'handle' || drag.mode === 'move')) {
        moved = true; const d = drag.d;
        if (drag.mode === 'handle') { const s = this.snap(p); d.pts[drag.i] = d.type === 'hline' ? { t: d.pts[0].t, p: s.p } : s; }
        else { const di = this.iOf(p.x) - drag.i0, dp = this.pOf(p.y) - drag.p0; d.pts = drag.orig.map(q => ({ t: d.type === 'hline' ? q.t : this.tOfIdx(Math.round(this.idxOfT(q.t) + di)), p: q.p + dp })); }
        this.invalidate(); return;
      }
      if (drag) {
        if (Math.abs(p.x - drag.x) + Math.abs(p.y - (drag.y ?? 0)) > 3) moved = true;
        if (drag.mode === 'axis') { this.view.yz = Math.min(20, Math.max(.05, drag.yz * Math.exp((p.y - drag.y) / 180))); }
        else { this.view.right = drag.right - (p.x - drag.x) / this.view.barW; const mh = this.lay.mainH, [lo, hi] = this.rg; this.view.yc = drag.yc + (p.y - drag.y) / mh; const n = this.c.length; this.view.right = Math.min(n + 40, Math.max(5, this.view.right)); }
        if (this.view.right < 30) this.app.loadMore(); 
      }
      this.invalidate();
    });
    const up = e => { if (drag && (drag.mode === 'handle' || drag.mode === 'move') && moved) this.app.save(); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (drag && !moved && drag.mode === 'pan' && this.app.state.tool === 'cursor') { const p = pos(e); if (this.app.state.beginner !== false && p.x <= this.plotW && this.labels) { let lb = null, ld = 1e9; for (const l of this.labels) { if (!l.txt) continue; const dx = p.x < l.x ? l.x - p.x : p.x > l.x + l.w ? p.x - l.x - l.w : 0, dy = p.y < l.y - 11 ? l.y - 11 - p.y : p.y > l.y + 3 ? p.y - l.y - 3 : 0, d = Math.hypot(dx, dy); if (d <= 9 && d < ld) { ld = d; lb = l; } } if (lb && this.app.explain) { this.selLbl = { txt: lb.txt, x: lb.x, y: lb.y, w: lb.w }; this.invalidate(); this.app.explain(lb.txt); drag = null; this.app.toolUp?.(); return; } } if (this.app.state.ind.bubbles && this.bubHits) { let best = null, bd = 1e9; for (const h of this.bubHits) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d <= h.r + 10 && (!best || h.b.q > best.b.q)) { bd = d; best = h; } } this.selBub = best ? best.b.id : null; this.invalidate(); } this.app.selDraw = this.hit(p.x, p.y)?.id || null; } if (this.app.state.tool !== 'cursor' && !moved) { } drag = null; if (e.pointerType === 'touch') this.mouse = null; this.app.toolUp?.(); this.invalidate(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!drag) { this.mouse = null; this.app.updateLegend(null); this.invalidate(); } });
    cv.addEventListener('dblclick', e => { const p = pos(e); if (p.x > this.plotW) { this.view.yz = 1; this.view.yc = 0; this.invalidate(); } else this.resetView(); });
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const p = pos(e);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { this.view.right += (e.deltaX || e.deltaY) / this.view.barW; this.invalidate(); return; }
      const iAt = this.iOf(p.x); const f = Math.exp(-e.deltaY * 0.0015); this.view.barW = Math.min(120, Math.max(2, this.view.barW * f));
      this.view.right = iAt + (this.plotW - p.x) / this.view.barW; this.invalidate();
    }, { passive: false });
    addEventListener('keydown', e => { if ((e.key === 'Delete' || e.key === 'Backspace') && this.app.selDraw && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { this.app.removeDrawing(this.app.selDraw); } });
  }
  snap(p) { return { t: this.tOfIdx(Math.round(this.iOf(p.x))), p: this.pOf(p.y) }; }
}
// edge slots reset per frame
const _draw = Chart.prototype.draw;
Chart.prototype.draw = function () { this.edgeSlot = { u: 0, d: 0 }; return _draw.call(this); };
