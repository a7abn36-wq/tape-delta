import { SYMBOLS, TFS, resolveSource, fetchKlines, fetchKlinesFrom, fetchTrades, fetchDepth, fetchTicker, fetchPrice, fetchFutExtras, fetchTickWindow, fetchAggFrom, DIAG_TESTS, Feed } from './data.js';
import { computeICT, wilderATR, ema, nyHour } from './ict.js';
import { sessionCVD, avwap, idxAtOrAfter, sessionOf } from './flow.js';
import { checkCandles, reconcile, TAGS } from './integrity.js';
import { LiqMap } from './liq.js';
import { confluence } from './confluence.js';
import { analyze } from './analyst.js';
import { magnets } from './magnet.js';
import { regime } from './regime.js';
import { wyckoff } from './wyckoff.js';
import { backtest, stats as btStats, DEFAULTS as BT0 } from './backtest.js';
import { detectFlow, stackedImb } from './flow.js';
import { loadProfileCandles, computeProfile } from './vp.js';
import { init as i18nInit, apply as i18nApply, setLang, helpHTML, settingsHTML, isAr } from './i18n.js';
import { GOLD, dailyATR, goldTimes, goldMarketOpen, sessionRanges, usdProxyChange, corr } from './gold.js';
import { validate, step as tradeStep, closeManual, toR, riskDist, stats as tradeStats, csv as tradeCsv } from './planner.js';
import { Chart, decimals } from './chart.js';

