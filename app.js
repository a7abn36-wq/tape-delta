import { SYMBOLS, TFS, resolveSource, fetchKlines, fetchTrades, fetchDepth, fetchTicker, fetchPrice, fetchFutExtras, Feed } from './data.js';
import { computeICT, wilderATR } from './ict.js';
import { Chart, decimals } from './chart.js';

const $ = s => document.querySelector(s);
const KEY = 'tapedelta.v1';
const DEF = {
  symbol: 'BTCUSDT', tf: '15m', chartType: 'candles', theme: 'dark', tz: 'local', tool: 'cursor',
  ind: { ict: true, ema9: false, ema21: false, ema50: false, ema200: false, vwap: false, delta: true, cvd: true, rsi: false },
  ict: { fvg: true, ob: true, liq: true, struct: true, kill: true, sessions: true, pd: true, ote: true },
  alerts: [], drawings: {}, templates: {}, zoneAlerts: true,
};
const clone = o => JSON.parse(JSON.stringify(o));
function loadState() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return merge(clone(DEF), s); } catch {} return clone(DEF); }
function merge(base, s) { for (const k of Object.keys(base)) { if (s[k] === undefined) continue; if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = merge(base[k], s[k] || {}); else base[k] = s[k]; } for (const k of ['templates', 'drawings']) if (s[k] && typeof s[k] === 'object') base[k] = s[k]; return base; }
const nice = step => { const e = Math.pow(10, Math.floor(Math.log10(step))); const f = step / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
const fmt = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtV = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : a >= 10 ? v.toFixed(1) : v.toFixed(3); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

class App {
  constructor() {
    this.state = loadState(); this.candles = []; this.trades = []; this.fp = new Map(); this.fpStep = 0; this.fpFrom = null;
    this.src = null; this.ict = null; this.levels = null; this.replay = null; this.gen = 0; this.selDraw = null; this.loadMsg = 'Loading...';
    this.price = null; this.prevPrice = null; this.ticker = null; this.extras = null; this.depth = null; this.tape = []; this.loadingMore = false; this.feedStatus = 'connecting'; this.ictT = 0; this.zoneIn = {};
    this.chart = new Chart($('#cv'), this);
    this.feed = new Feed({ status: s => this.setFeedStatus(s), kline: k => this.onKline(k), trade: t => this.onTrade(t) });
    this.buildUI(); this.applyTheme(); this.load();
    setInterval(() => this.poll(), 10000); setInterval(() => this.pollDepth(), 2500); setInterval(() => this.renderStats(), 2000);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { this.toast('Could not save settings: ' + e.message); } }
  tfMs() { return TFS[this.state.tf]; }
  visibleCandles() { return this.replay ? this.candles.slice(0, this.replay.idx + 1) : this.candles; }
  toast(msg, ms = 6000) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('#toasts').appendChild(d); while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove(); setTimeout(() => d.remove(), ms); }
  applyTheme() { document.documentElement.classList.toggle('light', this.state.theme === 'light'); $('meta[name=theme-color]').content = this.state.theme === 'light' ? '#ffffff' : '#0b0e14'; this.chart.invalidate(); }
  setFeedStatus(s) { this.feedStatus = s; this.renderFeed(); }
  renderFeed() {
    const el = $('#feed'), t = el.querySelector('span'); const src = this.src ? this.src.label : '';
    const map = { live: ['live', 'LIVE'], connecting: ['warn', 'connecting'], reconnecting: ['warn', 'reconnecting'], stale: ['warn', 'stale, reconnecting'], down: ['bad', 'no feed'] };
    const [c, l] = map[this.feedStatus] || ['bad', this.feedStatus]; el.className = 'feed ' + c; t.textContent = (src ? src + ' · ' : '') + l;
  }
  // ---------- loading ----------
  async load() {
    const gen = ++this.gen; const { symbol, tf } = this.state;
    this.feed.close(); this.candles = []; this.trades = []; this.fp = new Map(); this.fpFrom = null; this.tape = []; this.ict = null; this.price = null; this.prevPrice = null; this.depth = null; this.ticker = null; this.extras = null;
    this.loadMsg = 'Loading ' + symbol + ' ' + tf + '...'; this.chart.invalidate(); this.renderTape(); this.renderDom(); this.renderStats();
    this.setFeedStatus('connecting');
    let src;
    try { src = await resolveSource(symbol, true); } catch (e) {
      if (gen !== this.gen) return; this.src = null; this.loadMsg = ''; this.setFeedStatus('down');
      this.showError(symbol, e); return;
    }
    if (gen !== this.gen) return; this.src = src; this.renderFeed();
    try {
      const k = await fetchKlines(src, symbol, tf, 800); if (gen !== this.gen) return;
      this.candles = k; this.price = k[k.length - 1].c; this.chart.resetView(); this.recomputeICT(true);
    } catch (e) { if (gen !== this.gen) return; this.loadMsg = 'Could not load candles: ' + e.message; this.setFeedStatus('down'); this.chart.invalidate(); return; }
    this.loadMsg = ''; this.chart.invalidate(); this.updateLegend(null);
    this.feed.open(src, symbol, tf);
    this.loadLevels(gen); this.backfillTrades(gen); this.poll(); this.pollDepth();
  }
  showError(symbol, e) {
    const alt = SYMBOLS.find(s => s.kinds.includes('spot'));
    this.loadMsg = '';
    $('#legend').innerHTML = `<b class="d">No live feed for ${esc(symbol)}.</b> ${esc(e.message)}. ${SYMBOLS.find(s => s.id === symbol)?.kinds.join('') === 'fut' ? 'This symbol only exists on Binance Futures, which your network may block. Try PAXGUSDT (gold token) or a crypto pair.' : ''}`;
    this.chart.loadMsgOverride = 1; this.loadMsg = 'No live feed. Nothing is shown rather than fake data.'; this.chart.invalidate();
  }
  async loadLevels(gen) {
    try {
      const d = await fetchKlines(this.src, this.state.symbol, '1d', 3), w = await fetchKlines(this.src, this.state.symbol, '1w', 1);
      if (gen !== this.gen) return; const today = d[d.length - 1], prev = d[d.length - 2];
      this.levels = { pdh: prev?.h, pdl: prev?.l, dOpen: today?.o, wOpen: w[w.length - 1]?.o }; this.recomputeICT(true); this.chart.invalidate();
    } catch { this.levels = null; }
  }
  async backfillTrades(gen) {
    try {
      let all = [], end;
      for (let p = 0; p < 8; p++) { const t = await fetchTrades(this.src, this.state.symbol, 1000, end); if (gen !== this.gen) return; if (!t.length) break; all = t.concat(all); end = t[0].t - 1; }
      const ids = new Set(this.trades.map(t => t.id)); const merged = all.filter(t => !ids.has(t.id)).concat(this.trades); merged.sort((a, b) => a.t - b.t);
      this.trades = merged; this.fpFrom = merged.length ? merged[0].t : null; this.rebuildFP(); this.tape = merged.slice(-40).reverse(); this.renderTape(); this.chart.invalidate();
    } catch (e) { this.fpNote = 'Tick backfill failed: ' + e.message; }
  }
  async loadMore() {
    if (this.loadingMore || this.replay || !this.candles.length || this.candles.length > 6000) return; this.loadingMore = true; const gen = this.gen;
    try { const k = await fetchKlines(this.src, this.state.symbol, this.state.tf, 700, this.candles[0].t - 1); if (gen !== this.gen || !k.length) return; this.candles = k.concat(this.candles); this.chart.view.right += k.length; this.chart.cache = {}; this.recomputeICT(true); this.chart.invalidate(); } catch {} finally { this.loadingMore = false; }
  }
  async poll() {
    const gen = this.gen, src = this.src; if (!src) return; const sym = this.state.symbol;
    try { const t = await fetchTicker(src, sym); if (gen === this.gen) { this.ticker = t; this.renderStats(); } } catch {}
    if (src.key === 'fut') { try { const e = await fetchFutExtras(sym); if (gen === this.gen) this.extras = e; } catch {} }
    // other-symbol alerts
    const syms = [...new Set(this.state.alerts.map(a => a.sym).filter(s => s !== sym))];
    for (const s of syms) { try { const sr = await resolveSource(s); const p = await fetchPrice(sr, s); this.checkAlerts(s, p); } catch {} }
  }
  async pollDepth() { if (!this.src || $('#pane-dom').hidden && !(matchMedia('(min-width:821px)').matches && false)) return; try { const gen = this.gen; const { fetchDepth } = await import('./data.js'); const d = await fetchDepth(this.src, this.state.symbol); if (gen === this.gen) { this.depth = d; this.renderDom(); } } catch {} }
  // ---------- live ----------
  onKline(k) {
    if (this.replay) return; const c = this.candles; const last = c[c.length - 1]; if (!last) return;
    if (k.t === last.t) c[c.length - 1] = k; else if (k.t > last.t) { c.push(k); if (this.chart.view.right > c.length - 3) this.chart.view.right += 1; this.chart.cache = {}; }
    this.chart.cache.key = null; this.setPrice(k.c); this.recomputeICT(k.t !== last.t); this.chart.invalidate();
  }
  onTrade(t) {
    this.trades.push(t); if (this.trades.length > 90000) this.trades.splice(0, 20000);
    this.addFP(t); this.tape.unshift(t); if (this.tape.length > 40) this.tape.length = 40; this.setPrice(t.p);
    if (!this._tapeT) this._tapeT = setTimeout(() => { this._tapeT = null; this.renderTape(); }, 400);
    this.chart.invalidate();
  }
  setPrice(p) { this.prevPrice = this.price; this.price = p; this.checkAlerts(this.state.symbol, p); this.checkZones(p); }
  // ---------- footprint ----------
  fpStepNow() { const c = this.candles; if (c.length < 20) return 0; const a = wilderATR(c.slice(-120)); return nice(a[a.length - 1] * 0.1); }
  rebuildFP() { if (!this.fpStep) this.fpStep = this.fpStepNow(); this.fp = new Map(); for (const t of this.trades) this.addFP(t); }
  fpWant(rowRange) { const st = nice(Math.max(rowRange, 1e-8)); if (st !== this.fpStep) { this.fpStep = st; this.rebuildFP(); } }
  addFP(t) {
    if (!this.fpStep) { this.fpStep = this.fpStepNow(); if (!this.fpStep) return; }
    const tf = this.tfMs(), ct = Math.floor(t.t / tf) * tf; let m = this.fp.get(ct); if (!m) { m = new Map(); this.fp.set(ct, m); }
    const k = Math.floor(t.p / this.fpStep + 1e-9); let r = m.get(k); if (!r) { r = [0, 0]; m.set(k, r); } r[t.side === 'buy' ? 1 : 0] += t.q;
  }
  drawFootprint(g, ch, i, b, x, bw, th) {
    const m = this.fp.get(b.t); if (!m || !this.fpStep) return false;
    const partial = this.fpFrom != null && b.t < this.fpFrom; const rows = [...m.entries()].sort((a, c) => a[0] - c[0]); if (!rows.length) return false;
    let mx = 0, poc = rows[0][0], pv = 0; for (const [k, r] of rows) { const v = r[0] + r[1]; if (v > mx) mx = v; if (v > pv) { pv = v; poc = k; } }
    const w = bw * 0.92, left = x - w / 2, step = this.fpStep;
    for (const [k, r] of rows) {
      const y1 = ch.ymap((k + 1) * step), y2 = ch.ymap(k * step), h = Math.max(1, y2 - y1 - 1); const tot = r[0] + r[1];
      g.fillStyle = `rgba(${r[1] >= r[0] ? '38,166,154' : '239,83,80'},${0.12 + 0.55 * tot / mx})`; g.fillRect(left, y1, w, h);
      if (k === poc) { g.strokeStyle = '#e6b84a'; g.lineWidth = 1.2; g.strokeRect(left, y1, w, h); }
      if (h >= 9) { g.font = (h >= 12 ? 10 : 8) + 'px ui-monospace,monospace'; g.textBaseline = 'middle'; const imb = r[1] >= 3 * r[0] && r[1] > 0, imbS = r[0] >= 3 * r[1] && r[0] > 0; g.fillStyle = imbS ? '#ff8a80' : th.ax; g.textAlign = 'right'; g.fillText(fmtV(r[0]), x - 3, y1 + h / 2); g.fillStyle = imb ? '#69f0ae' : th.ax; g.textAlign = 'left'; g.fillText(fmtV(r[1]), x + 3, y1 + h / 2); }
    }
    g.strokeStyle = th.cross; g.lineWidth = 1; g.beginPath(); g.moveTo(x, ch.ymap(b.h)); g.lineTo(x, ch.ymap(b.l)); g.stroke();
    const d = b.d; g.font = 'bold 10px ui-monospace,monospace'; g.textAlign = 'center'; g.fillStyle = d >= 0 ? th.up : th.dn; g.fillText('Δ ' + fmtV(d), x, ch.ymap(b.l) + 11);
    if (partial || (this.fpFrom != null && b.t < this.fpFrom + 0 && false)) { g.fillStyle = th.text; g.fillText('partial', x, ch.ymap(b.h) - 8); }
    g.textAlign = 'left'; return true;
  }
  // ---------- ICT ----------
  recomputeICT(force) {
    const now = Date.now(); if (!force && now - this.ictT < 2500) return; this.ictT = now;
    if (!this.state.ind.ict) { this.ict = null; return; }
    const c = this.visibleCandles(); this.ict = computeICT(c, this.tfMs(), this.levels); this.renderIndCounts();
  }
  checkZones(p) {
    if (!this.state.zoneAlerts || !this.ict || !this.state.ind.ict || this.replay) return; const z = this.state.ict;
    const items = []; if (z.fvg) this.ict.fvg.forEach(f => items.push(['FVG', f])); if (z.ob) this.ict.ob.forEach(o => items.push([(o.dir === 'bull' ? 'Bullish' : 'Bearish') + ' order block', o]));
    for (const [name, f] of items) { const key = f.id + (name[0]); const inside = p >= f.lo && p <= f.hi; const was = this.zoneIn[key]; if (was === false && inside) this.toast(`Price entered ${f.dir === 'bull' && name === 'FVG' ? 'bullish ' : f.dir === 'bear' && name === 'FVG' ? 'bearish ' : ''}${name} (${fmt(f.lo, decimals(p))} to ${fmt(f.hi, decimals(p))})`); this.zoneIn[key] = inside; }
  }
  // ---------- alerts ----------
  addAlert(level, mode) {
    const p = this.price; if (!isFinite(level) || level <= 0) return { err: 'Enter a valid price.' }; if (p == null) return { err: 'No live price yet.' };
    let dir = mode === 'auto' ? (level > p ? 'up' : 'down') : mode; if (level === p) return { err: 'Level equals the current price.' };
    let warn = null; if ((dir === 'up' && level <= p) || (dir === 'down' && level >= p)) warn = `Condition already true (price ${fmt(p, decimals(p))}). It will fire on the next cross ${dir}, not now.`;
    this.state.alerts.push({ id: uid(), sym: this.state.symbol, level, dir, created: Date.now() }); this.save(); this.renderAlerts(); this.chart.invalidate();
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    return { warn };
  }
  checkAlerts(sym, p) {
    const prev = this._prev ||= {}; const pp = prev[sym]; prev[sym] = p; if (pp == null) return; const fired = [];
    for (const a of this.state.alerts) if (a.sym === sym && ((a.dir === 'up' && pp < a.level && p >= a.level) || (a.dir === 'down' && pp > a.level && p <= a.level))) fired.push(a);
    if (!fired.length) return; this.state.alerts = this.state.alerts.filter(a => !fired.includes(a)); this.save();
    for (const a of fired) { const msg = `${a.sym} crossed ${a.dir === 'up' ? 'above' : 'below'} ${fmt(a.level, decimals(a.level))}`; this.toast('🔔 ' + msg, 12000); this.beep(); try { navigator.vibrate?.([200, 100, 200]); } catch {} try { if (Notification.permission === 'granted') new Notification('TAPE DELTA', { body: msg }); } catch {} }
    this.renderAlerts(); this.chart.invalidate();
  }
  beep() { try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .08; o.start(); setTimeout(() => { o.stop(); a.close(); }, 260); } catch {} }
  // ---------- drawings ----------
  drawingsFor() { return this.state.drawings[this.state.symbol] || []; }
  addDrawing(d) { (this.state.drawings[this.state.symbol] ||= []).push({ id: uid(), color: '#e6b84a', ...d }); this.save(); this.chart.invalidate(); }
  removeDrawing(id) { const l = this.state.drawings[this.state.symbol] || []; this.state.drawings[this.state.symbol] = l.filter(d => d.id !== id); this.selDraw = null; this.save(); this.chart.invalidate(); }
  setTool(t) { this.state.tool = t; this.chart.pending = null; this.chart.brushing = false; this.renderTools(); this.chart.cv.style.cursor = t === 'cursor' ? 'default' : 'crosshair'; this.chart.invalidate(); }
  toolDown(px, s) {
    const t = this.state.tool, ch = this.chart; this.downPx = px; this.lastPx = px;
    if (t === 'hline') { this.addDrawing({ type: 'hline', pts: [s] }); this.setTool('cursor'); }
    else if (t === 'text') { this.askText(px, s); }
    else if (t === 'eraser') { const h = ch.hit(px.x, px.y); if (h) this.removeDrawing(h.id); }
    else if (t === 'brush') { ch.pending = { type: 'brush', pts: [s] }; ch.brushing = true; }
    else if (['trend', 'rect', 'measure'].includes(t)) {
      if (!ch.pending) ch.pending = { type: t, pts: [s] }; else { const p = ch.pending; p.pts[1] = s; this.addDrawing({ type: p.type, pts: p.pts.slice() }); ch.pending = null; this.setTool('cursor'); }
    }
    ch.invalidate();
  }
  toolMove(px, s) {
    this.lastPx = px; const ch = this.chart;
    if (ch.brushing && ch.pending) { const l = ch.pending.pts[ch.pending.pts.length - 1]; if (Math.hypot(ch.P(l).x - px.x, ch.P(l).y - px.y) > 3) ch.pending.pts.push(s); }
  }
  toolUp() {
    const ch = this.chart, t = this.state.tool;
    if (ch.brushing && ch.pending) { if (ch.pending.pts.length > 1) this.addDrawing({ type: 'brush', pts: ch.pending.pts }); ch.pending = null; ch.brushing = false; this.setTool('cursor'); return; }
    if (ch.pending && ch.pending.pts.length === 1 && this.downPx && this.lastPx && Math.hypot(this.lastPx.x - this.downPx.x, this.lastPx.y - this.downPx.y) > 14) { const p = ch.pending; p.pts[1] = ch.snap(this.lastPx); this.addDrawing({ type: p.type, pts: p.pts.slice() }); ch.pending = null; this.setTool('cursor'); }
    this.downPx = null;
  }
  askText(px, s) {
    const box = $('#textbox'), inp = $('#textIn'); box.hidden = false; inp.value = ''; setTimeout(() => inp.focus(), 30);
    const done = ok => { box.hidden = true; inp.onkeydown = null; if (ok && inp.value.trim()) this.addDrawing({ type: 'text', pts: [s], text: inp.value.trim() }); this.setTool('cursor'); };
    inp.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
  }
  // ---------- legend / panels ----------
  updateLegend(i) {
    const c = this.visibleCandles(); if (!c.length) return; const idx = i == null ? c.length - 1 : i; const b = c[idx]; if (!b) return; const up = b.c >= b.o; const d = decimals(b.c);
    const k = this.state.symbol + ' · ' + this.state.tf; const dl = b.d;
    $('#legend').innerHTML = `<b>${k}</b> O <b class="${up ? 'u' : 'd'}">${fmt(b.o, d)}</b> H <b class="${up ? 'u' : 'd'}">${fmt(b.h, d)}</b> L <b class="${up ? 'u' : 'd'}">${fmt(b.l, d)}</b> C <b class="${up ? 'u' : 'd'}">${fmt(b.c, d)}</b> Vol <b>${fmtV(b.v)}</b> Δ <b class="${dl >= 0 ? 'u' : 'd'}">${dl >= 0 ? '+' : ''}${fmtV(dl)}</b>`;
  }
  renderTape() {
    const el = $('#pane-tape'); if (!this.tape.length) { el.innerHTML = '<div class="note">Waiting for trades from the exchange feed...</div>'; return; }
    const d = decimals(this.tape[0].p); const big = this.tape.map(t => t.q).sort((a, b) => b - a)[Math.floor(this.tape.length * 0.15)] || 0;
    el.innerHTML = this.tape.map(t => `<div class="trow ${t.side}${t.q >= big && big > 0 ? ' big' : ''}"><span>${new Date(t.t).toLocaleTimeString([], { hour12: false })}</span><span>${fmt(t.p, d)}</span><span>${fmtV(t.q)}</span></div>`).join('');
  }
  renderDom() {
    const el = $('#pane-dom'); const dp = this.depth; if (!dp) { el.innerHTML = '<div class="note">Loading order book...</div>'; return; }
    const d = decimals(dp.asks[0][0]); const asks = dp.asks.slice(0, 14); let cum = 0; const rows = asks.map(a => { cum += a[1]; return [a[0], a[1], cum]; }); const mx = rows[rows.length - 1][2];
    const ah = rows.slice().reverse().map(r => `<div class="dr ask"><i style="width:${r[2] / mx * 100}%"></i><span class="p">${fmt(r[0], d)}</span><span>${fmtV(r[1])}</span><span>${fmtV(r[2])}</span></div>`).join('');
    cum = 0; const bids = dp.bids.slice(0, 14).map(b => { cum += b[1]; return [b[0], b[1], cum]; }); const mb = Math.max(mx, bids[bids.length - 1][2]);
    const bh = bids.map(r => `<div class="dr bid"><i style="width:${r[2] / mb * 100}%"></i><span class="p">${fmt(r[0], d)}</span><span>${fmtV(r[1])}</span><span>${fmtV(r[2])}</span></div>`).join('');
    const sp = dp.asks[0][0] - dp.bids[0][0]; const imb = bids[bids.length - 1][2] / (bids[bids.length - 1][2] + mx) * 100;
    el.innerHTML = `<div class="note">Price · size · cumulative (14 levels)</div><div class="dom">${ah}<div class="spread">spread ${fmt(sp, d)} · bid share ${imb.toFixed(0)}%</div>${bh}</div>`;
  }
  renderStats() {
    const el = $('#pane-stats'); if (!el) return; const c = this.candles, last = c[c.length - 1]; const t = this.ticker, d = last ? decimals(last.c) : 2;
    let cvd = 0; for (const b of c) cvd += b.d; const kv = (a, b, cls = '') => `<div class="kv"><span>${a}</span><span class="${cls}">${b}</span></div>`;
    el.innerHTML = (last ? kv('Last', fmt(this.price ?? last.c, d)) : '') + (t ? kv('24h change', (t.chg >= 0 ? '+' : '') + t.chg.toFixed(2) + '%', t.chg >= 0 ? 'u' : 'd') + kv('24h high / low', fmt(t.hi, d) + ' / ' + fmt(t.lo, d)) + kv('24h volume', fmtV(t.vol)) : '') +
      (last ? kv('Candle delta', (last.d >= 0 ? '+' : '') + fmtV(last.d), last.d >= 0 ? 'u' : 'd') + kv('Candle buy / sell', fmtV(last.bv) + ' / ' + fmtV(last.sv)) + kv('CVD (loaded bars)', fmtV(cvd), cvd >= 0 ? 'u' : 'd') : '') +
      (this.extras ? kv('Mark', this.extras.mark ? fmt(this.extras.mark, d) : 'n/a') + kv('Funding (8h)', this.extras.funding != null ? (this.extras.funding * 100).toFixed(4) + '%' : 'n/a') + kv('Open interest', this.extras.oi != null ? fmtV(this.extras.oi) : 'n/a') : '') +
      kv('Source', this.src ? this.src.label : 'none') + kv('Ticks in memory', this.trades.length.toLocaleString()) + kv('Footprint step', this.fpStep ? this.fpStep : 'n/a') +
      `<div class="note">Delta = taker buy volume minus taker sell volume, from the exchange. ${this.src && this.src.key === 'spot' ? 'Spot feed active: futures-only fields (mark, funding, open interest) are not available.' : ''} Footprint covers ticks since ${this.fpFrom ? new Date(this.fpFrom).toLocaleTimeString([], { hour12: false }) : 'load'}; older candles show plain candles.</div>`;
  }
  renderAlerts() {
    const el = $('#pane-alerts'); const p = this.price, d = p ? decimals(p) : 2;
    const mine = this.state.alerts;
    el.innerHTML = `<div class="grp">New alert · ${this.state.symbol}</div><div class="row"><input type="number" id="alLevel" step="any" placeholder="Price" value="${p ? p.toFixed(d) : ''}" inputmode="decimal"><select id="alDir"><option value="auto">Cross (auto)</option><option value="up">Cross up</option><option value="down">Cross down</option></select><button class="btn" id="alAdd">Add</button></div><div id="alMsg"></div>
    <div class="grp">Active (${mine.length})</div>` + (mine.length ? mine.map(a => `<div class="alrow"><span>${a.sym} ${a.dir === 'up' ? '≥ cross up' : '≤ cross down'} <b>${fmt(a.level, decimals(a.level))}</b></span><button class="btn" data-del="${a.id}">✕</button></div>`).join('') : '<div class="note">No alerts. They fire once when price crosses the level, even for other symbols (checked every 10 s) while the app is open.</div>');
    $('#alAdd').onclick = () => { const r = this.addAlert(parseFloat($('#alLevel').value), $('#alDir').value); const m = $('#alMsg'); if (r.err) m.innerHTML = `<div class="msg err">${esc(r.err)}</div>`; else if (r.warn) { m.innerHTML = `<div class="msg warn">${esc(r.warn)}</div>`; } };
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { this.state.alerts = this.state.alerts.filter(a => a.id !== b.dataset.del); this.save(); this.renderAlerts(); this.chart.invalidate(); });
  }
  // ---------- replay ----------
  startReplay() {
    if (this.replay || this.candles.length < 80) return; const n = this.candles.length; this.replay = { idx: n - 60, playing: false, saved: this.chart.snapshot(), t: null };
    $('#replaybar').hidden = false; const sl = $('#rpSlider'); sl.min = 50; sl.max = n - 1; sl.value = this.replay.idx; this.chart.cache = {}; this.recomputeICT(true); this.chart.view.right = this.replay.idx + 6; this.replayUpdate(); $('#bRep').classList.add('on');
  }
  replayUpdate() { const r = this.replay; if (!r) return; $('#rpInfo').textContent = `${r.idx + 1}/${this.candles.length}`; $('#rpSlider').value = r.idx; $('#rpPlay').textContent = r.playing ? 'Pause' : 'Play'; this.chart.cache = {}; this.recomputeICT(true); this.updateLegend(null); this.chart.invalidate(); }
  replayStep() { const r = this.replay; if (!r) return; if (r.idx >= this.candles.length - 1) { this.replayPause(); return; } r.idx++; if (this.chart.view.right < r.idx + 3) this.chart.view.right = r.idx + 6; this.replayUpdate(); }
  replayPause() { const r = this.replay; if (!r) return; r.playing = false; clearInterval(r.t); this.replayUpdate(); }
  replayPlay() { const r = this.replay; if (!r) return; if (r.playing) return this.replayPause(); r.playing = true; r.t = setInterval(() => this.replayStep(), +$('#rpSpeed').value); this.replayUpdate(); }
  exitReplay() { const r = this.replay; if (!r) return; clearInterval(r.t); this.replay = null; $('#replaybar').hidden = true; $('#bRep').classList.remove('on'); this.chart.restore(r.saved); this.chart.cache = {}; this.recomputeICT(true); this.updateLegend(null); }
  // ---------- UI ----------
  buildUI() {
    const sym = $('#sym'); sym.innerHTML = SYMBOLS.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join(''); sym.value = this.state.symbol;
    sym.onchange = () => { this.exitReplay(); this.state.symbol = sym.value; this.save(); this.selDraw = null; this.load(); this.renderAlerts(); };
    const tfs = $('#tfs'); tfs.innerHTML = Object.keys(TFS).map(t => `<button data-tf="${t}">${t}</button>`).join('');
    tfs.onclick = e => { const t = e.target.dataset.tf; if (!t) return; this.exitReplay(); this.state.tf = t; this.save(); this.renderTf(); this.load(); this.renderIndCounts(); };
    this.renderTf();
    $('#ctype').value = this.state.chartType; $('#ctype').onchange = e => { this.state.chartType = e.target.value; this.save(); if (e.target.value === 'footprint') { this.chart.view.barW = Math.max(this.chart.view.barW, 60); this.chart.invalidate(); } this.chart.invalidate(); };
    $('#bInd').onclick = () => this.openIndicators(); $('#bWs').onclick = () => this.openWorkspace();
    $('#bRep').onclick = () => this.replay ? this.exitReplay() : this.startReplay();
    $('#rpPlay').onclick = () => this.replayPlay(); $('#rpStep').onclick = () => { this.replayPause(); this.replayStep(); }; $('#rpExit').onclick = () => this.exitReplay();
    $('#rpSlider').oninput = e => { this.replayPause(); this.replay.idx = +e.target.value; this.chart.view.right = this.replay.idx + 6; this.replayUpdate(); };
    $('#rpSpeed').onchange = () => { if (this.replay?.playing) { this.replayPause(); this.replayPlay(); } };
    const tzb = $('#bTz'); tzb.textContent = this.state.tz === 'UTC' ? 'UTC' : 'Local'; tzb.onclick = () => { this.state.tz = this.state.tz === 'UTC' ? 'local' : 'UTC'; tzb.textContent = this.state.tz === 'UTC' ? 'UTC' : 'Local'; this.save(); this.chart.invalidate(); };
    $('#bTheme').onclick = () => { this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark'; this.save(); this.applyTheme(); };
    $('#bSide').onclick = () => $('#side').classList.toggle('open');
    $('#tabs').onclick = e => { const t = e.target.dataset.t; if (!t) return; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); document.querySelectorAll('.pane').forEach(p => p.hidden = p.id !== 'pane-' + t); if (t === 'dom') this.pollDepth(); if (t === 'alerts') this.renderAlerts(); if (t === 'stats') this.renderStats(); };
    $('#sheetX').onclick = () => $('#sheet').hidden = true; $('#sheet').onclick = e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };
    addEventListener('keydown', e => { if (e.key === 'Escape') { $('#sheet').hidden = true; if (this.state.tool !== 'cursor') this.setTool('cursor'); } });
    this.renderTools(); this.renderAlerts(); this.renderTape();
  }
  renderTf() { document.querySelectorAll('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.tf === this.state.tf)); }
  renderTools() {
    const T = [['cursor', '⌖', 'Cursor'], ['hline', '―', 'Horizontal line'], ['trend', '╱', 'Trend line'], ['rect', '▭', 'Rectangle'], ['text', 'T', 'Text'], ['brush', '✎', 'Brush'], ['measure', '↔', 'Measure'], ['eraser', '⌫', 'Eraser'], ['clear', '🗑', 'Clear all drawings on this symbol']];
    $('#tools').innerHTML = T.map(([id, ic, t]) => `<button data-tool="${id}" title="${t}" aria-label="${t}" class="${this.state.tool === id ? 'on' : ''}">${ic}</button>`).join('');
    $('#tools').onclick = e => { const id = e.target.closest('button')?.dataset.tool; if (!id) return; if (id === 'clear') { if (this.drawingsFor().length && confirm('Delete all drawings on ' + this.state.symbol + '?')) { this.state.drawings[this.state.symbol] = []; this.save(); this.chart.invalidate(); } return; } this.setTool(id); };
  }
  ictCounts() { const i = this.ict; return i ? { fvg: i.fvg.length, ob: i.ob.length, liq: i.liq.length + i.eq.length, struct: i.struct.length, kill: i.kill.length, sessions: i.levels.length, pd: i.pd ? 1 : 0, ote: i.ote ? 1 : 0 } : {}; }
  renderIndCounts() { if (!$('#sheet').hidden && this._sheet === 'ind') this.openIndicators(true); }
  openIndicators(keep) {
    this._sheet = 'ind'; const s = this.state, cnt = this.ictCounts(); const chk = (grp, key, label, extra = '', off = false) => `<label class="chk${off ? ' off' : ''}"><input type="checkbox" data-g="${grp}" data-k="${key}" ${s[grp][key] ? 'checked' : ''}> ${label}<em>${extra}</em></label>`;
    const intraday = TFS[s.tf] <= 3600e3; const n = k => s.ind.ict && cnt[k] !== undefined ? (cnt[k] ? cnt[k] + ' in range' : 'none in range') : '';
    $('#sheetT').textContent = 'Indicators'; $('#sheetB').innerHTML =
      `<div class="grp">Order flow panes</div>${chk('ind', 'delta', 'Delta per candle')}${chk('ind', 'cvd', 'CVD (cumulative delta)')}${chk('ind', 'rsi', 'RSI 14 (Wilder)')}
      <div class="grp">Overlays</div>${chk('ind', 'ema9', 'EMA 9')}${chk('ind', 'ema21', 'EMA 21')}${chk('ind', 'ema50', 'EMA 50')}${chk('ind', 'ema200', 'EMA 200')}${chk('ind', 'vwap', 'VWAP (daily UTC reset)')}
      <div class="grp">ICT / SMC (master switch)</div>${chk('ind', 'ict', 'Show ICT / SMC layers', 'master')}
      <div class="note">Each layer below works on its own. The master switch hides all of them, and the boxes stay ticked.</div>
      ${chk('ict', 'fvg', 'Fair value gaps (unfilled)', n('fvg'))}${chk('ict', 'ob', 'Order blocks (unmitigated)', n('ob'))}${chk('ict', 'liq', 'BSL / SSL, EQH / EQL, sweeps', n('liq'))}${chk('ict', 'struct', 'BOS / CHoCH + HH HL LH LL', n('struct'))}
      ${chk('ict', 'kill', 'Killzones (Asia / London / NY AM)', intraday ? n('kill') : 'needs 1h or lower', !intraday)}${chk('ict', 'sessions', 'PDH / PDL / day open / week open', n('sessions'))}${chk('ict', 'pd', 'Premium / Discount + EQ 50%', n('pd'))}${chk('ict', 'ote', 'OTE zone (62 to 79%)', n('ote'))}
      <label class="chk"><input type="checkbox" id="zoneAl" ${s.zoneAlerts ? 'checked' : ''}> Zone alerts (only for layers shown)</label>
      <div class="row"><button class="btn" id="icReset">Reset ICT layers</button></div>`;
    $('#sheet').hidden = false;
    $('#sheetB').querySelectorAll('input[data-g]').forEach(i => i.onchange = () => { s[i.dataset.g][i.dataset.k] = i.checked; this.save(); this.recomputeICT(true); this.chart.cache = {}; this.chart.invalidate(); if (i.dataset.k === 'ict') this.openIndicators(true); });
    $('#zoneAl').onchange = e => { s.zoneAlerts = e.target.checked; this.save(); };
    $('#icReset').onclick = () => { s.ict = clone(DEF.ict); s.ind.ict = true; this.save(); this.recomputeICT(true); this.chart.invalidate(); this.openIndicators(true); };
  }
  openWorkspace() {
    this._sheet = 'ws'; const s = this.state; const tpls = Object.keys(s.templates);
    $('#sheetT').textContent = 'Workspace'; $('#sheetB').innerHTML = `
      <div class="grp">Layout templates (indicators + ICT layers)</div>
      <div class="row"><input type="text" id="tplName" placeholder="Template name" maxlength="30"><button class="btn" id="tplSave">Save current</button></div>
      ${tpls.length ? tpls.map(n => `<div class="alrow"><span>${esc(n)}</span><span><button class="btn" data-load="${esc(n)}">Load</button> <button class="btn" data-rm="${esc(n)}">✕</button></span></div>`).join('') : '<div class="note">No templates yet.</div>'}
      <div class="grp">Backup / move to another device</div>
      <div class="row"><button class="btn" id="wsExp">Export workspace (.json)</button><button class="btn" id="wsImp">Import workspace</button><input type="file" id="wsFile" accept=".json,application/json" hidden></div>
      <div class="note">Includes settings, indicators, ICT layers, drawings, alerts and templates. Import merges drawings and alerts and replaces settings. Nothing leaves your device.</div><div id="wsMsg"></div>
      <div class="grp">Danger zone</div><div class="row"><button class="btn" id="wsReset">Reset everything</button></div>`;
    $('#sheet').hidden = false; const msg = (t, c) => $('#wsMsg').innerHTML = `<div class="msg ${c}">${esc(t)}</div>`;
    $('#tplSave').onclick = () => { const n = $('#tplName').value.trim(); if (!n) return msg('Name the template first.', 'err'); s.templates[n] = { ind: clone(s.ind), ict: clone(s.ict), chartType: s.chartType, tf: s.tf }; this.save(); this.openWorkspace(); };
    $('#sheetB').querySelectorAll('[data-load]').forEach(b => b.onclick = () => { const t = s.templates[b.dataset.load]; if (!t) return; s.ind = merge(clone(DEF.ind), t.ind || {}); s.ict = merge(clone(DEF.ict), t.ict || {}); s.chartType = t.chartType || s.chartType; $('#ctype').value = s.chartType; this.save(); this.recomputeICT(true); this.chart.cache = {}; this.chart.invalidate(); msg('Template "' + b.dataset.load + '" loaded (indicators and ICT layers).', 'ok'); });
    $('#sheetB').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delete s.templates[b.dataset.rm]; this.save(); this.openWorkspace(); });
    $('#wsExp').onclick = () => { const data = { app: 'tape-delta', version: 1, exported: new Date().toISOString(), state: s }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })); a.download = 'tape-delta-workspace-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove(); msg('Exported.', 'ok'); };
    $('#wsImp').onclick = () => $('#wsFile').click();
    $('#wsFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const r = this.importWorkspace(JSON.parse(await f.text())); msg(r, 'ok'); } catch (err) { msg('Import failed: ' + err.message + '. Nothing was changed.', 'err'); } e.target.value = ''; };
    $('#wsReset').onclick = () => { if (confirm('Reset all settings, drawings and alerts?')) { localStorage.removeItem(KEY); location.reload(); } };
  }
  importWorkspace(j) {
    if (!j || typeof j !== 'object' || j.app !== 'tape-delta') throw new Error('this is not a TAPE DELTA workspace file');
    if (j.version !== 1) throw new Error('unsupported version ' + j.version); const st = j.state; if (!st || typeof st !== 'object') throw new Error('no state in file');
    const ok = (v, t) => typeof v === t; const s = this.state; let nd = 0, na = 0, skipped = 0;
    if (st.drawings && typeof st.drawings === 'object') for (const [sym, list] of Object.entries(st.drawings)) { if (!Array.isArray(list)) { skipped++; continue; } for (const d of list) { if (!d || !['hline', 'trend', 'rect', 'text', 'brush', 'measure'].includes(d.type) || !Array.isArray(d.pts) || !d.pts.every(p => p && isFinite(p.t) && isFinite(p.p))) { skipped++; continue; } const cur = (s.drawings[sym] ||= []); if (cur.some(x => x.id === d.id)) continue; cur.push({ id: d.id || uid(), type: d.type, pts: d.pts.map(p => ({ t: +p.t, p: +p.p })), text: d.text ? String(d.text).slice(0, 60) : undefined, color: typeof d.color === 'string' ? d.color : '#e6b84a' }); nd++; } }
    if (Array.isArray(st.alerts)) for (const a of st.alerts) { if (!a || !ok(a.sym, 'string') || !isFinite(a.level) || !['up', 'down'].includes(a.dir)) { skipped++; continue; } if (s.alerts.some(x => x.id === a.id)) continue; s.alerts.push({ id: a.id || uid(), sym: a.sym, level: +a.level, dir: a.dir, created: a.created || Date.now() }); na++; }
    if (st.templates && typeof st.templates === 'object') for (const [n, t] of Object.entries(st.templates)) if (t && typeof t === 'object') s.templates[String(n).slice(0, 30)] = t;
    if (st.ind) s.ind = merge(clone(DEF.ind), st.ind); if (st.ict) s.ict = merge(clone(DEF.ict), st.ict);
    for (const k of ['theme', 'tz', 'chartType', 'zoneAlerts']) if (st[k] !== undefined) s[k] = st[k];
    this.save(); this.applyTheme(); $('#ctype').value = s.chartType; $('#bTz').textContent = s.tz === 'UTC' ? 'UTC' : 'Local'; this.recomputeICT(true); this.chart.cache = {}; this.chart.invalidate(); this.renderAlerts();
    return `Imported ${nd} drawings and ${na} alerts. Settings, indicators and templates restored.` + (skipped ? ` Skipped ${skipped} invalid item${skipped > 1 ? 's' : ''}.` : '');
  }
}
window.app = new App();
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost-nosw') navigator.serviceWorker.register('sw.js').catch(() => {});
