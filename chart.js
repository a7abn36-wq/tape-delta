import { ema, rsi, vwap } from './ict.js';
import { sessionCVD, avwap, idxAtOrAfter } from './flow.js';
const TH = {
  dark: { bg: '#0b0e14', panel: '#10151e', grid: '#1a2130', text: '#8b97ad', ax: '#c5cee0', up: '#26a69a', dn: '#ef5350', cross: '#5d6b85', gold: '#e6b84a', blue: '#4c8dff' },
  light: { bg: '#ffffff', panel: '#f4f6fa', grid: '#e6eaf1', text: '#5b6578', ax: '#1c2433', up: '#13967f', dn: '#d43b3b', cross: '#8a94a8', gold: '#b8860b', blue: '#1f6feb' },
};
const AXW = 68, AXH = 24, SUBH = 92;
function nice(step) { const e = Math.pow(10, Math.floor(Math.log10(step))); const f = step / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
function fmtP(p, dec) { return p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
export function decimals(price) { return price >= 1000 ? 2 : price >= 100 ? 2 : price >= 1 ? 3 : 5; }
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
    const W = this.W, H = this.H; g.clearRect(0, 0, W, H); g.fillStyle = th.bg; g.fillRect(0, 0, W, H);
    const c = this.c; if (!c.length) { g.fillStyle = th.text; g.font = '14px system-ui'; g.fillText(app.loadMsg || 'Loading...', 20, 40); return; }
    const lay = this.layout(); this.lay = lay; const [lo, hi, i0, i1] = this.range(); this.rg = [lo, hi, i0, i1];
    const mh = lay.mainH; this.ymap = p => mh - (p - lo) / (hi - lo) * mh; this.pmap = y => lo + (mh - y) / mh * (hi - lo);
    const dec = decimals(c[c.length - 1].c); this.dec = dec; const bw = this.view.barW;
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
    const fp = st.chartType === 'footprint' && bw >= 46 && !app.replay;
    this.fpActive = fp; if (fp) { app.fpWant((hi - lo) / (mh / 14)); app.fpEnsure(i0, i1); }
    if (st.ind.liq && !app.replay) this.drawLiq(g, th, c, lo, hi, mh, fp);
    for (let i = i0; i <= i1; i++) {
      const b = c[i], x = this.xOf(i), up = b.c >= b.o, col = up ? th.up : th.dn;
      if (fp && app.drawFootprint(g, this, i, b, x, bw, th)) continue;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + .5, this.ymap(b.h)); g.lineTo(Math.round(x) + .5, this.ymap(b.l)); g.stroke();
      const yo = this.ymap(b.o), yc = this.ymap(b.c), w = Math.max(1, bw * 0.7);
      g.fillRect(x - w / 2, Math.min(yo, yc), w, Math.max(1, Math.abs(yo - yc)));
    }
    // overlays
    const ind = st.ind; const line = (arr, col, w = 1.3) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let s = false; for (let i = Math.max(0, i0 - 1); i <= Math.min(c.length - 1, i1 + 1); i++) { if (isNaN(arr[i])) { s = false; continue; } const x = this.xOf(i), y = this.ymap(arr[i]); if (!s) { g.moveTo(x, y); s = true; } else g.lineTo(x, y); } g.stroke(); };
    const cacheKey = c.length + ':' + c[c.length - 1].t + ':' + c[0].t;
    if (this.cache.key !== cacheKey) this.cache = { key: cacheKey };
    for (const n of [9, 21, 50, 200]) if (ind['ema' + n]) line(this.cache['e' + n] ||= ema(c, n), { 9: '#ffd54f', 21: '#ff9800', 50: '#4c8dff', 200: '#e040fb' }[n]);
    if (ind.vwap) line(this.cache.vw ||= vwap(c, app.tfMs()), '#00bcd4');
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
    this.drawings(g, th, c);
    this.alertLines(g, th);
    // last price
    const last = c[c.length - 1]; const ly = this.ymap(last.c);
    g.strokeStyle = last.c >= last.o ? th.up : th.dn; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, ly); g.lineTo(this.plotW, ly); g.stroke(); g.setLineDash([]);
    if (app.replay) { g.fillStyle = th.gold; g.font = 'bold 11px system-ui'; g.textAlign = 'left'; g.fillText('REPLAY', 8, mh - 12); }
    if (st.chartType === 'footprint' && !fp && !app.replay) { g.fillStyle = th.gold; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('Zoom in (scroll or pinch) to see footprint cells', 8, mh - 12); }
    if (st.chartType === 'footprint' && app.replay) { g.fillStyle = th.gold; g.font = '11px system-ui'; g.textAlign = 'left'; g.fillText('Footprint needs tick data: not available in replay', 8, mh - 12); }
    g.restore();
    // axis tag for last price
    g.fillStyle = last.c >= last.o ? th.up : th.dn; g.fillRect(this.plotW, ly - 9, AXW, 18); g.fillStyle = '#fff'; g.font = 'bold 11px ui-monospace,Menlo,monospace'; g.textAlign = 'left'; g.fillText(fmtP(last.c, dec), this.plotW + 5, ly);
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
  label(txt, x, y, col) { // collision-avoiding label
    const g = this.ctx; g.font = '10px system-ui'; const w = g.measureText(txt).width + 4;
    for (let t = 0; t < 4; t++) { const r = { x, y: y - t * 11, w, h: 11 }; if (!this.labels.some(o => Math.abs(o.x - r.x) < (o.w + r.w) / 2 + 2 && Math.abs(o.y - r.y) < 11)) { this.labels.push(r); g.fillStyle = col; g.textAlign = 'left'; g.fillText(txt, r.x, r.y); return; } }
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
      g.strokeStyle = d.color || th.gold; g.fillStyle = d.color || th.gold; g.lineWidth = d.id === sel ? 3 : 1.6; g.setLineDash([]);
      const a = d.pts[0] && this.P(d.pts[0]), b = d.pts[1] && this.P(d.pts[1]);
      if (d.type === 'hline') { g.beginPath(); g.moveTo(0, a.y); g.lineTo(this.plotW, a.y); g.stroke(); g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(fmtP(d.pts[0].p, this.dec), 4, a.y - 6); }
      else if (d.type === 'trend' && b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); for (const q of [a, b]) { g.beginPath(); g.arc(q.x, q.y, 3, 0, 7); g.fill(); } }
      else if (d.type === 'rect' && b) { g.globalAlpha = .15; g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.globalAlpha = 1; g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); }
      else if (d.type === 'text') { g.font = 'bold 13px system-ui'; g.textAlign = 'left'; g.fillText(d.text, a.x, a.y); }
      else if (d.type === 'brush') { g.beginPath(); d.pts.forEach((p, k) => { const q = this.P(p); k ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke(); }
      else if (d.type === 'measure' && b) this.measure(g, th, d.pts[0], d.pts[1], true);
    }
    const p = this.pending; if (p && p.pts.length) {
      const m = this.mouse; const cur = m ? { t: this.tOfIdx(Math.round(this.iOf(m.x))), p: this.pOf(m.y) } : p.pts[0];
      const a = this.P(p.pts[0]), b = this.P(p.pts[1] || cur);
      g.strokeStyle = th.gold; g.lineWidth = 1.5; g.setLineDash([4, 3]);
      if (p.type === 'rect') g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
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
  hit(x, y) { // find drawing near point
    let best = null, bd = 9;
    for (const d of this.app.drawingsFor()) {
      const ps = d.pts.map(p => this.P(p)); let dist = Infinity;
      if (d.type === 'hline') dist = Math.abs(y - ps[0].y);
      else if (d.type === 'text') dist = Math.hypot(x - ps[0].x - 20, y - ps[0].y + 5) * .6;
      else if (d.type === 'brush') for (const q of ps) dist = Math.min(dist, Math.hypot(x - q.x, y - q.y));
      else if (ps.length > 1) {
        const [a, b] = ps; if (d.type === 'trend') { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((x - a.x) * dx + (y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); dist = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)); }
        else { const inx = x >= Math.min(a.x, b.x) - 4 && x <= Math.max(a.x, b.x) + 4, iny = y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4; dist = inx && iny ? 0 : Infinity; }
      }
      if (dist < bd) { bd = dist; best = d; }
    }
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
      if (p.x > this.plotW) { drag = { mode: 'axis', y: p.y, yz: this.view.yz }; return; }
      if (tool !== 'cursor' && p.y < (this.lay?.mainH || 0)) { this.app.toolDown(p, this.snap(p)); return; }
      drag = { mode: 'pan', x: p.x, right: this.view.right, y: p.y, yc: this.view.yc };
    });
    cv.addEventListener('pointermove', e => {
      const p = pos(e); this.mouse = e.pointerType === 'touch' && !ptrs.size ? null : p; if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); this.view.barW = Math.min(120, Math.max(2, pinch.bw * d / pinch.d)); this.invalidate(); return; }
      if (this.app.state.tool !== 'cursor' && !drag) { this.app.toolMove(p, this.snap(p)); this.invalidate(); return; }
      if (drag) {
        if (Math.abs(p.x - drag.x) + Math.abs(p.y - (drag.y ?? 0)) > 3) moved = true;
        if (drag.mode === 'axis') { this.view.yz = Math.min(20, Math.max(.05, drag.yz * Math.exp((p.y - drag.y) / 180))); }
        else { this.view.right = drag.right - (p.x - drag.x) / this.view.barW; const mh = this.lay.mainH, [lo, hi] = this.rg; this.view.yc = drag.yc + (p.y - drag.y) / mh; const n = this.c.length; this.view.right = Math.min(n + 40, Math.max(5, this.view.right)); }
        if (this.view.right < 30) this.app.loadMore(); 
      }
      this.invalidate();
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (drag && !moved && drag.mode === 'pan' && this.app.state.tool === 'cursor') { const p = pos(e); this.app.selDraw = this.hit(p.x, p.y)?.id || null; } if (this.app.state.tool !== 'cursor' && !moved) { } drag = null; if (e.pointerType === 'touch') this.mouse = null; this.app.toolUp?.(); this.invalidate(); };
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