const $ = s => document.querySelector(s);
const KEY = 'tapedelta.v2';
const DEF = { evAl: { choch: false, sweep: false, delta: false, touch: false },
  symbol: 'BTCUSDT', tf: '15m', chartType: 'candles', theme: 'dark', tz: 'local', tool: 'cursor',
  ind: { ict: true, ema9: false, ema21: false, ema50: false, ema200: false, vwap: false, delta: true, cvd: false, scvd: true, rsi: false, avwapAuto: true, liq: true, gold: true, goldAtr: true, goldTimes: true, magnet: true, regime: true, wyckoff: true, vwapBands: false, vp: false, flowsig: true },
  ict: { fvg: true, ob: true, liq: true, struct: true, kill: true, sessions: true, pd: true, ote: true },
  alerts: [], drawings: {}, templates: {}, avwaps: {}, trades: [], planRisk: 100, zoneAlerts: true,
};
const clone = o => JSON.parse(JSON.stringify(o));
function loadState() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === 'object') return merge(clone(DEF), s); } catch {} return clone(DEF); }
function merge(base, s) { for (const k of Object.keys(base)) { if (s[k] === undefined) continue; if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = merge(base[k], s[k] || {}); else base[k] = s[k]; } for (const k of ['templates', 'drawings', 'avwaps']) if (s[k] && typeof s[k] === 'object') base[k] = s[k]; return base; }
const nice = step => { const e = Math.pow(10, Math.floor(Math.log10(step))); const f = step / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
const fmt = (v, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtV = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : a >= 10 ? v.toFixed(1) : v.toFixed(3); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

class App {
  constructor() {
    this.state = loadState(); this.candles = []; this.trades = []; this.ticks = new Map(); this.fpCache = new Map(); this.fpStep = 0; this.tickQ = []; this.tickBusy = 0; this.recon = new Map(); this.integ = { missed: 0, reloads: 0, lastAggId: null, issues: new Map(), gaps: 0, bad: 0 }; this.conf = null; this.confT = 0; this.gold = null; this.goldPx = {};
    this.src = null; this.ict = null; this.levels = null; this.replay = null; this.gen = 0; this.selDraw = null; this.loadMsg = 'Loading...';
    this.price = null; this.prevPrice = null; this.ticker = null; this.extras = null; this.depth = null; this.tape = []; this.loadingMore = false; this.feedStatus = 'connecting'; this.ictT = 0; this.zoneIn = {};
    this.liq = new LiqMap(() => { this.chart.invalidate(); this.renderLiq(); }); this.chart = new Chart($('#cv'), this);
    this.feed = new Feed({ status: s => this.setFeedStatus(s), kline: k => this.onKline(k), trade: t => this.onTrade(t) });
    this.buildUI(); this.applyTheme(); i18nInit(); this.load();
    setInterval(() => this.poll(), 10000); setInterval(() => this.pollDepth(), 2500); setInterval(() => { this.renderStats(); this.renderData(); this.renderLiq(); }, 2000); setInterval(() => { this.pollGoldPx(); }, 30000); setInterval(() => this.restTick(), 2000); setInterval(() => this.renderAI(), 4000); setInterval(() => this.loadVP(), 20000); setInterval(() => { this.renderFeed(); if (this.state.countdown !== false && this.candles.length) this.chart.invalidate(); }, 1000);
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch (e) { this.toast('Could not save settings: ' + e.message); } }
  tfMs() { return TFS[this.state.tf]; }
  visibleCandles() { return this.replay ? (this.replay.vis || this.candles.slice(0, this.replay.idx + 1)) : this.candles; }
  toast(msg, ms = 6000) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; $('#toasts').appendChild(d); while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove(); setTimeout(() => d.remove(), ms); }
  applyTheme() { document.documentElement.classList.toggle('light', this.state.theme === 'light'); $('meta[name=theme-color]').content = this.state.theme === 'light' ? '#ffffff' : '#0b0e14'; this.chart.invalidate(); }
  setFeedStatus(s) { this.feedStatus = s; this.renderFeed(); }
  renderFeed() {
    const el = $('#feed'), t = el.querySelector('span'); const src = this.src ? this.src.label : ''; const now = Date.now(); const f = this.feed;
    const wsOk = f.alive && now - (f.last || 0) < 90000, restOk = this.restOk && now - this.restOk < 7000; const age = this.lastUpdate ? Math.round((now - this.lastUpdate) / 1000) : null;
    let c, l;
    if (!this.src) { c = 'bad'; l = this.feedStatus === 'connecting' ? 'connecting' : 'no feed'; }
    else if (wsOk) { c = 'live'; l = 'LIVE ' + (src.includes('Futures') ? 'Futures' : 'Binance') + ' WS'; }
    else if (restOk) { c = 'live'; l = 'LIVE REST 2s'; }
    else if (this.feedStatus === 'connecting') { c = 'warn'; l = 'connecting'; }
    else { c = 'bad'; l = 'STALE'; }
    const I = this.integ; const dq = !this.src ? '' : (I.bad || I.gaps) ? ' · data ⚠' : ' · data ✓'; el.className = 'feed ' + c; t.textContent = (src ? (this.src.key === 'fut' ? 'Futures perp' : 'Spot') + ' · ' : '') + l + (age != null ? ' · ' + (age < 2 ? 'now' : age + 's') : '') + dq;
  }
  // REST fallback: when the websocket is silent for 4s, poll the latest candles and trades over REST every 2s. Same update path as the stream.
  async restTick() {
    if (this.replay || !this.src || !this.candles.length || this.restBusy) return; const f = this.feed; if (f.alive && Date.now() - (f.last || 0) < 4000) return;
    this.restBusy = true; const gen = this.gen, src = this.src, sym = this.state.symbol, tf = this.state.tf;
    try {
      const ks = await fetchKlines(src, sym, tf, 2); if (gen !== this.gen) return;
      const I = this.integ; let tr = [];
      try { tr = I.lastAggId != null ? await fetchAggFrom(src, sym, I.lastAggId + 1) : (await import('./data.js').then(m => m.fetchTrades(src, sym, 50))); } catch {}
      if (gen !== this.gen) return;
      for (const k of ks) { const last = this.candles[this.candles.length - 1]; if (k.t >= last.t) this.onKline(k); }
      for (const t of tr) this.onTrade(t);
      this.restOk = Date.now(); this.renderFeed();
    } catch { } finally { this.restBusy = false; }
  }
  async runDiag() {
    const el = $('#pane-diag'); if (this.diagBusy) return; this.diagBusy = true; const rows = DIAG_TESTS.map(t => ({ ...t, r: null })); this.diagRows = rows; this.diagAt = new Date();
    const paint = () => this.renderDiag(); paint(); await Promise.all(rows.map(async x => { x.r = await x.f(); paint(); })); this.diagBusy = false; paint();
  }
  renderDiag() {
    const el = $('#pane-diag'); if (!el || el.hidden) return; const rows = this.diagRows || []; const f = this.feed; const cn = navigator.connection || {};
    const row = x => `<div class="kv"><span>${x.g} ${x.n}</span><span class="${x.r ? (x.r.ok ? 'up' : 'dn') : ''}">${x.r ? (x.r.ok ? 'PASS ' + x.r.ms + 'ms' : 'FAIL') : '...'}</span></div>${x.r && x.r.note ? `<div class="note">${x.r.note}</div>` : ''}`;
    el.innerHTML = `<div class="kv"><span>Active feed</span><span>${f.alive ? 'WS ' + (f.host || '') : (this.restOk && Date.now() - this.restOk < 7000 ? 'REST 2s (' + (this.src ? this.src.rest.split('/')[2] : '') + ')' : 'none')}</span></div>
      <div class="kv"><span>Last update</span><span>${this.lastUpdate ? new Date(this.lastUpdate).toLocaleTimeString() : 'none'}</span></div>
      <div class="kv"><span>Network</span><span>${navigator.onLine ? 'online' : 'offline'} · ${cn.effectiveType || '?'}</span></div>
      <div class="kv"><span>Device time</span><span>${new Date().toLocaleString()}</span></div>
      <button id="diagRun" class="btn">${this.diagBusy ? 'Testing...' : 'Run tests again'}</button>
      ${rows.map(row).join('')}<div class="note">Tested from this browser, now. FAIL means this phone and network could not reach that host. Bybit rows are info only: Bybit is not used for chart data.</div>`;
    const b = $('#diagRun'); if (b) b.onclick = () => this.runDiag();
  }
  // ---------- loading ----------
  async load() {
    const gen = ++this.gen; const { symbol, tf } = this.state;
    this.feed.close(); this.liq.stop(); this.candles = []; this.trades = []; this.ticks = new Map(); this.fpCache = new Map(); this.tickQ = []; this.recon = new Map(); this.integ = { missed: 0, reloads: 0, lastAggId: null, issues: new Map(), gaps: 0, bad: 0 }; this.conf = null; this.tape = []; this.ict = null; this.price = null; this.prevPrice = null; this.depth = null; this.ticker = null; this.extras = null;
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
      this.candles = k; this.price = k[k.length - 1].c; this.chart.resetView(); this.checkData(); this.recomputeICT(true);
    } catch (e) { if (gen !== this.gen) return; this.loadMsg = 'Could not load candles: ' + e.message; this.setFeedStatus('down'); this.chart.invalidate(); return; }
    this.loadMsg = ''; this.chart.invalidate(); this.updateLegend(null);
    this.feed.open(src, symbol, tf);
    if (this.state.ind.liq) this.liq.start(src, symbol);
    this._ev = null; this.vp = null; this.vpKey = null; this.loadVP(true); this.loadLevels(gen); this.loadGold(gen); this.catchUp(symbol, src); this.backfillTrades(gen); this.poll(); this.pollDepth();
  }
  showError(symbol, e) {
    const alt = SYMBOLS.find(s => s.kinds.includes('spot'));
    this.loadMsg = '';
    $('#legend').innerHTML = `<b class="d">No live feed for ${esc(symbol)}.</b> ${esc(e.message)}. ${SYMBOLS.find(s => s.id === symbol)?.kinds.join('') === 'fut' ? 'This symbol only exists on Binance Futures, which your network may block. Try PAXGUSDT (gold token) or a crypto pair.' : ''}`;
    this.chart.loadMsgOverride = 1; this.loadMsg = 'No live feed. Nothing is shown rather than fake data.'; this.chart.invalidate();
  }
  async loadLevels(gen) {
    try {
      const d = await fetchKlines(this.src, this.state.symbol, '1d', 3), w = await fetchKlines(this.src, this.state.symbol, '1w', 2); let mo = []; try { mo = await fetchKlines(this.src, this.state.symbol, '1M', 2); } catch {}
      if (gen !== this.gen) return; const today = d[d.length - 1], prev = d[d.length - 2];
      this.levels = { pdh: prev?.h, pdl: prev?.l, dOpen: today?.o, wOpen: w[w.length - 1]?.o, pwh: w.length > 1 ? w[w.length - 2].h : null, pwl: w.length > 1 ? w[w.length - 2].l : null, mOpen: mo.length ? mo[mo.length - 1].o : null, pmh: mo.length > 1 ? mo[mo.length - 2].h : null, pml: mo.length > 1 ? mo[mo.length - 2].l : null }; this.recomputeICT(true); this.chart.invalidate();
    } catch { this.levels = null; }
  }
  async backfillTrades(gen) {
    try { const t = await fetchTrades(this.src, this.state.symbol, 40); if (gen !== this.gen) return; const ids = new Set(this.tape.map(x => x.id)); this.tape = this.tape.concat(t.filter(x => !ids.has(x.id))).sort((a, b) => b.t - a.t).slice(0, 40); this.renderTape(); } catch {}
    const last = this.candles[this.candles.length - 1]; if (last) this.ensureTicks(last.t);
  }
  async loadMore() {
    if (this.loadingMore || this.replay || !this.candles.length || this.candles.length > 6000) return; this.loadingMore = true; const gen = this.gen;
    try { const k = await fetchKlines(this.src, this.state.symbol, this.state.tf, 700, this.candles[0].t - 1); if (gen !== this.gen || !k.length) return; this.candles = k.concat(this.candles); this.chart.view.right += k.length; this.chart.cache = {}; this.checkData(); this.recomputeICT(true); this.chart.invalidate(); } catch {} finally { this.loadingMore = false; }
  }
  async poll() {
    const gen = this.gen, src = this.src; if (!src) return; const sym = this.state.symbol;
    try { const t = await fetchTicker(src, sym); if (gen === this.gen) { this.ticker = t; this.renderStats(); } } catch {}
    if (src.key === 'fut') { try { const e = await fetchFutExtras(sym); if (gen === this.gen) this.extras = e; } catch {} }
    // other-symbol alerts
    const syms = [...new Set(this.state.alerts.map(a => a.sym).concat(this.openTrades().map(t => t.sym)).filter(s => s !== sym))];
    for (const s of syms) { try { const sr = await resolveSource(s); const p = await fetchPrice(sr, s); this.checkAlerts(s, p); this.catchUp(s, sr); this.evalTrades(s, p, p, Date.now(), 'tick'); } catch {} }
  }
  async pollDepth() { if (!this.src || $('#pane-dom').hidden && !(matchMedia('(min-width:821px)').matches && false)) return; try { const gen = this.gen; const { fetchDepth } = await import('./data.js'); const d = await fetchDepth(this.src, this.state.symbol); if (gen === this.gen) { this.depth = d; this.depthAt = Date.now(); this.renderDom(); } } catch {} }
  // ---------- live ----------
  onKline(k) {
    if (this.replay) return; this.lastUpdate = Date.now(); const c = this.candles; const last = c[c.length - 1]; if (!last) return;
    if (k.t === last.t) c[c.length - 1] = k; else if (k.t > last.t) { c.push(k); if (this.chart.view.right > c.length - 3) this.chart.view.right += 1; this.chart.cache = {}; this.checkData(); }
    this.chart.cache.key = null; this.setPrice(k.c); this.recomputeICT(k.t !== last.t); this.chart.invalidate();
  }
  onTrade(t) {
    const I = this.integ; if (I.lastAggId != null && t.id <= I.lastAggId) return; this.lastUpdate = Date.now(); if (I.lastAggId != null && t.id > I.lastAggId + 1) { I.missed += t.id - I.lastAggId - 1; const ce = this.ticks.get(Math.floor(t.t / this.tfMs()) * this.tfMs()); if (ce && ce.status === 'full') { ce.status = 'stale'; I.reloads++; this.tickQ.push(Math.floor(t.t / this.tfMs()) * this.tfMs()); this.pumpTicks(); } }
    I.lastAggId = t.id;
    this.trades.push(t); if (this.trades.length > 20000) this.trades.splice(0, 5000);
    const tfm = this.tfMs(), W0 = tfm >= 6048e5 ? 3456e5 : 0, ct = Math.floor((t.t - W0) / tfm) * tfm + W0; let e = this.ticks.get(ct); if (!e) { e = { arr: [], status: 'live', lastId: 0 }; this.ticks.set(ct, e); }
    if (t.id > e.lastId) { e.arr.push([t.p, t.q, t.side === 'buy' ? 1 : 0, t.id, t.t]); e.lastId = t.id; }
    this.liq.addTrade(t);
    this.tape.unshift(t); if (this.tape.length > 40) this.tape.length = 40; this.setPrice(t.p);
    if (!this._tapeT) this._tapeT = setTimeout(() => { this._tapeT = null; this.renderTape(); }, 400);
    this.chart.invalidate();
  }
  setPrice(p) { this.prevPrice = this.price; this.price = p; this.checkAlerts(this.state.symbol, p); this.checkZones(p); this.evalTrades(this.state.symbol, p, p, Date.now(), 'tick'); }
  // ---------- paper trade planner ----------
  openTrades(sym) { return this.state.trades.filter(t => t.status !== 'closed' && (!sym || t.sym === sym)); }
  evalTrades(sym, h, l, now, source) {
    let changed = false; for (const t of this.state.trades) { if (t.sym !== sym || t.status === 'closed') continue; const ev = tradeStep(t, h, l, now, source); for (const e of ev) { changed = true; this.tradeEvent(t, e); } }
    if (changed) { this.save(); this.chart.invalidate(); if (this._sheet === 'plan' && !$('#sheet').hidden) this.openPlanner(true); }
  }
  tradeEvent(t, e) {
    const d = decimals(t.entry), nm = `${t.sym} ${t.dir}`;
    const msg = e === 'filled' ? `📈 Paper trade filled: ${nm} at ${fmt(t.entry, d)}` : `${t.result === 'TP' ? '✅' : '🛑'} Paper trade closed: ${nm} ${t.result} ${t.R >= 0 ? '+' : ''}${t.R.toFixed(2)}R${t.ambiguous ? ' (stop and target in the same candle, counted as stop)' : ''}`;
    this.toast(msg, 12000); this.beep(); try { navigator.vibrate?.([150, 80, 150]); } catch {}
  }
  async catchUp(sym, src) {
    const list = this.state.trades.filter(t => t.sym === sym && t.status !== 'closed'); if (!list.length || !src) return;
    const from = Math.min(...list.map(t => t.lastCheck || Math.ceil(t.created / 60e3) * 60e3)); const now = Date.now();
    try {
      const k = await fetchKlinesFrom(src, sym, '1m', from, 1000); let last = from;
      for (const b of k) { if (b.t + 60e3 > now) break; for (const t of list) { if (t.status === 'closed' || b.t < (t.lastCheck || Math.ceil(t.created / 60e3) * 60e3)) continue; const ev = tradeStep(t, b.h, b.l, b.t, 'candle'); for (const e of ev) this.tradeEvent(t, e); } last = b.t + 60e3; }
      for (const t of list) if (t.status !== 'closed') t.lastCheck = Math.max(t.lastCheck || 0, last);
      this.save(); this.chart.invalidate();
    } catch {}
  }
  async pollSpot() { try { const r = await fetch('https://api.gold-api.com/price/XAU', { cache: 'no-store' }); const j = await r.json(); if (j && j.price > 0) this.xau = { p: j.price, at: Date.parse(j.updatedAt) || Date.now(), got: Date.now() }; } catch { this.xau = null; } this.chart.invalidate(); }
  goldSourceTag() { if (!this.isGold()) return null; const s = this.state.symbol, ar = isAr(); let t = s === 'PAXGUSDT' ? (ar ? 'المصدر: PAXG بديل' : 'SRC: Binance PAXG, proxy') : (ar ? 'المصدر: XAUUSDT عقد، مش سبوت' : 'SRC: Binance XAUUSDT perp, not spot'); if (this.xau && this.price && Date.now() - this.xau.got < 180e3) t += ' · ' + ((this.price / this.xau.p - 1) * 100 >= 0 ? '+' : '') + ((this.price / this.xau.p - 1) * 100).toFixed(2) + '% ' + (ar ? 'عن السبوت' : 'vs spot'); return t; }
  isGold() { return GOLD.has(this.state.symbol); }
  async loadGold(gen) {
    this.gold = null; if (!this.isGold() || !this.src) return; const src = this.src, sym = this.state.symbol;
    try {
      const [d, h, eh, gh] = await Promise.all([fetchKlines(src, sym, '1d', 40), fetchKlines(src, sym, '1h', 50), fetchKlines(src, 'EURUSDT', '1h', 50).catch(() => null), Promise.resolve(null)]); if (gen !== this.gen) return;
      const atr = dailyATR(d), today = d[d.length - 1]; const G = { atr, today, d1: d, asof: Date.now() };
      if (eh) { const dayStart = Math.floor(Date.now() / 864e5) * 864e5; const e0 = eh.find(x => x.t >= dayStart) || eh[eh.length - 1]; G.e0 = e0.o;
        const rp = [], ru = []; for (let i = 1; i < h.length; i++) { const E = eh.find(x => x.t === h[i].t), E1 = eh.find(x => x.t === h[i - 1].t); if (!E || !E1) continue; rp.push(Math.log(h[i].c / h[i - 1].c)); ru.push(-Math.log(E.c / E1.c)); }
        G.corr = corr(rp, ru); G.corrN = rp.length; }
      this.gold = G; this.pollGoldPx(); this.chart.invalidate(); this.renderGold();
    } catch (e) { if (gen === this.gen) this.gold = { err: e.message }; this.renderGold(); }
  }
  async pollGoldPx() { if (!this.isGold() || !this.src || !this.gold || this.gold.err) return; try { const e = await fetchPrice(this.src, 'EURUSDT'); this.goldPx = { e }; this.pollSpot(); this.renderGold(); } catch {} }
  goldLevels() {
    const G = this.gold; if (!this.isGold() || !this.state.ind.gold || !G || G.err || !G.atr) return null; const o = G.today.o, a = G.atr; const lv = [];
    if (this.state.ind.goldAtr) for (const k of [-1, -0.5, 0.5, 1]) lv.push({ name: `ATR ${k > 0 ? '+' : ''}${k}`, p: o + k * a });
    return { levels: lv, times: this.state.ind.goldTimes && this.tfMs() <= 3600e3 ? goldTimes(Date.now()) : [] };
  }
  renderGold() {
    const el = $('#pane-gold'); if (!el || el.hidden) return; const G = this.gold; const tag = (t, x) => `<span class="tag ${t}">${t}</span> ${x}`;
    if (!this.isGold()) { el.innerHTML = '<div class="note">The gold pack is for PAXGUSDT (gold token) and XAUUSDT (needs Futures). Pick PAXGUSDT in the symbol list.</div>'; return; }
    if (!G) { el.innerHTML = '<div class="note">Loading gold data...</div>'; return; } if (G.err) { el.innerHTML = `<div class="note">Could not load: ${esc(G.err)}</div>`; return; }
    const px = this.price ?? G.today.c, d = decimals(px), rng = Math.max(G.today.h, px) - Math.min(G.today.l, px), used = G.atr ? rng / G.atr * 100 : null; const now = Date.now(); const open = goldMarketOpen(now);
    const sp = this.xau && Date.now() - this.xau.got < 180e3 ? this.xau : null; const spotRow = `<div class="kv"><span><span class="tag REAL">REAL</span> ${isAr() ? 'سبوت الدهب XAU (gold-api.com، سعر واحد مش شموع)' : 'Spot gold XAU (gold-api.com, one quote, no candles)'}</span><span>${sp ? fmt(sp.p, 2) + ' · ' + (px / sp.p - 1 >= 0 ? '+' : '') + ((px / sp.p - 1) * 100).toFixed(2) + '% ' + (isAr() ? 'فرق هذا الشارت' : 'this chart vs spot') : 'N/A'}</span></div><div class="note">${isAr() ? 'فرق مقاس: PAXG/XAUUSDT على Binance بيختلف عن سبوت الدهب عادة حوالي 0.1 لـ 0.3% (حوالي 4 لـ 10 دولار على 3,670)، جزء منه سعر USDT مقابل الدولار (حوالي 0.13%). سعر MT5 عند وسيطك ممكن يختلف كمان بالسبريد والتغذية، فمستويات الشارت دي تقريبية بالنسبة لـ MT5.' : 'Measured: Binance PAXG / XAUUSDT usually sits about 0.1 to 0.3% from spot gold (about $4 to $10 at 3,670), partly because USDT trades slightly under $1 (about 0.13%). Your MT5 broker price can differ again by spread and feed, so levels here are approximate for MT5.'}</div>`;
    const ch = G.today.o ? (px / G.today.o - 1) * 100 : null; let usd = null; if (this.goldPx.e && G.e0) usd = -Math.log(this.goldPx.e / G.e0) * 100;
    const times = goldTimes(now).filter(t => t.t > now - 3600e3).slice(0, 4).map(t => `<div class="kv"><span>${esc(t.name)}</span><span>${new Date(t.t).toLocaleString([], { hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })} · ${t.t > now ? 'in ' + (t.t - now > 36e5 ? Math.floor((t.t - now) / 36e5) + 'h ' : '') + Math.round(((t.t - now) % 36e5) / 6e4) + 'm' : 'just passed'}</span></div>`).join('');
    const ses = sessionRanges(this.candles, this.tfMs()).map(r => `<div class="kv"><span>${r.name}${r.active ? ' (live)' : ''}</span><span>${fmt(r.lo, d)} to ${fmt(r.hi, d)} · ${fmt(r.hi - r.lo, d)}${G.atr ? ' · ' + ((r.hi - r.lo) / G.atr * 100).toFixed(0) + '% ATR' : ''}</span></div>`).join('') || '<div class="note">Session ranges need a 1h or lower timeframe.</div>';
    el.innerHTML = `<div class="leg">${tag('PROXY', 'PAXG is a gold-backed token on a crypto exchange, not spot gold (XAU). It tracks gold closely but is a different market. Volumes, spreads and weekend moves are not the gold market.')}</div>
    ${spotRow}
    <div class="kv"><span>Gold market (NY time)</span><span class="${open ? 'u' : 'd'}">${open ? 'open' : 'closed (weekend): PAXG moves are crypto-only'}</span></div>
    <div class="grp">Daily range vs ATR(14)</div>
    <div class="kv"><span>Daily ATR(14)</span><span>${G.atr ? fmt(G.atr, d) : 'n/a'}</span></div>
    <div class="kv"><span>Today so far (UTC day)</span><span>${fmt(rng, d)}${used != null ? ' · ' + used.toFixed(0) + '% of ATR' : ''}${ch != null ? ' · ' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%' : ''}</span></div>
    ${G.atr ? `<div class="kv"><span>Day open ± 1 ATR</span><span>${fmt(G.today.o - G.atr, d)} / ${fmt(G.today.o + G.atr, d)}</span></div>` : ''}
    <div class="grp">US dollar (proxy, not DXY)</div>
    <div class="leg">${tag('PROXY', 'DXY is not published by Binance. This uses real EURUSDT only (EUR is 57.6% of DXY). GBPUSDT on Binance has no data since 2023, and JPY, CAD, SEK, CHF pairs do not exist there. It is the inverse of EUR/USD, a rough guide only.')}</div>
    <div class="kv"><span>USD basket today</span><span class="${usd == null ? '' : usd >= 0 ? 'u' : 'd'}">${usd == null ? 'loading' : (usd >= 0 ? '+' : '') + usd.toFixed(2) + '%'}</span></div>
    <div class="kv"><span>PAXG vs USD basket, hourly returns (${G.corrN || 0} h)</span><span>${G.corr != null ? G.corr.toFixed(2) : 'n/a'}</span></div>
    <div class="note">Gold normally moves against the dollar, so a negative correlation is the usual picture. Short windows are noisy.</div>
    <div class="grp">Sessions (New York time)</div>${ses}
    <div class="grp">Gold reference times</div>${times}
    <div class="note">Fix and COMEX times are scheduled events, not Binance prices. LBMA fixes are 10:30 and 15:00 London time. US holidays are not accounted for.</div>`;
  }
  planDefaults() {
    const k = this.conf; const p = this.price; if (!p) return {}; const long = k && k.label !== 'NO EDGE' ? k.dir === 'bull' : true;
    return { dir: long ? 'long' : 'short', entry: p, sl: k && k.inv != null && k.label !== 'NO EDGE' ? k.inv : null, tp: k && k.tgt != null && k.label !== 'NO EDGE' ? k.tgt : null, fromSetup: !!(k && k.label !== 'NO EDGE') };
  }
  addTrade(dir, entry, sl, tp, risk) {
    const err = validate(dir, entry, sl, tp); if (err) return { err }; if (!(risk > 0)) return { err: 'Risk in dollars must be above 0.' };
    const k = this.conf; const why = k ? `${k.label} ${k.score}/100 at creation: ${k.why}` : 'No setup computed at creation';
    const t = { id: uid(), sym: this.state.symbol, dir, entry, sl, tp, risk, status: 'pending', created: Date.now(), lastCheck: Math.ceil(Date.now() / 60e3) * 60e3, why, note: '' };
    this.state.trades.push(t); this.state.planRisk = risk; this.save();
    if (this.price != null) this.evalTrades(t.sym, this.price, this.price, Date.now(), 'tick');
    this.chart.invalidate(); return { t };
  }
  tradeLive(t) { return t.status === 'open' && t.sym === this.state.symbol && this.price != null ? toR(t, this.price) : null; }
  journalAnalytics(done) {
    const ar = isAr(), T = (e, x) => ar ? x : e; if (done.length < 2) return `<div class="note">${T('Analytics appear after 2 closed trades.', 'التحليلات بتظهر بعد صفقتين مقفولتين.')}</div>`;
    const asc = done.slice().sort((x, y) => x.closedAt - y.closedAt); let c = 0; const cv = [0].concat(asc.map(t => c += t.R)); const mn = Math.min(...cv), mx = Math.max(...cv), W = 300, H = 60, px = i => (i / (cv.length - 1) * W).toFixed(1), py = v => (H - 4 - (v - mn) / ((mx - mn) || 1) * (H - 8)).toFixed(1);
    const grp = f => { const m = {}; asc.forEach(t => { const k = f(t); (m[k] ||= []).push(t.R); }); return Object.entries(m).map(([k, a]) => `<div class="kv"><span>${k}</span><span>${a.length} · ${(a.filter(r => r > 0).length / a.length * 100).toFixed(0)}% · ${(a.reduce((s, r) => s + r, 0) / a.length).toFixed(2)}R</span></div>`).join(''); };
    let pk = 0, dd = 0; cv.forEach(v => { pk = Math.max(pk, v); dd = Math.max(dd, pk - v); });
    const win = asc.filter(t => t.R > 0), los = asc.filter(t => t.R <= 0); const gw = win.reduce((s, t) => s + t.R, 0), gl = -los.reduce((s, t) => s + t.R, 0);
    return `<div class="grp">${T('Analytics (from your closed paper trades)', 'تحليلات (من صفقاتك الورقية المقفولة)')}</div><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="background:var(--bg2,#0f131c);border-radius:6px"><line x1="0" x2="${W}" y1="${py(0)}" y2="${py(0)}" stroke="#555" stroke-dasharray="3 3"/><polyline fill="none" stroke="${c >= 0 ? '#26a69a' : '#ef5350'}" stroke-width="1.6" points="${cv.map((v, i) => px(i) + ',' + py(v)).join(' ')}"/></svg>
    <div class="kv"><span>${T('Max drawdown · profit factor', 'أقصى تراجع · معامل الربح')}</span><span>-${dd.toFixed(2)}R · ${gl > 0 ? (gw / gl).toFixed(2) : '∞'}</span></div>
    <div class="kv"><span>${T('Avg win · avg loss', 'متوسط الربح · متوسط الخسارة')}</span><span>${win.length ? (gw / win.length).toFixed(2) : '-'}R · ${los.length ? (-gl / los.length).toFixed(2) : '-'}R</span></div>
    <div class="note">${T('By direction', 'حسب الاتجاه')} (n · win · avg R)</div>${grp(t => t.dir === 'long' ? T('Long', 'شراء') : T('Short', 'بيع'))}<div class="note">${T('By symbol', 'حسب الرمز')}</div>${grp(t => t.sym)}<div class="note">${T('By setup label at creation', 'حسب تصنيف الإعداد وقت الإنشاء')}</div>${grp(t => { const m = /^(.*?) \d+\/100/.exec(t.why || ''); return m ? m[1] : T('No setup', 'من غير إعداد'); })}<div class="note">${T('By session of entry (New York)', 'حسب جلسة الدخول (نيويورك)')}</div>${grp(t => sessionOf(t.created))}
    <div class="note">${T('Small samples mislead: under 30 trades these are not meaningful.', 'العينات الصغيرة مضللة: أقل من 30 صفقة الأرقام دي مش ليها معنى.')}</div>`;
  }
  openPlanner(keep) {
    this._sheet = 'plan'; const s = this.state; const sy = s.symbol; const df = this.planDefaults(); const p = this.price; const d = p ? decimals(p) : 2; const inp = (id, v) => `<input type="number" step="any" inputmode="decimal" id="${id}" value="${v != null && isFinite(v) ? (+v).toFixed(d) : ''}">`;
    const old = keep && $('#plDir') ? { dir: $('#plDir').value, e: $('#plE').value, s: $('#plS').value, t: $('#plT').value, r: $('#plR').value } : null;
    const act = s.trades.filter(t => t.status !== 'closed'); const done = s.trades.filter(t => t.status === 'closed').sort((a, b) => b.closedAt - a.closedAt); const st = tradeStats(s.trades);
    const money = t => t.R != null ? ` ${t.R * t.risk >= 0 ? '+' : '-'}$${Math.abs(t.R * t.risk).toFixed(0)}` : '';
    $('#sheetT').textContent = 'Trade planner (paper)'; $('#sheetB').innerHTML = `
      <div class="note">Paper trades only: nothing is sent to any exchange. Fills, stops and targets are checked against real prices (live ticks, and 1-minute candles while the app was closed).</div>
      <div class="grp">New plan · ${sy}</div>
      <div class="row"><select id="plDir"><option value="long">Long</option><option value="short">Short</option></select><span>Risk $</span><input type="number" id="plR" inputmode="decimal" value="${s.planRisk}" style="max-width:90px"></div>
      <div class="row"><label>Entry ${inp('plE', null)}</label><label>Stop ${inp('plS', null)}</label><label>Target ${inp('plT', null)}</label></div>
      <div class="row"><button class="btn" id="plSetup">Fill from ICT setup</button><button class="btn" id="plPx">Entry = price</button><button class="btn on" id="plGo">Place paper trade</button></div>
      <div id="plCalc" class="note"></div><div id="plMsg"></div>
      <div class="grp">Active (${act.length})</div>${act.map(t => { const r = this.tradeLive(t); const dd = decimals(t.entry); return `<div class="alrow"><span><b class="${t.dir === 'long' ? 'u' : 'd'}">${t.dir.toUpperCase()}</b> ${t.sym} ${t.status === 'pending' ? 'waiting' : 'open'} · ${fmt(t.entry, dd)} / SL ${fmt(t.sl, dd)} / TP ${fmt(t.tp, dd)}${r != null ? ` · <b class="${r >= 0 ? 'u' : 'd'}">${r >= 0 ? '+' : ''}${r.toFixed(2)}R</b>` : ''}</span><span>${t.status === 'open' && t.sym === sy ? `<button class="btn" data-close="${t.id}">Close</button> ` : ''}<button class="btn" data-del="${t.id}">${t.status === 'pending' ? 'Cancel' : '✕'}</button></span></div>`; }).join('') || '<div class="note">No active plans.</div>'}
      <div class="grp">Journal (fills itself)</div>
      ${st.n ? `<div class="kv"><span>Trades · win rate</span><span>${st.n} · ${st.winRate.toFixed(0)}%</span></div><div class="kv"><span>Total · average R</span><span class="${st.totalR >= 0 ? 'u' : 'd'}">${st.totalR >= 0 ? '+' : ''}${st.totalR.toFixed(2)}R · ${st.avgR.toFixed(2)}R</span></div><div class="kv"><span>Avg MAE · avg MFE</span><span>${st.maeR.toFixed(2)}R · ${st.mfeR.toFixed(2)}R</span></div>` : '<div class="note">No closed trades yet.</div>'}
      ${this.journalAnalytics(done)}
      ${done.slice(0, 25).map(t => { const dd = decimals(t.entry), dr = riskDist(t); return `<div class="jr"><div><b class="${t.R >= 0 ? 'u' : 'd'}">${t.R >= 0 ? '+' : ''}${t.R.toFixed(2)}R${money(t)}</b> ${t.result}${t.ambiguous ? ' (same-candle, counted as stop)' : ''} · ${t.dir} ${t.sym} <button class="btn" data-del="${t.id}">✕</button></div><div class="note">${fmt(t.entry, dd)} → ${fmt(t.exit, dd)} · SL ${fmt(t.sl, dd)} TP ${fmt(t.tp, dd)} · MAE ${((t.mae || 0) / dr).toFixed(2)}R · MFE ${((t.mfe || 0) / dr).toFixed(2)}R · held ${t.openedAt ? Math.max(1, Math.round((t.closedAt - t.openedAt) / 60000)) + ' min' : 'n/a'}</div><div class="note">${esc(t.why || '')}</div><input type="text" maxlength="120" data-note="${t.id}" placeholder="Note" value="${esc(t.note || '')}"></div>`; }).join('')}
      <div class="row"><button class="btn" id="plCsv">Export journal (.csv)</button></div>`;
    $('#sheet').hidden = false;
    const setv = (o) => { $('#plDir').value = o.dir || 'long'; $('#plE').value = o.entry != null ? (+o.entry).toFixed(d) : ''; $('#plS').value = o.sl != null ? (+o.sl).toFixed(d) : ''; $('#plT').value = o.tp != null ? (+o.tp).toFixed(d) : ''; };
    if (old) { $('#plDir').value = old.dir; $('#plE').value = old.e; $('#plS').value = old.s; $('#plT').value = old.t; $('#plR').value = old.r; } else setv({ dir: df.dir, entry: df.entry, sl: df.sl, tp: df.tp });
    const read = () => ({ dir: $('#plDir').value, e: parseFloat($('#plE').value), s: parseFloat($('#plS').value), t: parseFloat($('#plT').value), r: parseFloat($('#plR').value) });
    const calc = () => { const v = read(); const err = isFinite(v.e) && isFinite(v.s) && isFinite(v.t) ? validate(v.dir, v.e, v.s, v.t) : null; const dist = Math.abs(v.e - v.s); const rr = Math.abs(v.t - v.e) / dist; const units = v.r / dist; $('#plCalc').textContent = isFinite(rr) && !err ? `Risk distance ${fmt(dist, d)} · reward:risk ${rr.toFixed(2)} · size ${units.toFixed(units < 1 ? 4 : 2)} units · ${p ? (v.e === p ? 'fills now' : 'fills when price touches the entry') : ''}` : (err || ''); };
    ['plDir', 'plE', 'plS', 'plT', 'plR'].forEach(id => $('#' + id).oninput = calc); $('#plDir').onchange = calc; calc();
    $('#plSetup').onclick = () => { const x = this.planDefaults(); if (!x.fromSetup) { $('#plMsg').innerHTML = '<div class="msg warn">No clean ICT setup right now (NO EDGE or no invalidation/target). Fill the levels yourself.</div>'; return; } setv(x); calc(); };
    $('#plPx').onclick = () => { if (p) { $('#plE').value = p.toFixed(d); calc(); } };
    $('#plGo').onclick = () => { const v = read(); const r = this.addTrade(v.dir, v.e, v.s, v.t, v.r); if (r.err) { $('#plMsg').innerHTML = `<div class="msg err">${esc(r.err)}</div>`; return; } this.toast('Paper trade placed: ' + (r.t.status === 'open' ? 'filled at ' + fmt(r.t.entry, d) : 'waiting for ' + fmt(r.t.entry, d))); this.openPlanner(); };
    $('#sheetB').querySelectorAll('[data-close]').forEach(b => b.onclick = () => { const t = s.trades.find(x => x.id === b.dataset.close); if (t && this.price != null) { closeManual(t, this.price, Date.now()); this.save(); this.chart.invalidate(); this.openPlanner(); } });
    $('#sheetB').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { s.trades = s.trades.filter(x => x.id !== b.dataset.del); this.save(); this.chart.invalidate(); this.openPlanner(); });
    $('#sheetB').querySelectorAll('[data-note]').forEach(i => i.onchange = () => { const t = s.trades.find(x => x.id === i.dataset.note); if (t) { t.note = i.value; this.save(); } });
    $('#plCsv').onclick = () => { if (!s.trades.length) { $('#plMsg').innerHTML = '<div class="msg warn">Nothing to export yet.</div>'; return; } const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([tradeCsv(s.trades)], { type: 'text/csv' })); a.download = 'tape-delta-journal-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); };
  }
  // ---------- footprint (ticks are loaded per candle on demand, real aggregated trades) ----------
  fpWant(rowRange) { const st = nice(Math.max(rowRange, 1e-8)); if (st !== this.fpStep) { this.fpStep = st; this.fpCache = new Map(); } }
  fpEnsure(i0, i1) { const c = this.candles; for (let i = Math.max(0, i0); i <= Math.min(c.length - 1, i1); i++) this.ensureTicks(c[i].t); }
  ensureTicks(ct) { const e = this.ticks.get(ct); if (e && e.status !== 'live') return; if (this.tickQ.includes(ct)) return; this.tickQ.push(ct); this.pumpTicks(); }
  pumpTicks() { while (this.tickBusy < 2 && this.tickQ.length) { const ct = this.tickQ.shift(); this.tickBusy++; this.loadTicks(ct).finally(() => { this.tickBusy--; this.pumpTicks(); }); } }
  async loadTicks(ct) {
    const gen = this.gen, tf = this.tfMs(), sym = this.state.symbol; let e = this.ticks.get(ct); if (!e) { e = { arr: [], status: 'loading', lastId: 0 }; this.ticks.set(ct, e); }
    const had = e.arr.slice(); e.status = 'loading'; this.chart.invalidate();
    const cd = this.candles.find(x => x.t === ct); if (cd && cd.n > 90000) { e.status = 'skipped'; e.note = cd.n.toLocaleString() + ' trades in this candle, too many to load on a phone'; this.chart.invalidate(); return; }
    try {
      const end = Math.min(ct + tf - 1, Date.now()); const r = await fetchTickWindow(this.src, sym, ct, end, 40); if (gen !== this.gen) return;
      const maxId = r.ticks.length ? r.ticks[r.ticks.length - 1][3] : 0; const extra = e.arr.filter(x => x[3] > maxId); const merged = r.ticks.concat(extra);
      e.arr = merged; e.lastId = merged.length ? merged[merged.length - 1][3] : 0; e.status = r.complete ? 'full' : 'partial'; if (!r.complete) e.note = 'first ' + r.ticks.length.toLocaleString() + ' trades only';
      this.fpCache.delete(ct);
      const cc = this.candles.find(x => x.t === ct); if (cc && r.complete && ct + tf <= Date.now() - 5000) this.recon.set(ct, { ...reconcile(cc, merged), t: ct });
      if (this.ticks.size > 160) { const keep = this.candles.slice(-160).map(x => x.t); const view = this.candles.slice(Math.max(0, Math.floor(this.chart.iOf(0))), Math.ceil(this.chart.iOf(this.chart.plotW)) + 1).map(x => x.t); for (const k of [...this.ticks.keys()]) if (this.ticks.size > 160 && !view.includes(k) && k !== this.candles[this.candles.length - 1].t) this.ticks.delete(k); }
    } catch (err) { if (gen !== this.gen) return; e.status = 'error'; e.note = err.message; e.arr = had; setTimeout(() => { const x = this.ticks.get(ct); if (x && x.status === 'error' && gen === this.gen) { x.status = 'live'; } }, 15000); }
    this.chart.invalidate(); this.renderData();
  }
  rowsFor(ct) {
    const e = this.ticks.get(ct); if (!e || !e.arr.length || !this.fpStep) return null; const rp = this.replay && this.replay.cur != null && this.candles[this.replay.idx] && this.candles[this.replay.idx].t === ct; const arr = rp ? this.ticksUpTo(ct) : e.arr; const c = rp ? null : this.fpCache.get(ct); if (c && c.step === this.fpStep && c.n === arr.length) return c.rows;
    const m = new Map(), st = this.fpStep; for (const t of arr) { const k = Math.floor(t[0] / st + 1e-9); let r = m.get(k); if (!r) { r = [0, 0]; m.set(k, r); } r[t[2]] += t[1]; }
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]); if (!rp) this.fpCache.set(ct, { step: st, n: arr.length, rows }); return rows;
  }
  drawFootprint(g, ch, i, b, x, bw, th) {
    const e = this.ticks.get(b.t); const rows = this.rowsFor(b.t);
    if (!rows || !rows.length || (e && e.status === 'loading' && !e.arr.length)) { this.ensureTicks(b.t); const msg = !e ? 'loading' : e.status === 'skipped' ? 'too heavy' : e.status === 'error' ? 'retrying' : 'loading'; g.font = '9px system-ui'; g.fillStyle = th.text; g.textAlign = 'center'; g.fillText(msg, x, ch.ymap(b.l) + 11); g.textAlign = 'left'; return false; }
    if (e.status === 'skipped') { g.font = '9px system-ui'; g.fillStyle = th.text; g.textAlign = 'center'; g.fillText('too heavy', x, ch.ymap(b.l) + 11); g.textAlign = 'left'; return false; }
    let mx = 0, poc = rows[0][0], pv = 0; for (const [k, r] of rows) { const v = r[0] + r[1]; if (v > mx) mx = v; if (v > pv) { pv = v; poc = k; } }
    const w = bw * 0.92, left = x - w / 2, step = this.fpStep;
    for (const [k, r] of rows) {
      const y1 = ch.ymap((k + 1) * step), y2 = ch.ymap(k * step), h = Math.max(1, y2 - y1 - 1); const tot = r[0] + r[1];
      g.fillStyle = `rgba(${r[1] >= r[0] ? '38,166,154' : '239,83,80'},${0.12 + 0.55 * tot / mx})`; g.fillRect(left, y1, w, h);
      if (k === poc) { g.strokeStyle = '#e6b84a'; g.lineWidth = 1.2; g.strokeRect(left, y1, w, h); }
      if (h >= 9) { g.font = (h >= 12 ? 10 : 8) + 'px ui-monospace,monospace'; g.textBaseline = 'middle'; const imb = r[1] >= 3 * r[0] && r[1] > 0, imbS = r[0] >= 3 * r[1] && r[0] > 0; g.fillStyle = imbS ? '#ff8a80' : th.ax; g.textAlign = 'right'; g.fillText(fmtV(r[0]), x - 3, y1 + h / 2); g.fillStyle = imb ? '#69f0ae' : th.ax; g.textAlign = 'left'; g.fillText(fmtV(r[1]), x + 3, y1 + h / 2); }
    }
    for (const sk of stackedImb(rows)) { const yT = ch.ymap((sk.to + 1) * step), yB = ch.ymap(sk.from * step); g.fillStyle = sk.side === 'buy' ? '#69f0ae' : '#ff8a80'; if (sk.side === 'buy') g.fillRect(left + w - 2, yT, 3, yB - yT); else g.fillRect(left - 1, yT, 3, yB - yT); g.font = 'bold 8px system-ui'; g.textAlign = sk.side === 'buy' ? 'left' : 'right'; g.fillText(sk.n + 'x', sk.side === 'buy' ? left + w + 2 : left - 2, (yT + yB) / 2); }
    g.strokeStyle = th.cross; g.lineWidth = 1; g.beginPath(); g.moveTo(x, ch.ymap(b.h)); g.lineTo(x, ch.ymap(b.l)); g.stroke();
    let buy = 0, sell = 0; for (const t of this.ticksUpTo(b.t)) { if (t[2]) buy += t[1]; else sell += t[1]; } const d = e.status === 'full' || e.status === 'live' ? buy - sell : b.d;
    g.font = 'bold 10px ui-monospace,monospace'; g.textAlign = 'center'; g.fillStyle = d >= 0 ? th.up : th.dn; g.fillText('Δ ' + fmtV(d), x, ch.ymap(b.l) + 11);
    if (e.status !== 'full') { g.fillStyle = th.gold; g.font = '9px system-ui'; g.fillText(e.status === 'partial' ? 'partial' : e.status === 'loading' ? 'loading' : e.status === 'live' ? 'partial (live only)' : e.status, x, ch.ymap(b.h) - 8); }
    g.textAlign = 'left'; return true;
  }
  checkData() { const r = checkCandles(this.candles, this.tfMs()); this.integ.issues = r.issues; this.integ.gaps = r.gaps; this.integ.bad = r.bad; this.renderFeed(); }
  // ---------- ICT ----------
  recomputeICT(force) {
    const now = Date.now(); if (!force && now - this.ictT < 2500) return; this.ictT = now;
    if (!this.state.ind.ict) { this.ict = null; return; }
    const c = this.visibleCandles(); this.ict = computeICT(c, this.tfMs(), this.levels); this.renderIndCounts(); this.updateConf(); this.checkEvents();
  }
  updateConf() {
    const c = this.visibleCandles(); const sc = sessionCVD(c, this.tfMs()); this.conf = this.ict ? confluence(c, this.ict, this.levels, sc, this.tfMs()) : null; this.renderChip(); this.renderWhy();
  }
  renderChip() {
    const el = $('#chip'); if (!el) return; const k = this.conf; if (!k) { el.innerHTML = '<span class="muted">ICT confluence: waiting for data or ICT layers off</span>'; return; }
    el.className = k.label === 'NO EDGE' ? 'flat' : k.dir === 'bull' ? 'long' : 'short';
    el.innerHTML = `<b>${k.label}</b> <i>${k.score}</i> <span>${esc(k.why)}</span>`;
  }
  async loadVP(force) {
    if (!this.state.ind.vp || !this.src || this.replay) { this.vp = null; return; } const mode = this.state.vpMode || 'day', key = this.state.symbol + '|' + mode; const now = Date.now();
    if (!force && this.vpKey === key && now - (this.vpAt || 0) < 60000) return; if (this.vpBusy) return; this.vpBusy = true; const gen = this.gen;
    try { const c = await loadProfileCandles(this.src, this.state.symbol, mode); if (gen !== this.gen) return; const p = computeProfile(c); this.vp = p ? { ...p, mode, label: (mode === 'day' ? 'Day (UTC)' : mode === 'week' ? 'Week (from Mon UTC, 5m)' : 'Session') } : null; this.vpKey = key; this.vpAt = Date.now(); this.chart.invalidate(); } catch { } finally { this.vpBusy = false; }
  }
  async runBT() {
    const el = $('#pane-bt'); const ar = isAr(); const B = this.bt ||= { len: 3000, rr: 2, kz: false }; if (this.btBusy || !this.src) return; this.btBusy = true; this.btMsg = ar ? 'جاري تحميل التاريخ...' : 'Loading history...'; this.renderBT();
    try {
      const sym = this.state.symbol, tf = this.state.tf; let c = []; let end = undefined;
      while (c.length < B.len) { const k = await fetchKlines(this.src, sym, tf, 1000, end); if (!k.length) break; c = k.concat(c); end = k[0].t - 1; if (k.length < 1000) break; this.btMsg = (ar ? 'جاري التحميل ' : 'Loading ') + c.length + '...'; this.renderBT(); }
      c = c.slice(-B.len); this.btMsg = ar ? 'جاري الحساب...' : 'Computing...'; this.renderBT(); await new Promise(r => setTimeout(r, 30));
      const r = backtest(c, { rr: B.rr, kzOnly: B.kz }); const V = [['Base rule', 'القاعدة الأساسية', {}], ['Killzones only', 'كيلزون بس', { kzOnly: true }], ['+ HTF bias agrees', '+ اتجاه الفريم الأكبر متوافق', { mtf: true }], ['Trend regime only', 'وقت الترند بس', { regime: 'trend' }], ['Range regime only', 'وقت الرنج بس', { regime: 'range' }], ['+ delta flip', '+ انقلاب الدلتا', { dflip: true }], ['All three', 'التلاتة مع بعض', { kzOnly: true, mtf: true, dflip: true }]].map(([en, arx, f]) => { const rr = backtest(c, { rr: B.rr, ...f }); return { en, ar: arx, st: btStats(rr.trades) }; });
      this.btRes = { ...r, sym, tf, st: btStats(r.trades), cn: c.length, B: { ...B }, src: this.src.label, V }; this.btMsg = '';
    } catch (e) { this.btMsg = (ar ? 'فشل: ' : 'Failed: ') + e.message; } finally { this.btBusy = false; this.renderBT(); }
  }
  async runMTF() {
    if (this.mtfBusy || !this.src) return; this.mtfBusy = true; this.renderMTF(); const sym = this.state.symbol;
    try {
      const tfs = ['15m', '1h', '4h', '1d'], rows = [];
      const ks = await Promise.all(tfs.map(tf => fetchKlines(this.src, sym, tf, 300).catch(() => null)));
      tfs.forEach((tf, i) => { const c = ks[i]; if (!c || c.length < 60) { rows.push({ tf, na: 1 }); return; } const ict = computeICT(c, TFS[tf]); const st = ict.struct[ict.struct.length - 1]; const e50 = ema(c, 50)[c.length - 1], px = c[c.length - 1].c; const pos = ict.pd ? (px - ict.pd.lo) / (ict.pd.hi - ict.pd.lo) : null; rows.push({ tf, st, ema: px > e50 ? 'bull' : 'bear', pos, px, ago: st ? c.length - 1 - st.i2 : null }); });
      const m15 = await fetchKlines(this.src, sym, '15m', 400).catch(() => null); let po3 = null;
      if (m15 && m15.length > 100) { let e = m15.length - 1; while (e >= 0 && !(nyHour(m15[e].t) >= 20)) e--; if (e >= 0) { let s = e; while (s > 0 && nyHour(m15[s - 1].t) >= 20) s--; const as = m15.slice(s, e + 1), af = m15.slice(e + 1); if (as.length >= 8 && af.length) { const hi = Math.max(...as.map(x => x.h)), lo = Math.min(...as.map(x => x.l)); const sweptH = af.some(x => x.h > hi), sweptL = af.some(x => x.l < lo); const px = m15[m15.length - 1].c; po3 = { hi, lo, sweptH, sweptL, px, inside: px <= hi && px >= lo, bars: af.length, dOpen: this.levels?.dOpen }; } } }
      this.mtf = { sym, rows, po3, at: Date.now() };
    } catch (e) { this.mtf = { sym, err: e.message }; } finally { this.mtfBusy = false; this.renderMTF(); }
  }
  renderMTF() {
    const el = $('#pane-mtf'); if (!el || el.hidden) return; el.setAttribute('data-noi18n', ''); const ar = isAr(), T = (e, x) => ar ? x : e, M = this.mtf, L = this.levels || {}, dec = this.price ? decimals(this.price) : 2, f = v => v == null ? 'N/A' : fmt(v, dec);
    let h = `<div class="grp">${T('Multi-timeframe bias', 'الاتجاه على كل الفريمات')}</div><div class="note">${T('DERIVED from candles with the same rules as the chart: last market-structure break, price vs the 50 EMA, and position in the latest swing range. A checklist, not a prediction.', 'مشتق من الشموع بنفس قواعد الشارت: آخر كسر هيكل، السعر مقابل EMA 50، ومكان السعر في آخر مدى سوينج. قايمة فحص مش توقع.')}</div><div class="row"><button class="btn" id="mtfRun">${this.mtfBusy ? '...' : T('Refresh', 'تحديث')}</button></div>`;
    const dl = d => d === 'bull' ? `<b class="u">${T('Bull', 'صاعد')}</b>` : `<b class="d">${T('Bear', 'هابط')}</b>`;
    if (M && M.err) h += `<div class="msg err">${esc(M.err)}</div>`;
    if (M && M.rows) { h += `<div class="note">${esc(M.sym)}</div>`; let b = 0, r = 0;
      for (const x of M.rows) { if (x.na) { h += `<div class="kv"><span>${x.tf}</span><span>N/A</span></div>`; continue; } if (x.st) (x.st.dir === 'bull' ? b++ : r++); (x.ema === 'bull' ? b++ : r++);
        h += `<div class="kv"><span><b>${x.tf}</b> ${T('structure', 'هيكل')}</span><span>${x.st ? dl(x.st.dir) + ' ' + x.st.kind : 'N/A'}</span></div><div class="kv"><span>${x.tf} ${T('vs EMA50', 'مقابل EMA50')} · ${T('range', 'المدى')}</span><span>${dl(x.ema)} · ${x.pos == null ? 'N/A' : x.pos > 1 ? T('above range', 'فوق المدى') : x.pos < 0 ? T('below range', 'تحت المدى') : (x.pos < .5 ? T('discount', 'خصم') : T('premium', 'غالي')) + ' ' + Math.round(x.pos * 100) + '%'}</span></div>`; }
      const tot = b + r; h += `<div class="grp">${T('Alignment', 'التوافق')}</div><div class="kv"><span>${T('Bull signals · bear signals', 'إشارات صاعدة · هابطة')}</span><span>${b} · ${r}</span></div><div class="note">${tot && (b === tot || r === tot) ? T('All timeframes agree. Agreement is not an edge by itself.', 'كل الفريمات متفقة. التوافق لوحده مش ميزة.') : T('Timeframes disagree: the higher timeframe usually matters more, but this is a rule of thumb, not tested.', 'الفريمات مختلفة: الأكبر غالبا أهم، بس دي قاعدة تقريبية مش مختبرة.')}</div>`; }
    h += `<div class="grp">${T('Weekly / monthly levels', 'مستويات أسبوعية / شهرية')} (REAL)</div>${[['PWH', L.pwh], ['PWL', L.pwl], ['W.OPEN', L.wOpen], ['PMH', L.pmh], ['PML', L.pml], ['M.OPEN', L.mOpen]].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${f(v)}</span></div>`).join('')}<div class="note">${T('Drawn on the chart (Sessions levels) only when within 6% of price. N/A means the exchange returned no such candle.', 'بتتعرض على الشارت (مستويات الجلسات) بس لما تكون في حدود 6% من السعر. N/A يعني البورصة مرجعتش الشمعة دي.')}</div>`;
    if (M && M.po3) { const p = M.po3; let txt; if (p.sweptH && !p.sweptL) txt = p.inside ? T('Asia high swept, price back inside the Asia range. Textbook "manipulation up" shape (bearish distribution possible).', 'قمة آسيا اتكسر والسعر رجع جوه المدى. شكل "تلاعب لفوق" (ممكن توزيع هابط).') : p.px > p.hi ? T('Asia high swept and price is holding above it: no reversal shape yet.', 'قمة آسيا اتكسر والسعر ثابت فوقه: لسه مفيش شكل انعكاس.') : T('Asia high swept, price now below the Asia low area.', 'قمة آسيا اتكسر والسعر تحت.'); else if (p.sweptL && !p.sweptH) txt = p.inside ? T('Asia low swept, price back inside the Asia range. Textbook "manipulation down" shape (bullish distribution possible).', 'قاع آسيا اتكسر والسعر رجع جوه المدى. شكل "تلاعب لتحت" (ممكن توزيع صاعد).') : p.px < p.lo ? T('Asia low swept and price is holding below it: no reversal shape yet.', 'قاع آسيا اتكسر والسعر ثابت تحته: لسه مفيش شكل انعكاس.') : T('Asia low swept, price now above the Asia high area.', 'قاع آسيا اتكسر والسعر فوق.'); else if (p.sweptH && p.sweptL) txt = T('Both sides of the Asia range were swept: choppy, no clean Power of 3 shape.', 'الطرفين اتكسروا: سوق متقلب ومفيش شكل Power of 3 واضح.'); else txt = T('Asia range not swept yet: still accumulation / waiting.', 'مدى آسيا لسه ما اتكسرش: لسه تجميع / انتظار.');
      h += `<div class="grp">Power of 3 (AMD) · ${T('DERIVED', 'مشتق')}</div><div class="kv"><span>${T('Asia range (NY 20:00-00:00)', 'مدى آسيا (نيويورك 20:00-00:00)')}</span><span>${f(p.lo)} - ${f(p.hi)}</span></div><div class="kv"><span>${T('Day open', 'افتتاح اليوم')}</span><span>${f(p.dOpen)}</span></div><div class="kv"><span>${T('Swept high · low', 'كسر الهاي · اللو')}</span><span>${p.sweptH ? 'YES' : 'no'} · ${p.sweptL ? 'YES' : 'no'}</span></div><div class="note">${txt}</div><div class="note">${T('Accumulation = Asia range, manipulation = sweep of it, distribution = the move after. Pattern recognition only, never tested for edge.', 'تجميع = مدى آسيا، تلاعب = كسره، توزيع = الحركة بعده. مجرد التعرف على الشكل، ومتختبرش.')}</div>`; }
    else if (M && !M.err) h += `<div class="grp">Power of 3 (AMD)</div><div class="note">N/A: ${T('no complete Asia session in the loaded candles.', 'مفيش جلسة آسيا كاملة في الشموع المحملة.')}</div>`;
    el.innerHTML = h; $('#mtfRun').onclick = () => this.runMTF(); if (!M && !this.mtfBusy) this.runMTF();
  }
  getMagnets() { if (!this.candles.length) return null; const k = this.state.ind.ict ? 'i' : 'n', k0 = this.candles.length + ':' + this.candles[this.candles.length - 1].t + ':' + Math.round(this.price || 0); const kk = k + k0; if (this._mgK === kk) return this._mg; const ict = this.ict || computeICT(this.candles, this.tfMs(), this.levels); const w = this.liq && this.state.ind.liq ? this.liq.stats().walls : []; this._mg = magnets(this.candles, ict, this.levels, w, this.tfMs()); this._mgK = kk; return this._mg; }
  regimeTag() { if (!this.state.ind.regime || this.candles.length < 120) return null; const R = regime(this.candles); if (!R) return null; const ar = isAr(); return { text: (R.kind === 'trend' ? (ar ? 'ترند ' : 'TREND ') + (R.dir === 'up' ? '↑' : '↓') : R.kind === 'range' ? (ar ? 'رنج' : 'RANGE') : (ar ? 'انتقالي' : 'TRANSITION')) + ' · ADX ' + R.adx.toFixed(0), kind: R.kind }; }
  magnetLines() { if (!this.state.ind.magnet) return []; const m = this.getMagnets(); if (!m) return []; return [m.nearUp && { p: m.nearUp.p, name: 'MAG ' + m.nearUp.score }, m.nearDown && { p: m.nearDown.p, name: 'MAG ' + m.nearDown.score }].filter(Boolean); }
  renderMag() {
    const el = $('#pane-mag'); if (!el || el.hidden) return; el.setAttribute('data-noi18n', ''); const ar = isAr(), T = (e, x) => ar ? x : e, m = this.getMagnets(), d = this.price ? decimals(this.price) : 2;
    let h = `<div class="grp">${T('Liquidity magnets', 'مغناطيس السيولة')} · ${T('DERIVED', 'مشتق')}</div><div class="note">${T('Ranks resting-liquidity pools (unswept swing highs/lows, equal highs/lows, previous day/week high/low) by how many levels stack there, how long untouched, distance in ATR, and a nearby order-book wall. A rules-based ranking of where stops likely sit, not a prediction that price goes there. Not backtested.', 'بيرتب مناطق السيولة (قمم/قيعان سوينج ما اتكسرتش، قمم/قيعان متساوية، أعلى/أقل اليوم والأسبوع اللي فات) حسب كام مستوى متجمع هناك، بقالها قد إيه ما اتلمستش، المسافة بالـ ATR، وجود جدار في الأوردر بوك. ترتيب بالقواعد لمكان الستوبات غالبا، مش توقع إن السعر هيروح هناك. مش مختبر.')}</div>`;
    if (!m || !m.pools.length) { el.innerHTML = h + `<div class="note">N/A: ${T('not enough candles or no unswept pools in the loaded range.', 'مفيش شموع كفاية أو مفيش مناطق سيولة في المدى المحمل.')}</div>`; return; }
    const row = (o, lab) => `<div class="kv"><span><b>${lab}</b> ${o.side === 'up' ? T('above', 'فوق') : T('below', 'تحت')} · ${o.types.join(' + ')}</span><span>${fmt(o.p, d)} · <b>${o.score}</b>/100 · ${o.distAtr.toFixed(1)} ATR</span></div>`;
    h += `<div class="grp">${T('Nearest target above / below', 'أقرب هدف فوق / تحت')}</div>${m.nearUp ? row(m.nearUp, 'BSL') : '<div class="kv"><span>BSL</span><span>N/A</span></div>'}${m.nearDown ? row(m.nearDown, 'SSL') : '<div class="kv"><span>SSL</span><span>N/A</span></div>'}<div class="grp">${T('Ranked pools', 'المناطق مرتبة')}</div>`;
    h += m.pools.slice(0, 8).map(o => `<div class="alrow"><span>${row(o, o.side === 'up' ? 'BSL' : 'SSL')}<div class="note">${o.factors.map(f => f.txt + ' +' + f.v).join(' · ')}${o.wall ? '' : ''}</div></span></div>`).join('');
    h += `<div class="note">${T('Order-book walls are PARTIAL: only walls seen since you opened the app, on one venue.', 'جدران الأوردر بوك PARTIAL: بس اللي اتشافت من وقت ما فتحت التطبيق، على بورصة واحدة.')}</div>`; el.innerHTML = h;
  }
  renderReg() {
    const el = $('#pane-reg'); if (!el || el.hidden) return; el.setAttribute('data-noi18n', ''); const ar = isAr(), T = (e, x) => ar ? x : e, R = this.candles.length ? regime(this.candles) : null;
    let h = `<div class="grp">${T('Market regime', 'حالة السوق')} · ${T('DERIVED', 'مشتق')} · ${this.state.symbol} ${this.state.tf}</div><div class="note">${T('Classifies the loaded candles as trend, range or transition using ADX(14) and a 20-bar efficiency ratio (net move divided by path travelled), and rates volatility by ATR percentile over 100 bars. Thresholds (ADX 25 / 20, efficiency 0.30 / 0.25) are common rules of thumb, not fitted. It describes the past, it does not predict the next move.', 'بيصنف الشموع المحملة ترند أو رنج أو انتقالي باستخدام ADX(14) ونسبة كفاءة 20 شمعة (الحركة الصافية على المسافة المقطوعة)، وبيقيّم التذبذب بنسبة ATR على آخر 100 شمعة. الحدود (ADX 25 / 20، الكفاءة 0.30 / 0.25) قواعد شائعة مش متظبطة. بيوصف الماضي ومبيتوقعش الحركة الجاية.')}</div>`;
    if (!R) { el.innerHTML = h + `<div class="note">N/A: ${T('need at least 120 candles.', 'محتاج 120 شمعة على الأقل.')}</div>`; return; }
    const kn = { trend: T('TREND', 'ترند') + ' (' + (R.dir === 'up' ? T('up', 'صاعد') : T('down', 'هابط')) + ')', range: T('RANGE', 'رنج'), transition: T('TRANSITION', 'انتقالي') }[R.kind], vn = R.vol ? { high: T('HIGH', 'عالي'), normal: T('NORMAL', 'عادي'), low: T('LOW', 'واطي') }[R.vol] : 'N/A';
    const tip = { trend: T('Trending: continuation and pullback setups tend to behave better than fading extremes. Rule of thumb, not tested here.', 'ترند: صفقات الاستمرار والارتداد بتتصرف أحسن من عكس القمم والقيعان. قاعدة تقريبية مش مختبرة هنا.'), range: T('Ranging: fading the edges tends to behave better than chasing breakouts, and breakouts fail more often. Rule of thumb, not tested here.', 'رنج: العكس عند الحواف بيتصرف أحسن من مطاردة الكسر، والكسر بيفشل أكتر. قاعدة تقريبية مش مختبرة هنا.'), transition: T('Mixed signals: the market is between modes. Smaller size or waiting is the usual advice.', 'إشارات مختلطة: السوق بين حالتين. المعتاد تصغير الحجم أو الانتظار.') }[R.kind];
    h += `<div class="kv"><span>${T('Regime', 'الحالة')}</span><span><b>${kn}</b></span></div><div class="kv"><span>ADX(14)</span><span>${R.adx.toFixed(1)}</span></div><div class="kv"><span>${T('Efficiency ratio (20)', 'نسبة الكفاءة (20)')}</span><span>${R.er.toFixed(2)}</span></div><div class="kv"><span>${T('Volatility (ATR percentile, 100 bars)', 'التذبذب (نسبة ATR، 100 شمعة)')}</span><span>${vn}${R.pct != null ? ' · ' + Math.round(R.pct * 100) + '%' : ''}</span></div><div class="note">${tip}</div><div class="note">${T('The Test tab can re-run the backtest in trend-only and range-only periods so you can see whether this rule behaves differently in each.', 'تبويب الاختبار بيقدر يعيد الباكتيست في فترات الترند بس والرنج بس عشان تشوف القاعدة بتتصرف مختلف ولا لأ.')}</div>`; el.innerHTML = h;
  }
  getWy() { if (!this.candles.length) return null; const k = this.candles.length + ':' + this.candles[this.candles.length - 1].t; if (this._wyK === k) return this._wy; this._wy = wyckoff(this.candles); this._wyK = k; return this._wy; }
  renderWy() {
    const el = $('#pane-wy'); if (!el || el.hidden) return; el.setAttribute('data-noi18n', ''); const ar = isAr(), T = (e, x) => ar ? x : e, W = this.getWy(), d = this.price ? decimals(this.price) : 2;
    let h = `<div class="grp">${T('Wyckoff range detector', 'كاشف رنج وايكوف')} · ${T('DERIVED', 'مشتق')} · ${this.state.symbol} ${this.state.tf}</div><div class="note">${T('Looks for the latest sideways range (at most 12 ATR tall, 2 or more touches on each edge, 30 or more bars), what led into it (a decline suggests accumulation, a rally suggests distribution), and a Spring (dip under support that closes back inside) or UTAD (poke over resistance that closes back inside) in the last 15 candles. Pattern recognition from closed candles only. It is a label for a shape, not a signal, and it is not backtested.', 'بيدور على آخر رنج جانبي (ارتفاعه 12 ATR بالكتير، لمستين أو أكتر على كل حافة، 30 شمعة أو أكتر)، وإيه اللي دخل فيه (نزول يعني تجميع، صعود يعني توزيع)، وSpring (نزول تحت الدعم ويقفل جوه) أو UTAD (اختراق فوق المقاومة ويقفل جوه) في آخر 15 شمعة. التعرف على الشكل من الشموع المقفولة بس. ده اسم لشكل مش إشارة، ومش مختبر.')}</div>`;
    if (!W) { el.innerHTML = h + `<div class="note">N/A: ${T('need at least 150 candles.', 'محتاج 150 شمعة على الأقل.')}</div>`; return; }
    if (W.state === 'none') { el.innerHTML = h + `<div class="kv"><span>${T('Result', 'النتيجة')}</span><span><b>${T('No qualifying range', 'مفيش رنج مطابق')}</b></span></div><div class="note">${T('Nothing in the loaded candles meets the range rules. That is a valid answer, not an error.', 'مفيش حاجة في الشموع المحملة بتطابق قواعد الرنج. دي إجابة صحيحة مش خطأ.')}</div>`; return; }
    const r = W.range, f = v => fmt(v, d), kn = { accumulation: T('after a decline: possible ACCUMULATION', 'بعد نزول: تجميع محتمل'), distribution: T('after a rally: possible DISTRIBUTION', 'بعد صعود: توزيع محتمل'), undetermined: T('no clear prior trend: UNDETERMINED', 'مفيش ترند سابق واضح: غير محدد') }[r.kind];
    const sn = { range: T('Inside the range, no Spring / UTAD in the last 15 candles', 'جوه الرنج، مفيش Spring / UTAD في آخر 15 شمعة'), spring: T('SPRING-shaped event', 'حدث بشكل SPRING'), utad: T('UTAD-shaped event', 'حدث بشكل UTAD'), broken: W.broke === 'up' ? T('Price broke ABOVE the range', 'السعر كسر الرنج لفوق') : T('Price broke BELOW the range', 'السعر كسر الرنج لتحت') }[W.state];
    h += `<div class="kv"><span>${T('State', 'الحالة')}</span><span><b>${sn}</b></span></div><div class="kv"><span>${T('Context', 'السياق')}</span><span>${kn}</span></div><div class="kv"><span>${T('Resistance · support', 'المقاومة · الدعم')}</span><span>${f(r.hi)} · ${f(r.lo)}</span></div><div class="kv"><span>${T('Range height · length', 'ارتفاع الرنج · الطول')}</span><span>${(r.H / W.A).toFixed(1)} ATR · ${W.bars} ${T('bars', 'شمعة')}</span></div><div class="kv"><span>${T('Edge touches (support · resistance)', 'لمسات الحواف (دعم · مقاومة)')}</span><span>${r.tl} · ${r.th}</span></div>`;
    if (W.ev) { const e = W.ev, ok = e.type === 'spring' ? r.kind === 'accumulation' : r.kind === 'distribution'; h += `<div class="grp">${e.type === 'spring' ? 'Spring' : 'UTAD'}</div><div class="kv"><span>${T('Depth beyond the edge', 'العمق بعد الحافة')}</span><span>${e.depth.toFixed(2)} ATR</span></div><div class="kv"><span>${T('Volume vs range average', 'الفوليوم مقابل متوسط الرنج')}</span><span>${e.vol.toFixed(2)}x ${e.vol < 0.8 ? T('(low: textbook)', '(قليل: زي الكتاب)') : e.vol > 1.5 ? T('(high: less textbook)', '(عالي: أقل شبها بالكتاب)') : ''}</span></div><div class="note">${ok ? (e.type === 'spring' ? T('Fits the textbook accumulation context: a possible bullish test of support. Needs confirmation (a close back up through the range); it can also be a real breakdown.', 'مطابق لسياق التجميع: اختبار صعودي محتمل للدعم. محتاج تأكيد (قفل لفوق جوه الرنج)، وممكن يطلع كسر حقيقي.') : T('Fits the textbook distribution context: a possible bearish test of resistance. Needs confirmation; it can also be a real breakout.', 'مطابق لسياق التوزيع: اختبار هبوطي محتمل للمقاومة. محتاج تأكيد، وممكن يطلع اختراق حقيقي.')) : T('The prior move does not match the textbook context for this event, so treat it as a plain false break.', 'الحركة السابقة مش مطابقة لسياق الكتاب للحدث ده، فاعتبره كسر كاذب عادي.')}</div>`; }
    h += `<div class="note">${T('Wyckoff phases A to E are not labelled here: that needs judgement a rule cannot fake. Only the range, its edges and a Spring / UTAD shape are detected.', 'مراحل وايكوف من A لـ E مش متعلمة هنا: دي محتاجة حكم بشري القاعدة مبتقلدوش. بس الرنج وحوافه وشكل Spring / UTAD هما اللي بيتكشفوا.')}</div>`; el.innerHTML = h;
  }
  renderBT() {
    const el = $('#pane-bt'); if (!el || el.hidden) return; const ar = isAr(), B = this.bt ||= { len: 3000, rr: 2, kz: false }, R = this.btRes, esc2 = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])); const T = (en, x) => ar ? x : en;
    el.setAttribute('data-noi18n', ''); const f2 = v => (v >= 0 ? '+' : '') + v.toFixed(2);
    let h = `<div class="grp">${T('Backtest: sweep, then CHoCH, then retrace into the order block', 'اختبار على التاريخ: كسر سيولة ثم CHoCH ثم رجوع لأوردر بلوك')}</div><div class="note">${T('Rule: a liquidity sweep (wick through a swing, close back), a CHoCH within 15 candles, then a limit entry at the order block edge. Stop beyond the block or sweep. Fixed reward:risk. If stop and target are hit in the same candle, the stop counts. Fees 0.04% per side are included.', 'القاعدة: كسر سيولة (ذيل يخترق قمة/قاع ويقفل جوه)، ثم CHoCH خلال 15 شمعة، ثم دخول بأمر محدد عند حافة الأوردر بلوك. الستوب بعد البلوك أو الكسر. عائد:مخاطرة ثابت. لو الستوب والهدف اتلمسوا في نفس الشمعة بنحسب الستوب. الرسوم 0.04% لكل جهة محسوبة.')}</div>
    <div class="row"><select id="btLen"><option value="1000">${T('1000 candles', '1000 شمعة')}</option><option value="3000">${T('3000 candles', '3000 شمعة')}</option><option value="6000">${T('6000 candles', '6000 شمعة')}</option></select><select id="btRR"><option value="1.5">RR 1.5</option><option value="2">RR 2</option><option value="3">RR 3</option></select></div>
    <label class="chk"><input type="checkbox" id="btKz" ${B.kz ? 'checked' : ''}> ${T('Killzones only (London / NY AM)', 'الكيلزون فقط (لندن / نيويورك صباحا)')}</label><div class="row"><button class="btn" id="btRun">${this.btBusy ? '...' : T('Run on ' + this.state.symbol + ' ' + this.state.tf, 'شغّل على ' + this.state.symbol + ' ' + this.state.tf)}</button></div>${this.btMsg ? `<div class="note">${esc2(this.btMsg)}</div>` : ''}`;
    if (R) { const s = R.st; const hd = `${esc2(R.sym)} ${R.tf} · ${R.cn} ${T('candles', 'شمعة')} · ${new Date(R.from).toISOString().slice(0, 10)} → ${new Date(R.to).toISOString().slice(0, 10)} · ${esc2(R.src)}`;
      if (!s.n) h += `<div class="grp">${hd}</div><div class="note">${T('No trades matched the rule in this history.', 'مفيش صفقات طابقت القاعدة في التاريخ ده.')}</div>`;
      else { const cv = s.curve, mn = Math.min(...cv), mx = Math.max(...cv), W = 300, H = 70, px = i => (i / (cv.length - 1 || 1) * W).toFixed(1), py = v => (H - 4 - (v - mn) / ((mx - mn) || 1) * (H - 8)).toFixed(1);
        const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="background:var(--bg2,#0f131c);border-radius:6px"><line x1="0" x2="${W}" y1="${py(0)}" y2="${py(0)}" stroke="#555" stroke-dasharray="3 3"/><polyline fill="none" stroke="${s.total >= 0 ? '#26a69a' : '#ef5350'}" stroke-width="1.6" points="${cv.map((v, i) => px(i) + ',' + py(v)).join(' ')}"/></svg>`;
        const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
        h += `<div class="grp">${hd}</div>${kv(T('Trades', 'عدد الصفقات'), s.n)}${kv(T('Win rate', 'نسبة الربح'), (s.win * 100).toFixed(0) + '%')}${kv(T('Average R per trade (after fees)', 'متوسط R للصفقة (بعد الرسوم)'), f2(s.avgR))}${kv(T('Total R', 'إجمالي R'), f2(s.total))}${kv(T('Profit factor', 'معامل الربح'), isFinite(s.pf) ? s.pf.toFixed(2) : '∞')}${kv(T('Max drawdown (R)', 'أقصى تراجع (R)'), '-' + s.dd.toFixed(2))}<div class="grp">${T('Equity curve (R)', 'منحنى الرصيد (R)')}</div>${svg}
        <div class="grp">${T('Filters compared (same candles, same RR, fees included)', 'مقارنة الفلاتر (نفس الشموع ونفس RR مع الرسوم)')}</div><div class="note">${T('Each row is a full re-run with that filter. Trades · win · avg R · total R · profit factor. Rows under 30 trades are marked: too few to trust.', 'كل صف إعادة تشغيل كاملة بالفلتر ده. صفقات · ربح · متوسط R · إجمالي R · معامل الربح. الصفوف أقل من 30 صفقة عليها علامة: قليلة جدا للثقة.')}</div>${R.V.map(v => { const q = v.st; return q.n ? `<div class="kv"><span>${T(v.en, v.ar)}${q.n < 30 ? ' <b class="d">⚠ n&lt;30</b>' : ''}</span><span>${q.n} · ${(q.win * 100).toFixed(0)}% · ${f2(q.avgR)} · ${f2(q.total)} · ${isFinite(q.pf) ? q.pf.toFixed(2) : '∞'}</span></div>` : `<div class="kv"><span>${T(v.en, v.ar)}</span><span>0 ${T('trades', 'صفقات')}</span></div>`; }).join('')}<div class="note">${T('Testing several filters on the same data inflates the chance that one looks good by luck. Treat a better row as a hypothesis to re-check on other symbols and dates, not a proven edge.', 'تجربة فلاتر كتير على نفس البيانات بتزود احتمال إن واحد يطلع حلو بالصدفة. اعتبر الصف الأحسن فرضية تتأكد على رموز وتواريخ تانية، مش ميزة مثبتة.')}</div>
        <div class="grp">${T('By session (entry time, New York)', 'حسب الجلسة (وقت الدخول، نيويورك)')}</div>${s.bySession.map(x => kv(x.k, `${x.n} · ${(x.win * 100).toFixed(0)}% · ${f2(x.avg)}R`)).join('')}<div class="grp">${T('Long vs short', 'شراء مقابل بيع')}</div>${s.byDir.map(x => kv(x.k === 'bull' ? T('Long', 'شراء') : T('Short', 'بيع'), `${x.n} · ${(x.win * 100).toFixed(0)}% · ${f2(x.avg)}R`)).join('')}
        <div class="grp">${T('Last trades', 'آخر الصفقات')}</div>${R.trades.slice(-8).reverse().map(t => kv(new Date(t.t).toISOString().slice(5, 16).replace('T', ' ') + ' ' + (t.dir === 'bull' ? 'L' : 'S'), `${t.res} ${f2(t.R)}R`)).join('')}`;
        if (s.n < 30) h += `<div class="msg warn">${T('Only ' + s.n + ' trades: too few to trust. Treat the numbers as noise.', 'فقط ' + s.n + ' صفقة: قليلة جدا للثقة. اعتبر الأرقام مجرد ضجيج.')}</div>`; }
      h += `<div class="note">${T('Past results do not predict the future. This tests one fixed rule on the history above, with no tuning on it, and it ignores slippage, spread, funding and news. Real fills can be worse. This is not financial advice.', 'النتايج القديمة مبتتنبأش بالمستقبل. ده بيختبر قاعدة ثابتة واحدة على التاريخ اللي فوق من غير تظبيط عليه، وبيتجاهل الانزلاق والسبريد والتمويل والأخبار. التنفيذ الحقيقي ممكن يبقى أسوأ. مش نصيحة مالية.')}</div>`; }
    el.innerHTML = h; $('#btLen').value = B.len; $('#btRR').value = B.rr; $('#btLen').onchange = e => B.len = +e.target.value; $('#btRR').onchange = e => B.rr = +e.target.value; $('#btKz').onchange = e => B.kz = e.target.checked; $('#btRun').onclick = () => this.runBT();
  }
  renderAI() {
    const el = $('#pane-ai'); if (!el || el.hidden) return; const ar = isAr(); const r = analyze(this, ar); const esc2 = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    if (this.depth && this.depthAt && Date.now() - this.depthAt > 20000) { const d = this.depth; this.depth = null; var keep = d; }
    el.setAttribute('data-noi18n', '');
    if (!r) { el.innerHTML = `<div class="note">${ar ? 'محتاج 40 شمعة على الأقل وطبقات ICT شغالة.' : 'Needs 40+ candles and ICT layers switched on.'}</div>`; if (keep) this.depth = keep; return; }
    el.innerHTML = `<div class="grp">${esc2(r.head)}</div><div class="note">${esc2(r.tags[0])}</div>` + r.sections.map(([h, ls]) => `<div class="grp">${esc2(h)}</div>${ls.map(x => `<div class="why">${esc2(x)}</div>`).join('')}`).join('') + `<div class="note">${ar ? 'ده تحليل بقواعد ثابتة بيشتغل على موبايلك، من غير أي خدمة خارجية ومن غير تكلفة. مش توقع ومش نصيحة مالية، ومتجربش على بيانات قديمة، ومبيعرفش الأخبار. القرار والمخاطرة عليك.' : 'Rules-based analysis that runs on your phone, with no outside service and no cost. It is not a prediction or financial advice, it has not been backtested, and it does not know the news. The decision and the risk are yours.'}</div><div class="note">${ar ? 'الأرقام كلها من بيانات حقيقية في التطبيق. ' : 'Every number comes from the real data in the app. '}${this.src ? esc2(this.src.label) : ''}</div>`;
    if (keep) this.depth = keep;
  }
  renderWhy() {
    const el = $('#pane-why'); if (!el) return; const k = this.conf; if (!k) { el.innerHTML = '<div class="note">Needs 40+ candles and ICT layers switched on.</div>'; return; }
    const row = f => `<div class="kv"><span>${f.name} <em>+${f.pts}</em></span><span>${esc(f.text)}</span></div>`;
    const d = k.dec;
    el.innerHTML = `<div class="grp">${k.label} · score ${k.score}/100 · other side ${k.oppScore}</div><div class="why">${esc(k.why)}</div>${k.factors.map(row).join('') || '<div class="note">No aligned factors.</div>'}
    <div class="grp">Levels</div>${k.inv != null ? `<div class="kv"><span>Invalidation</span><span>${fmt(k.inv, d)}</span></div>` : ''}${k.tgt != null ? `<div class="kv"><span>Target (nearest liquidity)</span><span>${fmt(k.tgt, d)}</span></div>` : ''}${k.rr != null ? `<div class="kv"><span>Reward : risk</span><span>${k.rr.toFixed(2)}</span></div>` : ''}${k.inv == null && k.tgt == null ? '<div class="note">No clean invalidation or target on this chart.</div>' : ''}
    <div class="grp">Against (${k.dir === 'bull' ? 'short' : 'long'} side)</div>${k.opp.map(row).join('') || '<div class="note">Nothing aligned against.</div>'}
    <div class="row"><button class="btn" id="whyPlan">Plan this setup (paper)</button></div><div class="note">Rules-based checklist: structure, liquidity sweep, premium/discount + OTE, order block / FVG, killzone, order flow, day bias. It is a way to read the chart, not a signal, and it has not been backtested.</div>`; this.hookWhy();
  }
  hookWhy() { const b = $('#whyPlan'); if (b) b.onclick = () => this.openPlanner(); }
  renderData() {
    const el = $('#pane-data'); if (!el || el.hidden) return; const I = this.integ; const c = this.candles; const tag = (t, x) => `<span class="tag ${t}">${t}</span> ${x}`;
    const sym = SYMBOLS.find(x => x.id === this.state.symbol); const lq = this.liq.stats(); const sk = this.feed.skew;
    const full = [...this.ticks.values()].filter(e => e.status === 'full').length, part = [...this.ticks.values()].filter(e => e.status === 'partial' || e.status === 'live').length, skip = [...this.ticks.values()].filter(e => e.status === 'skipped').length;
    const rec = [...this.recon.values()].sort((a, b) => b.t - a.t); const bad = rec.filter(r => !r.ok);
    const verdict = (I.bad || bad.length || this.feedStatus !== 'live') ? ['warn', 'CHECK'] : I.gaps ? ['warn', 'GAPS'] : ['ok', 'CLEAN'];
    el.innerHTML = `<div class="grp">Verdict <b class="v ${verdict[0]}">${verdict[1]}</b></div>
    <div class="kv"><span>Source</span><span>${this.src ? esc(this.src.label) : 'none'}</span></div>
    <div class="kv"><span>Feed</span><span>${esc(this.feedStatus)}${sk != null ? ' · ~' + Math.max(0, Math.round(sk)) + ' ms behind' : ''}</span></div>
    <div class="kv"><span>Candles loaded</span><span>${c.length}</span></div>
    <div class="kv"><span>Missing candles</span><span class="${I.gaps ? 'd' : 'u'}">${I.gaps}</span></div>
    <div class="kv"><span>Malformed candles</span><span class="${I.bad ? 'd' : 'u'}">${I.bad}</span></div>
    <div class="kv"><span>Trades missed on stream</span><span class="${I.missed ? 'd' : 'u'}">${I.missed}${I.reloads ? ' (reloaded ' + I.reloads + 'x)' : ''}</span></div>
    <div class="kv"><span>Candles with full ticks</span><span>${full}${part ? ' · ' + part + ' partial' : ''}${skip ? ' · ' + skip + ' too heavy' : ''}</span></div>
    <div class="kv"><span>Ticks vs exchange candle</span><span class="${bad.length ? 'd' : 'u'}">${rec.length ? (rec.length - bad.length) + '/' + rec.length + ' match' : 'no closed candle checked yet'}</span></div>
    ${rec.slice(0, 4).map(r => `<div class="kv"><span>${new Date(r.t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span><span class="${r.ok ? 'u' : 'd'}">vol ${r.volDiffPct >= 0 ? '+' : ''}${r.volDiffPct.toFixed(3)}% · delta ${r.deltaDiffPct >= 0 ? '+' : ''}${r.deltaDiffPct.toFixed(3)}%</span></div>`).join('')}
    <div class="grp">What is real</div>
    <div class="leg">${tag('REAL', 'Candles, volume, taker buy/sell (' + (this.src ? esc(this.src.label) : 'exchange') + ')')}</div>
    <div class="leg">${tag('REAL', 'Delta and CVD, from exchange taker-buy volume')}</div>
    <div class="leg">${tag('REAL', 'Footprint cells, from aggregated trades, full candles only')}</div>
    <div class="leg">${tag('PARTIAL', 'Footprint on a candle that started before you opened it, or has too many trades: labelled on the chart')}</div>
    <div class="leg">${tag('REAL', 'Liquidity map: order book from the exchange, sampled every 2 s since this page opened' + (lq.cover ? ', covers -' + lq.cover.loPct.toFixed(2) + '% / +' + lq.cover.hiPct.toFixed(2) + '% of price' : '') + '. Not available before that.')}</div>
    <div class="leg">${tag('DERIVED', 'ICT layers, session CVD, anchored VWAP, pulled-wall tags, confluence score: computed here from the real data above')}</div>
    ${sym && sym.id === 'PAXGUSDT' ? `<div class="leg">${tag('PROXY', 'PAXG is a gold token traded on crypto exchanges, not spot gold (XAU). It follows gold closely but is a different market, so volumes and weekend moves differ.')}</div>` : ''}
    ${this.src && this.src.key === 'spot' ? `<div class="leg">${tag('NA', 'Funding rate, open interest, mark price: futures only. Binance Futures is not reachable from here, so they are not shown.')}</div>` : ''}
    <div class="note">Nothing on this screen is generated or simulated. If a number cannot be real, it is labelled or left out.</div>`;
  }
  renderLiq() {
    const el = $('#pane-liq'); if (!el || el.hidden) return; const L = this.liq.stats(); const d = this.price ? decimals(this.price) : 2; const now = Date.now();
    if (!this.state.ind.liq) { el.innerHTML = '<div class="note">Liquidity map is off. Turn it on in Indicators.</div>'; return; }
    const evs = this.liq.events.slice(-8).reverse();
    el.innerHTML = `<div class="kv"><span>Order book</span><span class="${L.status === 'live' ? 'u' : 'd'}">${L.status}${L.err ? ' · ' + esc(L.err) : ''}</span></div>
    <div class="kv"><span>Collecting since</span><span>${L.since ? new Date(L.since).toLocaleTimeString([], { hour12: false }) + ' (' + L.snaps + ' snapshots)' : 'n/a'}</span></div>
    <div class="kv"><span>Book covers</span><span>${L.cover ? '-' + L.cover.loPct.toFixed(2) + '% / +' + L.cover.hiPct.toFixed(2) + '%' : 'n/a'}</span></div>
    <div class="kv"><span>Bin size</span><span>${L.bin || 'n/a'}</span></div>
    <div class="kv"><span>Walls pulled as price approached</span><span class="d">${L.pulled}</span></div><div class="kv"><span>Walls cancelled far from price</span><span>${L.cancelled}</span></div><div class="kv"><span>Walls filled by trades</span><span>${L.filled}</span></div><div class="kv"><span>Book resyncs</span><span>${L.resyncs}</span></div>
    <div class="grp">Biggest walls now</div>${L.walls.map(w => `<div class="kv"><span class="${w.side === 'b' ? 'u' : 'd'}">${w.side === 'b' ? 'bid' : 'ask'} ${fmt(w.p, d)}</span><span>${fmtV(w.q)} · ${Math.round(w.age / 1000)}s</span></div>`).join('') || '<div class="note">None above the wall threshold.</div>'}
    <div class="grp">Recent wall events (fade over ~4 min)</div>${evs.map(e => `<div class="kv"><span class="${e.kind === 'pulled' ? 'd' : e.kind === 'filled' ? 'u' : ''}">${e.kind.toUpperCase()} ${e.side === 'b' ? 'bid' : 'ask'} ${fmt(e.p, d)}</span><span style="opacity:${Math.max(.35, this.liq.ghostAlpha(e, now)).toFixed(2)}">${fmtV(e.qty)} · lived ${Math.round(e.life / 1000)}s</span></div>`).join('') || '<div class="note">None yet. History starts when the page opens.</div>'}
    <div class="note">A wall is a bin far above the typical size. "Pulled" means it shrank by 75%+ with little trading at that price while price was within about 0.06% of it. That pattern is typical of spoofing, but the data cannot prove intent. Walls cancelled farther away are ordinary repositioning and only counted. On the chart, pulled walls leave a ghost line that fades.</div>`;
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
  checkEvents() {
    if (this.replay) return; const E = this.state.evAl || {}, c = this.candles, I = this.ict, n = c.length; if (n < 40 || !I) return; const ar = isAr();
    const ek = this.state.symbol + '|' + this.state.tf; let V = this._ev; const first = !V || V.k !== ek; if (first) V = this._ev = { k: ek };
    const fire = (key, en, arx) => { this.toast('🔔 ' + (ar ? arx : en), 12000); this.beep(); try { navigator.vibrate?.([200, 100, 200]); } catch {} try { if (window.Notification && Notification.permission === 'granted') new Notification('TAPE DELTA', { body: (this.state.symbol + ' ' + this.state.tf + ': ') + (ar ? arx : en) }); } catch {} };
    const st = [...I.struct].reverse().find(s => s.kind === 'CHoCH'); const kC = st ? c[st.i2] && c[st.i2].t + ':' + st.dir : null; if (!first && E.choch && kC && kC !== V.choch) fire('choch', `CHoCH ${st.dir === 'bull' ? 'up' : 'down'} (structure change)`, `CHoCH ${st.dir === 'bull' ? 'لأعلى' : 'لأسفل'} (تغيّر في الهيكل)`); V.choch = kC;
    const sw = I.sweeps[I.sweeps.length - 1]; const kS = sw && c[sw.i] ? c[sw.i].t + ':' + sw.type : null; if (!first && E.sweep && kS && kS !== V.sweep) fire('sweep', `${sw.type === 'L' ? 'Sell-side' : 'Buy-side'} liquidity swept at ${fmt(sw.p, decimals(sw.p))}`, `سيولة ${sw.type === 'L' ? 'جهة البيع' : 'جهة الشراء'} اتكسرت عند ${fmt(sw.p, decimals(sw.p))}`); V.sweep = kS;
    const a1 = c[n - 2], a0 = c[n - 3]; const kD = a1.t + ':' + Math.sign(a1.d); const flip = a1.v > 0 && Math.sign(a1.d) !== Math.sign(a0.d) && Math.abs(a1.d) >= 0.1 * a1.v; if (!first && E.delta && flip && kD !== V.delta) fire('delta', `Delta flipped ${a1.d > 0 ? 'positive' : 'negative'} on the last closed candle`, `الدلتا انقلبت ${a1.d > 0 ? 'موجبة' : 'سالبة'} في آخر شمعة مقفولة`); V.delta = kD;
    const L = this.levels, px = this.price, pp = this.prevPrice; if (L && px != null && pp != null) { const day = Math.floor(Date.now() / 864e5); V.t = V.t || {}; for (const [nm, v] of [['PDH', L.pdh], ['PDL', L.pdl], ['D.OPEN', L.dOpen], ['W.OPEN', L.wOpen]]) { if (v == null) continue; const kk = nm + day; if (!first && E.touch && !V.t[kk] && ((pp < v && px >= v) || (pp > v && px <= v))) { V.t[kk] = 1; fire('touch', `Price touched ${nm} ${fmt(v, decimals(v))}`, `السعر لمس ${nm} عند ${fmt(v, decimals(v))}`); } } }
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
    if (t === 'avwap') { (this.state.avwaps[this.state.symbol] ||= []).push({ t: s.t, id: uid() }); this.save(); this.setTool('cursor'); this.toast('Anchored VWAP added at ' + new Date(s.t).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })); }
    else if (t === 'hline') { this.addDrawing({ type: 'hline', pts: [s] }); this.setTool('cursor'); }
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
    const el = $('#pane-tape'); const rp = this.replay; const tape = rp ? (rp.cur != null ? this.replayTape() : null) : this.tape; if (rp && !tape) { el.innerHTML = '<div class="note">Replay is in candle mode, so there is no tape. Switch the replay step to 1s, 5s or 15s to replay real trades.</div>'; return; } const T = tape; if (!T.length) { el.innerHTML = '<div class="note">Waiting for trades from the exchange feed...</div>'; return; }
    const d = decimals(T[0].p); const big = T.map(t => t.q).sort((a, b) => b - a)[Math.floor(T.length * 0.15)] || 0;
    el.innerHTML = T.map(t => `<div class="trow ${t.side}${t.q >= big && big > 0 ? ' big' : ''}"><span>${new Date(t.t).toLocaleTimeString([], { hour12: false })}</span><span>${fmt(t.p, d)}</span><span>${fmtV(t.q)}</span></div>`).join('');
  }
  renderDom() {
    const el = $('#pane-dom'); let dp = this.depth; const rp = this.replay;
    if (rp) { if (rp.cur == null) { el.innerHTML = '<div class="note">Replay is in candle mode, so there is no order book. Switch the replay step to 1s, 5s or 15s.</div>'; return; } dp = this.replayBook(); if (!dp) { el.innerHTML = '<div class="note">No order book was recorded for this moment. Binance does not publish historical depth, so only moments since this page opened can be replayed. Tap "Book" in the replay bar to jump to the first recorded moment.</div>'; return; } }
    if (!dp) { el.innerHTML = '<div class="note">Loading order book...</div>'; return; }
    const d = decimals(dp.asks[0][0]); const asks = dp.asks.slice(0, 14); let cum = 0; const rows = asks.map(a => { cum += a[1]; return [a[0], a[1], cum]; }); const mx = rows[rows.length - 1][2];
    const ah = rows.slice().reverse().map(r => `<div class="dr ask"><i style="width:${r[2] / mx * 100}%"></i><span class="p">${fmt(r[0], d)}</span><span>${fmtV(r[1])}</span><span>${fmtV(r[2])}</span></div>`).join('');
    cum = 0; const bids = dp.bids.slice(0, 14).map(b => { cum += b[1]; return [b[0], b[1], cum]; }); const mb = Math.max(mx, bids[bids.length - 1][2]);
    const bh = bids.map(r => `<div class="dr bid"><i style="width:${r[2] / mb * 100}%"></i><span class="p">${fmt(r[0], d)}</span><span>${fmtV(r[1])}</span><span>${fmtV(r[2])}</span></div>`).join('');
    const sp = dp.asks[0][0] - dp.bids[0][0]; const imb = bids[bids.length - 1][2] / (bids[bids.length - 1][2] + mx) * 100;
    el.innerHTML = `<div class="note">${rp ? 'REPLAY book from ' + new Date(dp.t).toLocaleTimeString([], { hour12: false }) + ' (recorded, bins of ' + this.liq.bin + ') · ' : ''}Price · size · cumulative (14 levels)</div><div class="dom">${ah}<div class="spread">spread ${fmt(sp, d)} · bid share ${imb.toFixed(0)}%</div>${bh}</div>`;
  }
  renderStats() {
    const el = $('#pane-stats'); if (!el) return; const c = this.candles, last = c[c.length - 1]; const t = this.ticker, d = last ? decimals(last.c) : 2;
    let cvd = 0; for (const b of c) cvd += b.d; const kv = (a, b, cls = '') => `<div class="kv"><span>${a}</span><span class="${cls}">${b}</span></div>`;
    el.innerHTML = (last ? kv('Last', fmt(this.price ?? last.c, d)) : '') + (t ? kv('24h change', (t.chg >= 0 ? '+' : '') + t.chg.toFixed(2) + '%', t.chg >= 0 ? 'u' : 'd') + kv('24h high / low', fmt(t.hi, d) + ' / ' + fmt(t.lo, d)) + kv('24h volume', fmtV(t.vol)) : '') +
      (last ? kv('Candle delta', (last.d >= 0 ? '+' : '') + fmtV(last.d), last.d >= 0 ? 'u' : 'd') + kv('Candle buy / sell', fmtV(last.bv) + ' / ' + fmtV(last.sv)) + kv('CVD (loaded bars)', fmtV(cvd), cvd >= 0 ? 'u' : 'd') : '') +
      (this.extras ? kv('Mark', this.extras.mark ? fmt(this.extras.mark, d) : 'n/a') + kv('Funding (8h)', this.extras.funding != null ? (this.extras.funding * 100).toFixed(4) + '%' : 'n/a') + kv('Open interest', this.extras.oi != null ? fmtV(this.extras.oi) : 'n/a') : '') +
      kv('Source', this.src ? this.src.label : 'none') + kv('Ticks in memory', [...this.ticks.values()].reduce((a, e) => a + e.arr.length, 0).toLocaleString()) + kv('Footprint step', this.fpStep ? this.fpStep : 'n/a') +
      `<div class="note">Delta = taker buy volume minus taker sell volume, from the exchange. ${this.src && this.src.key === 'spot' ? 'Spot feed active: futures-only fields (mark, funding, open interest) are not available.' : ''} Footprint ticks load per candle when you zoom in; a candle with too many trades is labelled instead of faked.</div>`;
  }
  renderAlerts() {
    const el = $('#pane-alerts'); const p = this.price, d = p ? decimals(p) : 2;
    const mine = this.state.alerts;
    el.innerHTML = `<div class="grp">New alert · ${this.state.symbol}</div><div class="row"><input type="number" id="alLevel" step="any" placeholder="Price" value="${p ? p.toFixed(d) : ''}" inputmode="decimal"><select id="alDir"><option value="auto">Cross (auto)</option><option value="up">Cross up</option><option value="down">Cross down</option></select><button class="btn" id="alAdd">Add</button></div><div id="alMsg"></div>
    <div class="grp">Active (${mine.length})</div>` + (mine.length ? mine.map(a => `<div class="alrow"><span>${a.sym} ${a.dir === 'up' ? '≥ cross up' : '≤ cross down'} <b>${fmt(a.level, decimals(a.level))}</b></span><button class="btn" data-del="${a.id}">✕</button></div>`).join('') : '<div class="note">No alerts. They fire once when price crosses the level, even for other symbols (checked every 10 s) while the app is open.</div>');
    { const E = this.state.evAl || (this.state.evAl = {}); const ar = isAr(); const row = (k, en, arx) => `<label class="chk"><input type="checkbox" data-ev="${k}" ${E[k] ? 'checked' : ''}> ${ar ? arx : en}</label>`;
      el.insertAdjacentHTML('beforeend', `<div class="grp" data-noi18n>${ar ? 'تنبيهات الأحداث (للرمز والفريم الحاليين)' : 'Event alerts (current symbol and timeframe)'}</div>${row('choch', 'CHoCH (structure change)', 'CHoCH (تغيّر الهيكل)')}${row('sweep', 'Liquidity sweep', 'كسر سيولة')}${row('delta', 'Delta flip on a closed candle', 'انقلاب الدلتا في شمعة مقفولة')}${row('touch', 'Touch PDH / PDL / day open / week open', 'لمس PDH / PDL / فتح اليوم / فتح الأسبوع')}<div class="note" data-noi18n>${ar ? 'التنبيهات بتشتغل وبتنبهك (صوت + اهتزاز + إشعار) والصفحة مفتوحة بس. لو قفلت التطبيق مش هتوصلك، لأن مفيش سيرفر. كل تنبيه بيشتغل مرة لكل حدث.' : 'Alerts (sound, vibration, notification) work only while the page is open. They cannot reach you when the app is closed, because there is no server. Each event fires once.'}</div>`);
      el.querySelectorAll('[data-ev]').forEach(i => i.onchange = () => { E[i.dataset.ev] = i.checked; this.save(); if (i.checked && window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); }); }
    $('#alAdd').onclick = () => { const r = this.addAlert(parseFloat($('#alLevel').value), $('#alDir').value); const m = $('#alMsg'); if (r.err) m.innerHTML = `<div class="msg err">${esc(r.err)}</div>`; else if (r.warn) { m.innerHTML = `<div class="msg warn">${esc(r.warn)}</div>`; } };
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { this.state.alerts = this.state.alerts.filter(a => a.id !== b.dataset.del); this.save(); this.renderAlerts(); this.chart.invalidate(); });
  }
  // ---------- replay ----------
  startReplay() {
    if (this.replay || this.candles.length < 80) return; const n = this.candles.length; this.replay = { idx: n - 60, playing: false, saved: this.chart.snapshot(), t: null, cur: null, step: 0 };
    $('#replaybar').hidden = false; $('#rpMode').value = '0'; const sl = $('#rpSlider'); sl.min = 50; sl.max = n - 1; sl.value = this.replay.idx; this.chart.cache = {}; this.chart.view.right = this.replay.idx + 6; this.replayUpdate(); $('#bRep').classList.add('on');
  }
  partialCandle(i, cur) {
    const c = this.candles[i]; const e = this.ticks.get(c.t); if (!e) return null; let p = null, h = c.o, l = c.o, v = 0, bv = 0, n = 0, last = c.o;
    for (const t of e.arr) { if (t[4] > cur) break; n++; v += t[1]; if (t[2]) bv += t[1]; if (t[0] > h) h = t[0]; if (t[0] < l) l = t[0]; last = t[0]; }
    return { t: c.t, o: c.o, h, l, c: last, v, bv, sv: v - bv, d: 2 * bv - v, n, closed: false };
  }
  ticksUpTo(ct) { const e = this.ticks.get(ct); if (!e) return []; const r = this.replay; if (r && r.cur != null && this.candles[r.idx] && this.candles[r.idx].t === ct) return e.arr.filter(t => t[4] <= r.cur); return e.arr; }
  replayTape() {
    const r = this.replay; const out = []; for (let i = r.idx; i >= Math.max(0, r.idx - 2) && out.length < 40; i--) { const arr = this.ticksUpTo(this.candles[i].t); for (let k = arr.length - 1; k >= 0 && out.length < 40; k--) if (i < r.idx || arr[k][4] <= r.cur) out.push({ id: arr[k][3], t: arr[k][4], p: arr[k][0], q: arr[k][1], side: arr[k][2] ? 'buy' : 'sell' }); }
    return out;
  }
  replayBook() {
    const r = this.replay; if (!r || r.cur == null) return null; let best = null; for (const sn of this.liq.snaps) if (!best || Math.abs(sn.t - r.cur) < Math.abs(best.t - r.cur)) best = sn; if (!best || Math.abs(best.t - r.cur) > 6000) return null;
    const bin = this.liq.bin, mid = best.mid; const asks = best.A.map(([k, q]) => [(k + 0.5) * bin, q]).filter(x => x[0] > mid).sort((a, b) => a[0] - b[0]); const bids = best.B.map(([k, q]) => [(k + 0.5) * bin, q]).filter(x => x[0] < mid).sort((a, b) => b[0] - a[0]);
    return asks.length && bids.length ? { bids, asks, t: best.t } : null;
  }
  replayUpdate() {
    const r = this.replay; if (!r) return; const base = this.candles.slice(0, r.idx + (r.cur == null ? 1 : 0)); if (r.cur != null) { const pc = this.partialCandle(r.idx, r.cur); base.push(pc || { ...this.candles[r.idx], h: this.candles[r.idx].o, l: this.candles[r.idx].o, c: this.candles[r.idx].o, v: 0, bv: 0, sv: 0, d: 0 }); } r.vis = base;
    const tm = r.cur != null ? ' ' + new Date(r.cur).toLocaleTimeString([], { hour12: false }) : '';
    $('#rpInfo').textContent = `${r.idx + 1}/${this.candles.length}${tm}`; $('#rpSlider').value = r.idx; $('#rpPlay').textContent = r.playing ? 'Pause' : 'Play'; this.chart.cache = {}; this.recomputeICT(true); this.updateLegend(null); this.renderTape(); this.renderDom(); this.chart.invalidate();
  }
  followReplay() { const ch = this.chart, r = this.replay; const x = ch.xOf(r.idx); if (x > ch.plotW - 6 || x < 20) ch.view.right = r.idx + (ch.view.barW >= 40 ? 1.2 : 6); }
  replayStep() {
    const r = this.replay; if (!r) return;
    if (r.step > 0) {
      const ct = this.candles[r.idx].t, tf = this.tfMs(), e = this.ticks.get(ct); if (!e || e.status === 'loading' || e.status === 'live' || e.status === 'error') { this.ensureTicks(ct); this.chart.invalidate(); return; }
      if (e.status === 'skipped') { this.toast('Too many trades in this candle to replay on a phone. Use candle mode.'); this.replayPause(); return; }
      r.cur = (r.cur ?? ct) + r.step; if (r.cur > Date.now()) { r.cur = Date.now(); this.replayPause(); }
      if (r.cur >= ct + tf) { if (r.idx >= this.candles.length - 1) { this.replayPause(); return; } r.idx++; r.cur = this.candles[r.idx].t; this.ensureTicks(r.cur); if (r.idx + 1 < this.candles.length) this.ensureTicks(this.candles[r.idx + 1].t); }
      this.followReplay(); this.replayUpdate(); return;
    }
    if (r.idx >= this.candles.length - 1) { this.replayPause(); return; } r.idx++; this.followReplay(); this.replayUpdate();
  }
  replayMode(step) { const r = this.replay; if (!r) return; r.step = step; if (step > 0) { r.cur = this.candles[r.idx].t; this.ensureTicks(r.cur); } else r.cur = null; this.replayUpdate(); }
  replayBookJump() {
    if (!this.liq.snaps.length) { this.toast('No order book recorded yet. Wait a few seconds after the page opens.'); return; } if (!this.replay) this.startReplay(); const r = this.replay; if (!r) return; this.replayPause();
    const t0 = this.liq.snaps[0].t, tf = this.tfMs(); const i = this.candles.findIndex(c => c.t <= t0 && t0 < c.t + tf); if (i < 0) return; r.idx = i; r.step = 1000; $('#rpMode').value = '1000'; r.cur = t0; this.ensureTicks(this.candles[i].t); this.chart.view.right = i + (this.chart.view.barW >= 40 ? 1.2 : 6); $('#rpSlider').max = this.candles.length - 1; this.replayUpdate(); this.toast('Replaying from the first recorded order book moment.');
  }
  replayPause() { const r = this.replay; if (!r) return; r.playing = false; clearInterval(r.t); this.replayUpdate(); }
  replayPlay() { const r = this.replay; if (!r) return; if (r.playing) return this.replayPause(); r.playing = true; r.t = setInterval(() => this.replayStep(), +$('#rpSpeed').value); this.replayUpdate(); }
  exitReplay() { const r = this.replay; if (!r) return; clearInterval(r.t); this.replay = null; this.renderTape(); this.renderDom(); $('#replaybar').hidden = true; $('#bRep').classList.remove('on'); this.chart.restore(r.saved); this.chart.cache = {}; this.recomputeICT(true); this.updateLegend(null); }
  // ---------- UI ----------
  buildUI() {
    const sym = $('#sym'); sym.innerHTML = SYMBOLS.map(s => `<option value="${s.id}">${s.id} · ${s.name}</option>`).join(''); sym.value = this.state.symbol;
    sym.onchange = () => { this.exitReplay(); this.state.symbol = sym.value; this.save(); this.selDraw = null; this.load(); this.renderAlerts(); };
    const tfs = $('#tfs'); tfs.innerHTML = Object.keys(TFS).map(t => `<button data-tf="${t}">${t}</button>`).join('');
    tfs.onclick = e => { const t = e.target.dataset.tf; if (!t) return; this.exitReplay(); this.state.tf = t; this.save(); this.renderTf(); this.load(); this.renderIndCounts(); };
    this.renderTf();
    $('#ctype').value = this.state.chartType; $('#ctype').onchange = e => { this.state.chartType = e.target.value; this.save(); if (e.target.value === 'footprint') { this.chart.view.barW = Math.max(this.chart.view.barW, 76); this.chart.invalidate(); } this.chart.invalidate(); };
    $('#bPlan').onclick = () => this.openPlanner(); $('#bInd').onclick = () => this.openIndicators(); $('#bWs').onclick = () => this.openWorkspace();
    $('#bRep').onclick = () => this.replay ? this.exitReplay() : this.startReplay();
    $('#rpPlay').onclick = () => this.replayPlay(); $('#rpStep').onclick = () => { this.replayPause(); this.replayStep(); }; $('#rpExit').onclick = () => this.exitReplay();
    $('#rpMode').onchange = e => this.replayMode(+e.target.value); $('#rpBook').onclick = () => this.replayBookJump();
    $('#rpSlider').oninput = e => { this.replayPause(); this.replay.idx = +e.target.value; if (this.replay.step > 0) { this.replay.cur = this.candles[this.replay.idx].t; this.ensureTicks(this.replay.cur); } this.chart.view.right = this.replay.idx + 6; this.replayUpdate(); };
    $('#rpSpeed').onchange = () => { if (this.replay?.playing) { this.replayPause(); this.replayPlay(); } };
    const tzb = $('#bTz'); tzb.textContent = this.state.tz === 'UTC' ? 'UTC' : 'Local'; tzb.onclick = () => { this.state.tz = this.state.tz === 'UTC' ? 'local' : 'UTC'; tzb.textContent = this.state.tz === 'UTC' ? 'UTC' : 'Local'; this.save(); this.chart.invalidate(); };
    $('#bHelp').onclick = () => { const t = document.querySelector('#tabs button.on'); $('#sheetT').textContent = isAr() ? 'شرح' : 'Guide'; $('#sheetB').innerHTML = helpHTML(t && t.dataset.t); $('#sheet').hidden = false; };
    $('#bSet').onclick = () => { const draw = () => { $('#sheetT').textContent = 'Settings'; $('#sheetB').innerHTML = settingsHTML(this.state); $('#sheetB').querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); draw(); this.renderFeed(); this.renderAll && this.renderAll(); }); const cd = $('#setCd'); if (cd) cd.onchange = () => { this.state.countdown = cd.checked; this.save(); this.chart.invalidate(); }; }; draw(); $('#sheet').hidden = false; };
    $('#bTheme').onclick = () => { this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark'; this.save(); this.applyTheme(); };
    $('#bSide').onclick = () => $('#side').classList.toggle('open');
    $('#tabs').onclick = e => { const t = e.target.dataset.t; if (!t) return; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); document.querySelectorAll('.pane').forEach(p => p.hidden = p.id !== 'pane-' + t); if (t === 'dom') this.pollDepth(); if (t === 'alerts') this.renderAlerts(); if (t === 'stats') this.renderStats(); if (t === 'gold') this.renderGold(); if (t === 'ai') this.renderAI(); if (t === 'bt') this.renderBT(); if (t === 'mag') this.renderMag(); if (t === 'reg') this.renderReg(); if (t === 'wy') this.renderWy(); if (t === 'mtf') this.renderMTF(); if (t === 'diag') { this.renderDiag(); if (!this.diagRows) this.runDiag(); } if (t === 'why') this.renderWhy(); if (t === 'data') this.renderData(); if (t === 'liq') this.renderLiq(); };
    this.openTab = t => $('#tabs button[data-t=' + t + ']').click(); $('#feed').onclick = () => { $('#side').classList.add('open'); this.openTab('diag'); }; $('#chip').onclick = () => { $('#side').classList.add('open'); this.openTab('why'); };
    $('#sheetX').onclick = () => $('#sheet').hidden = true; $('#sheet').onclick = e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };
    addEventListener('keydown', e => { if (e.key === 'Escape') { $('#sheet').hidden = true; if (this.state.tool !== 'cursor') this.setTool('cursor'); } });
    this.renderTools(); this.renderAlerts(); this.renderTape();
  }
  renderTf() { document.querySelectorAll('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.tf === this.state.tf)); }
  renderTools() {
    const T = [['cursor', '⌖', 'Cursor'], ['avwap', 'A', 'Anchored VWAP: tap a candle'], ['hline', '―', 'Horizontal line'], ['trend', '╱', 'Trend line'], ['rect', '▭', 'Rectangle'], ['text', 'T', 'Text'], ['brush', '✎', 'Brush'], ['measure', '↔', 'Measure'], ['eraser', '⌫', 'Eraser'], ['clear', '🗑', 'Clear all drawings on this symbol']];
    $('#tools').innerHTML = T.map(([id, ic, t]) => `<button data-tool="${id}" title="${t}" aria-label="${t}" class="${this.state.tool === id ? 'on' : ''}">${ic}</button>`).join('');
    $('#tools').onclick = e => { const id = e.target.closest('button')?.dataset.tool; if (!id) return; if (id === 'clear') { if (this.drawingsFor().length && confirm('Delete all drawings on ' + this.state.symbol + '?')) { this.state.drawings[this.state.symbol] = []; this.save(); this.chart.invalidate(); } return; } this.setTool(id); };
  }
  ictCounts() { const i = this.ict; return i ? { fvg: i.fvg.length, ob: i.ob.length, liq: i.liq.length + i.eq.length, struct: i.struct.length, kill: i.kill.length, sessions: i.levels.length, pd: i.pd ? 1 : 0, ote: i.ote ? 1 : 0 } : {}; }
  renderIndCounts() { if (!$('#sheet').hidden && this._sheet === 'ind') this.openIndicators(true); }
  openIndicators(keep) {
    this._sheet = 'ind'; const s = this.state, cnt = this.ictCounts(); const chk = (grp, key, label, extra = '', off = false) => `<label class="chk${off ? ' off' : ''}"><input type="checkbox" data-g="${grp}" data-k="${key}" ${s[grp][key] ? 'checked' : ''}> ${label}<em>${extra}</em></label>`;
    const intraday = TFS[s.tf] <= 3600e3; const n = k => s.ind.ict && cnt[k] !== undefined ? (cnt[k] ? cnt[k] + ' in range' : 'none in range') : '';
    $('#sheetT').textContent = 'Indicators'; $('#sheetB').innerHTML =
      `<div class="grp">Order flow panes</div>${chk('ind', 'delta', 'Delta per candle')}${chk('ind', 'scvd', 'Session CVD (resets Asia / London / NY)', intraday ? '' : 'needs 1h or lower', !intraday)}${chk('ind', 'cvd', 'CVD (from first loaded bar)')}${chk('ind', 'rsi', 'RSI 14 (Wilder)')}
      <div class="grp">Liquidity and anchored VWAP</div>${chk('ind', 'liq', 'Liquidity map (live order book heatmap + pulled walls)')}${chk('ind', 'avwapAuto', 'Auto AVWAP from last swing high and low')}${chk('ind', 'flowsig', 'Order-flow signals: ABS absorption, EXH exhaustion, RUN stop run')}${chk('ind', 'vp', 'Volume profile: POC / VAH / VAL (approximate, from 1m candles)')}<div class="row"><select id="vpMode"><option value="session">Profile: current session</option><option value="day">Profile: day (UTC)</option><option value="week">Profile: week (from Monday UTC)</option></select></div>${chk('ind', 'gold', 'Gold pack on chart: ATR levels + fix times (PAXG / XAU only)', this.isGold() ? '' : 'gold symbols only', !this.isGold())}
      ${(s.avwaps[s.symbol] || []).map(a => `<div class="alrow"><span>AVWAP anchored ${new Date(a.t).toLocaleString([], { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><button class="btn" data-avrm="${a.id}">✕</button></div>`).join('') || '<div class="note">Tap the A tool, then a candle, to anchor a VWAP there.</div>'}
      <div class="grp">Gold lines (XAUUSDT / PAXGUSDT)</div>${chk('ind', 'goldAtr', 'Daily ATR lines (ATR +0.5 / +1 / -0.5 / -1)', this.isGold() ? '' : 'gold symbols only', !this.isGold())}${chk('ind', 'goldTimes', 'Session / news time lines (COMEX settle, London open, LBMA fix)', this.isGold() ? (intraday ? '' : 'needs 1h or lower') : 'gold symbols only', !this.isGold() || !intraday)}
      ${chk('ind', 'magnet', 'Liquidity magnet lines (nearest above / below, score)')}
      ${chk('ind', 'regime', 'Regime tag on chart (trend / range / transition)')}
      ${chk('ind', 'wyckoff', 'Wyckoff range box + Spring / UTAD mark')}
      <div class="grp">Overlays</div>${chk('ind', 'ema9', 'EMA 9')}${chk('ind', 'ema21', 'EMA 21')}${chk('ind', 'ema50', 'EMA 50')}${chk('ind', 'ema200', 'EMA 200')}${chk('ind', 'vwap', 'VWAP (daily UTC reset)')}${chk('ind', 'vwapBands', 'VWAP + 1 / 2 SD bands (volume-weighted, daily UTC reset)')}
      <div class="grp">ICT / SMC (master switch)</div>${chk('ind', 'ict', 'Show ICT / SMC layers', 'master')}
      <div class="note">Each layer below works on its own. The master switch hides all of them, and the boxes stay ticked.</div>
      ${chk('ict', 'fvg', 'Fair value gaps (unfilled)', n('fvg'))}${chk('ict', 'ob', 'Order blocks (unmitigated)', n('ob'))}${chk('ict', 'liq', 'BSL / SSL, EQH / EQL, sweeps', n('liq'))}${chk('ict', 'struct', 'BOS / CHoCH + HH HL LH LL', n('struct'))}
      ${chk('ict', 'kill', 'Killzones (Asia / London / NY AM)', intraday ? n('kill') : 'needs 1h or lower', !intraday)}${chk('ict', 'sessions', 'PDH / PDL / day open / week open', n('sessions'))}${chk('ict', 'pd', 'Premium / Discount + EQ 50%', n('pd'))}${chk('ict', 'ote', 'OTE zone (62 to 79%)', n('ote'))}
      <label class="chk"><input type="checkbox" id="zoneAl" ${s.zoneAlerts ? 'checked' : ''}> Zone alerts (only for layers shown)</label>
      <div class="row"><button class="btn" id="icReset">Reset ICT layers</button></div>`;
    $('#sheet').hidden = false;
    { const vm = $('#vpMode'); if (vm) { vm.value = this.state.vpMode || 'day'; vm.onchange = () => { this.state.vpMode = vm.value; this.save(); this.loadVP(true); }; } }
    $('#sheetB').querySelectorAll('input[data-g]').forEach(i => i.onchange = () => { s[i.dataset.g][i.dataset.k] = i.checked; this.save(); this.recomputeICT(true); this.chart.cache = {}; this.chart.invalidate(); if (i.dataset.k === 'vp') this.loadVP(true); if (i.dataset.k === 'ict') this.openIndicators(true); if (i.dataset.k === 'liq') { if (i.checked && this.src) this.liq.start(this.src, s.symbol); else this.liq.stop(); this.renderLiq(); } });
    $('#sheetB').querySelectorAll('[data-avrm]').forEach(b => b.onclick = () => { s.avwaps[s.symbol] = (s.avwaps[s.symbol] || []).filter(a => a.id !== b.dataset.avrm); this.save(); this.chart.invalidate(); this.openIndicators(true); });
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
