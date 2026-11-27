// Bookmap tab: live resting-order heatmap + real trade bubbles + CVD, crypto only (Binance Spot).
// Resting orders (REAL): the Binance Spot order book, recorded one column every 2 s while this page is open. No history exists before that.
// Depth coverage is PARTIAL: Binance only exposes a band around the price (see the coverage chip). Trades (REAL): Binance aggTrades.
// Readings are plain descriptions of what is on screen right now. They are observations, not predictions and not advice.
import { LiqMap } from './liq.js';
import { SYMBOLS } from './data.js';
import { isAr } from './i18n.js';

const SRC = { key: 'spot', label: 'Binance Spot', rest: 'https://data-api.binance.vision/api/v3', ws: ['wss://data-stream.binance.vision/stream', 'wss://stream.binance.com:443/stream', 'wss://stream.binance.com:9443/stream'] };
const $ = s => document.querySelector(s);
const fmt = (v, d = 2) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toLocaleString('en-US', { maximumFractionDigits: d });
const clock = t => new Date(t).toLocaleTimeString([], { hour12: false });
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const decs = p => p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : 6;

const T = {
  title: ['Bookmap', 'بوك ماب'], close: ['Back to chart', 'رجوع للشارت'],
  rec: ['recording since', 'بيسجل من'], cover: ['depth band', 'نطاق العمق'],
  wsMode: ['WS', 'WS'], restMode: ['REST 2s (WS unavailable)', 'REST كل 2 ثانية (الـWS مش شغال)'], conn: ['connecting…', 'بيتصل…'],
  keyBid: ['resting BUY orders', 'أوامر شراء واقفة'], keyAsk: ['resting SELL orders', 'أوامر بيع واقفة'], keyBuy: ['market buy trade', 'صفقة شراء بالسوق'], keySell: ['market sell trade', 'صفقة بيع بالسوق'], keyLine: ['mid price', 'سعر المنتصف'], keyInt: ['darker = bigger size', 'أغمق = حجم أكبر'],
  real: ['REAL: Binance Spot book, this exchange only', 'حقيقي: دفتر Binance Spot، البورصة دي بس'], partial: ['PARTIAL: only a band around price', 'جزئي: نطاق حوالين السعر بس'], tradesReal: ['REAL: actual trades', 'حقيقي: صفقات فعلية'],
  empty: ['Recording just started. The map fills in every 2 seconds. There is no history before you opened this page.', 'التسجيل لسه بادي. الخريطة بتتملي كل ثانيتين. مفيش تاريخ قبل ما فتحت الصفحة.'],
  cvdT: ['CVD (net market buying since recording)', 'CVD (صافي الشراء بالسوق من بداية التسجيل)'],
  tapHint: ['Tap the map, a bubble or a key item for an explanation.', 'اضغط على الخريطة أو فقاعة أو عنصر في المفتاح للشرح.']
};

export class Bookmap {
  constructor(app) {
    this.app = app; this.wm = 15; this.rp = 0.0025; this.sym = null; this.open_ = false; this.lm = null; this.trades = []; this.cvd = []; this.cum = 0; this.dirty = true; this.lastDraw = 0;
    this.hits = []; this.ws2 = null; this.tmode = 'ws'; this.lastAgg = 0; this.tws = 0; this._buildUI();
  }
  L(k) { return T[k][isAr() ? 1 : 0]; }
  _buildUI() {
    const el = $('#bm'); this.el = el; this.cv = $('#bmCv'); this.g = this.cv.getContext('2d');
    $('#bmX').onclick = () => this.close();
    $('#bmSym').onchange = e => this.start(e.target.value);
    el.querySelectorAll('[data-wm]').forEach(b => b.onclick = () => { this.wm = +b.dataset.wm; this._ctl(); this.dirty = true; this.draw(); });
    el.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => { this.rp = +b.dataset.rp; this._ctl(); this.dirty = true; this.draw(); });
    el.querySelectorAll('[data-key]').forEach(b => b.onclick = () => this.explain(b.dataset.key));
    let down = null;
    this.cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    this.cv.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) { const r = this.cv.getBoundingClientRect(); this.tap(e.clientX - r.left, e.clientY - r.top); } down = null; });
    new ResizeObserver(() => { this.dirty = true; this.draw(); }).observe($('#bmWrap'));
  }
  _ctl() { this.el.querySelectorAll('[data-wm]').forEach(b => b.classList.toggle('on', +b.dataset.wm === this.wm)); this.el.querySelectorAll('[data-rp]').forEach(b => b.classList.toggle('on', +b.dataset.rp === this.rp)); }
  _labels() {
    const ar = isAr(); $('#bmT').textContent = this.L('title'); $('#bmX').textContent = this.L('close');
    $('#bmKey').innerHTML = `<button class="bmk" data-key="bid"><i style="background:#26e6a0"></i>${this.L('keyBid')}</button><button class="bmk" data-key="ask"><i style="background:#ff5a44"></i>${this.L('keyAsk')}</button><button class="bmk" data-key="buy"><i class="ring" style="border-color:#26e6a0"></i>${this.L('keyBuy')}</button><button class="bmk" data-key="sell"><i class="ring" style="border-color:#ff5a44"></i>${this.L('keySell')}</button><button class="bmk" data-key="line"><i style="background:#e8f1ff;height:2px"></i>${this.L('keyLine')}</button><button class="bmk" data-key="int"><i class="grad"></i>${this.L('keyInt')}</button>`;
    $('#bmKey').querySelectorAll('[data-key]').forEach(b => b.onclick = () => this.explain(b.dataset.key));
    $('#bmLbl').innerHTML = `<span class="bmc ok">${this.L('real')}</span><span class="bmc part">${this.L('partial')}</span><span class="bmc ok">${this.L('tradesReal')}</span>`;
    $('#bmHint').textContent = this.L('tapHint'); this.el.dir = ar ? 'rtl' : 'ltr';
  }
  cryptoList() { return SYMBOLS.filter(s => s.kinds && s.kinds.includes('spot')); }
  open() {
    this.open_ = true; this.el.hidden = false; this._labels(); this._ctl();
    const sel = $('#bmSym'); sel.innerHTML = this.cryptoList().map(s => `<option value="${s.id}">${s.id}</option>`).join('');
    const cur = this.app.state.symbol, ok = this.cryptoList().some(s => s.id === cur); const sym = this.sym || (ok ? cur : 'BTCUSDT'); sel.value = sym;
    if (!this.lm || this.sym !== sym) this.start(sym); this.loop();
  }
  close() { this.open_ = false; this.el.hidden = true; this.stop(); }
  stop() { clearInterval(this._tm); if (this.lm) { this.lm.stop(); this.lm = null; } this._stopTrades(); this.sym = null; }
  start(sym) {
    this.stop(); this.sym = sym; this.trades = []; this.cvd = []; this.cum = 0; this.t0 = Date.now(); this.dirty = true; this.lastAgg = 0;
    const lm = new LiqMap(() => { this.dirty = true; }); lm.lim = 1000; lm.wsIdx = 0; lm.closes = 0; this.lm = lm; this.fellBack = false; lm.start(SRC, sym); this._startTrades(sym); this.loop();
  }
  loop() {
    clearInterval(this._tm);
    this._tm = setInterval(() => {
      if (!this.open_ || !this.lm) return; const lm = this.lm, age = Date.now() - this.t0;
      if (!this.fellBack && lm.mode === 'ws' && ((lm.status !== 'live' && age > 14000) || (lm.closes || 0) >= 3)) { this.fellBack = true; lm.startRest(SRC, this.sym, 500); }
      if (this.tmode === 'ws' && this.tws === 0 && age > 9000) this._tradesRest();
      if (this.dirty || Date.now() - this.lastDraw > 2000) this.draw();
    }, 700);
  }
  /* ---------- trades ---------- */
  _addTrade(a, p, q, T, m) { if (a <= this.lastAgg) return; this.lastAgg = a; if (T < this.t0 - 1500 && this.tmode === 'rest') return; const buy = !m; this.trades.push({ t: T, p, q, buy }); this.cum += buy ? q : -q; this.cvd.push([T, this.cum]); const cut = Date.now() - 35 * 60e3; while (this.trades.length && this.trades[0].t < cut) { this.trades.shift(); this.cvd.shift(); } this.dirty = true; }
  _startTrades(sym) {
    this.tmode = 'ws'; this.tws = 0; this.tIdx = 0; const g = this.tgen = (this.tgen || 0) + 1; const s = sym.toLowerCase();
    const dial = () => {
      if (g !== this.tgen || this.tmode !== 'ws') return; let w; try { w = new WebSocket(`${SRC.ws[this.tIdx % SRC.ws.length]}?streams=${s}@aggTrade`); } catch { return; } this.ws2 = w;
      w.onmessage = ev => { let d; try { d = JSON.parse(ev.data).data; } catch { return; } if (!d || d.e !== 'aggTrade') return; this.tws++; this._addTrade(d.a, +d.p, +d.q, d.T, d.m); };
      w.onclose = () => { if (g !== this.tgen || this.tmode !== 'ws') return; this.tIdx++; if (this.tIdx >= 6) { this._tradesRest(); return; } setTimeout(dial, 2000); };
      w.onerror = () => { try { w.close(); } catch { } };
    }; dial();
  }
  _tradesRest() {
    if (this.tmode === 'rest') return; this.tmode = 'rest'; try { this.ws2 && this.ws2.close(); } catch { } const g = this.tgen, sym = this.sym;
    const tick = async () => { if (g !== this.tgen || this.tmode !== 'rest') return; try { const r = await fetch(`${SRC.rest}/aggTrades?symbol=${sym}&limit=500`); if (!r.ok) return; const d = await r.json(); if (g !== this.tgen) return; for (const x of d) this._addTrade(x.a, +x.p, +x.q, x.T, x.m); } catch { } };
    tick(); this._tt = setInterval(() => { if (g !== this.tgen || this.tmode !== 'rest') { clearInterval(this._tt); return; } tick(); }, 2000);
  }
  _stopTrades() { this.tgen = (this.tgen || 0) + 1; clearInterval(this._tt); try { this.ws2 && this.ws2.close(); } catch { } this.ws2 = null; }
  /* ---------- drawing ---------- */
  geom() { const W = this.W, H = this.H, axisH = 16, cvdH = Math.round(H * 0.17), heatH = H - cvdH - axisH - 4; return { W, H, axisH, cvdH, heatH, plotW: W - 54 }; }
  draw() {
    this.lastDraw = Date.now(); this.dirty = false; const wrap = $('#bmWrap'), dpr = Math.min(2, window.devicePixelRatio || 1); const cw = wrap.clientWidth, ch = wrap.clientHeight; if (!cw || !ch) return;
    if (this.cv.width !== Math.round(cw * dpr) || this.cv.height !== Math.round(ch * dpr)) { this.cv.width = Math.round(cw * dpr); this.cv.height = Math.round(ch * dpr); this.cv.style.width = cw + 'px'; this.cv.style.height = ch + 'px'; }
    this.W = cw; this.H = ch; const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#080b12'; g.fillRect(0, 0, cw, ch); this.hits = [];
    const lm = this.lm; this._chips(); this._readings();
    const S = lm ? lm.snaps : []; const geo = this.geom(), { plotW, heatH, cvdH, axisH } = geo;
    if (!S.length) { g.fillStyle = '#a9bbd6'; g.font = '13px system-ui'; g.textAlign = 'center'; const msg = (lm && lm.err) ? ((isAr() ? 'خطأ: ' : 'Error: ') + lm.err) : this.L('empty'); wrapText(g, msg, cw / 2, ch / 2 - 10, cw - 40, 18); return; }
    const last = S[S.length - 1], mid = last.mid, now = Date.now(), wMs = this.wm * 60e3, tS = now - wMs, lo = mid * (1 - this.rp), hi = mid * (1 + this.rp), bin = lm.bin;
    this.v = { tS, wMs, lo, hi, plotW, heatH, bin, S };
    const X = t => (t - tS) / wMs * plotW, Y = p => (hi - p) / (hi - lo) * heatH;
    // scale from visible sizes
    const vis = []; for (let i = S.length - 1; i >= 0 && S[i].t >= tS - 2000; i--) { const s = S[i]; for (const a of s.B) { const p = (a[0] + .5) * bin; if (p >= lo && p <= hi) vis.push(a[1]); } for (const a of s.A) { const p = (a[0] + .5) * bin; if (p >= lo && p <= hi) vis.push(a[1]); } }
    vis.sort((a, b) => a - b); const ref = vis.length ? Math.max(vis[Math.floor(vis.length * 0.995)], 1e-9) : 1; this.ref = ref; const lref = Math.log1p(ref / (vis[Math.floor(vis.length * 0.5)] || ref) * 1);
    const med = vis[Math.floor(vis.length * 0.5)] || ref * 0.01, den = Math.log1p(ref / med);
    const cw2 = Math.max(1, 2000 / wMs * plotW + 0.6), rh = Math.max(1, bin / (hi - lo) * heatH + 0.6);
    g.save(); g.beginPath(); g.rect(0, 0, plotW, heatH); g.clip();
    for (const s of S) { if (s.t < tS - 2000) continue; const x = X(s.t) - cw2; for (let side = 0; side < 2; side++) { const arr = side ? s.A : s.B; const rgb = side ? '255,90,68' : '38,230,160'; for (const a of arr) { const p = (a[0] + .5) * bin; if (p < lo || p > hi) continue; const v = Math.log1p(a[1] / med) / den; if (v < 0.12) continue; const al = Math.min(1, 0.1 + 0.9 * Math.pow(Math.min(1, v), 1.3)); g.fillStyle = `rgba(${rgb},${al.toFixed(2)})`; g.fillRect(x, Y(p + bin / 2), cw2, rh); } } }
    // mid price line
    g.strokeStyle = '#e8f1ff'; g.lineWidth = 1.2; g.beginPath(); let st = false; for (const s of S) { if (s.t < tS - 2000) continue; const x = X(s.t), y = Y(s.mid); if (!st) { g.moveTo(x, y); st = true; } else g.lineTo(x, y); } g.stroke();
    // bubbles
    const tr = this.trades.filter(x => x.t >= tS && x.p >= lo && x.p <= hi); let thr = 0, qmax = 0;
    if (tr.length) { const qs = tr.map(x => x.q).sort((a, b) => a - b); thr = tr.length >= 20 ? qs[Math.floor(qs.length * 0.9)] : 0; qmax = qs[qs.length - 1]; }
    for (const x of tr) { if (x.q < thr) continue; const px = X(x.t), py = Y(x.p), r = 3 + 11 * Math.sqrt(x.q / (qmax || 1)); const c = x.buy ? '38,230,160' : '255,90,68'; g.fillStyle = `rgba(${c},.28)`; g.strokeStyle = `rgba(${c},.95)`; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.stroke(); this.hits.push({ x: px, y: py, r, tr: x }); }
    g.restore();
    // price axis
    g.fillStyle = '#a9bbd6'; g.font = '10px ui-monospace,Menlo,monospace'; g.textAlign = 'left'; const d = decs(mid);
    for (let i = 0; i <= 5; i++) { const p = hi - (hi - lo) * i / 5, y = Y(p); g.strokeStyle = '#ffffff10'; g.beginPath(); g.moveTo(0, y); g.lineTo(plotW, y); g.stroke(); g.fillText(p.toFixed(d), plotW + 3, Math.min(heatH - 2, Math.max(9, y + 3))); }
    const ym = Y(mid); g.fillStyle = '#e8f1ff'; g.fillRect(plotW, ym - 7, 54, 14); g.fillStyle = '#080b12'; g.fillText(mid.toFixed(d), plotW + 3, ym + 3);
    // CVD pane
    const cy0 = heatH + 4; g.fillStyle = '#0c1018'; g.fillRect(0, cy0, plotW, cvdH); g.fillStyle = '#a9bbd6'; g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(this.L('cvdT'), 4, cy0 + 11);
    const cv = this.cvd.filter(x => x[0] >= tS - 2000); if (cv.length > 1) { let mn = Infinity, mx = -Infinity; for (const x of cv) { if (x[1] < mn) mn = x[1]; if (x[1] > mx) mx = x[1]; } if (mx - mn < 1e-9) mx = mn + 1e-9; g.strokeStyle = '#f2c14e'; g.lineWidth = 1.4; g.beginPath(); cv.forEach((x, i) => { const px = X(x[0]), py = cy0 + cvdH - 4 - (x[1] - mn) / (mx - mn) * (cvdH - 20); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); g.textAlign = 'left'; g.fillStyle = '#f2c14e'; g.fillText((this.cum >= 0 ? '+' : '') + fmt(this.cum, 3), plotW + 3, cy0 + 12); }
    // time axis
    g.fillStyle = '#a9bbd6'; g.textAlign = 'center'; g.font = '10px system-ui'; const ty = heatH + 4 + cvdH + 11; for (let i = 0; i <= 4; i++) { const t = tS + wMs * i / 4; g.fillText(clock(t), Math.min(plotW - 22, Math.max(22, X(t))), ty); }
  }
  _chips() {
    const lm = this.lm; if (!lm) return; const ar = isAr(); let mode;
    if (lm.mode === 'rest') mode = this.L('restMode'); else if (lm.status === 'live') mode = `WS · ${(lm.host || '').replace('wss://', '').split('/')[0]}`; else mode = this.L('conn');
    const tm = this.tmode === 'rest' ? (ar ? 'صفقات REST' : 'trades REST') : (this.tws ? (ar ? 'صفقات WS' : 'trades WS') : (ar ? 'صفقات: بانتظار' : 'trades: waiting'));
    const cov = lm.cover ? `±${Math.max(lm.cover.loPct, lm.cover.hiPct).toFixed(2)}%` : '-';
    $('#bmChips').innerHTML = `<span class="bmc ${lm.status === 'live' ? 'ok' : 'part'}">${esc(mode)}</span><span class="bmc">${esc(tm)}</span><span class="bmc">${this.L('rec')} ${lm.since ? clock(lm.since) : '-'}</span><span class="bmc">${this.L('cover')} ${cov}</span>`;
  }
  _readings() {
    const lm = this.lm, el = $('#bmRead'); const ar = isAr(); const S = lm && lm.snaps; if (!S || !S.length) { el.innerHTML = ''; return; }
    const s = S[S.length - 1], bin = lm.bin, mid = s.mid, R = mid * 0.005; const near = (arr, dir) => arr.map(a => ({ p: (a[0] + .5) * bin, q: a[1] })).filter(x => Math.abs(x.p - mid) <= R && (dir > 0 ? x.p >= mid : x.p <= mid));
    const bids = near(s.B, -1), asks = near(s.A, 1); const sb = bids.reduce((a, x) => a + x.q, 0), sa = asks.reduce((a, x) => a + x.q, 0); const out = [];
    const coin = (this.sym || '').replace(/USDT$/, '');
    if (sb + sa > 0) { const pb = Math.round(sb / (sb + sa) * 100); out.push(ar ? `جوه ±0.5% حوالين السعر: أوامر الشراء الواقفة ${pb}% وأوامر البيع ${100 - pb}% من الحجم.` : `Within ±0.5% of price: resting buy orders are ${pb}% of the size, sell orders ${100 - pb}%.`); }
    const wb = bids.sort((a, b) => b.q - a.q)[0], wa = asks.sort((a, b) => b.q - a.q)[0];
    if (wb) out.push(ar ? `أكبر جدار شراء قريب: ${fmt(wb.q, 3)} ${coin} (≈ $${fmt(wb.q * wb.p)}) عند ${fmt(wb.p, decs(mid))}، تحت السعر بـ${((mid - wb.p) / mid * 100).toFixed(2)}%.` : `Largest nearby buy wall: ${fmt(wb.q, 3)} ${coin} (about $${fmt(wb.q * wb.p)}) at ${fmt(wb.p, decs(mid))}, ${((mid - wb.p) / mid * 100).toFixed(2)}% below price.`);
    if (wa) out.push(ar ? `أكبر جدار بيع قريب: ${fmt(wa.q, 3)} ${coin} (≈ $${fmt(wa.q * wa.p)}) عند ${fmt(wa.p, decs(mid))}، فوق السعر بـ${((wa.p - mid) / mid * 100).toFixed(2)}%.` : `Largest nearby sell wall: ${fmt(wa.q, 3)} ${coin} (about $${fmt(wa.q * wa.p)}) at ${fmt(wa.p, decs(mid))}, ${((wa.p - mid) / mid * 100).toFixed(2)}% above price.`);
    const t60 = this.trades.filter(x => x.t >= Date.now() - 60e3); if (t60.length >= 5) { const b = t60.filter(x => x.buy).reduce((a, x) => a + x.q, 0), sl = t60.reduce((a, x) => a + x.q, 0) - b, pb = Math.round(b / (b + sl) * 100); out.push(ar ? `آخر دقيقة: الشراء بالسوق ${pb}% والبيع بالسوق ${100 - pb}% (${t60.length} صفقة).` : `Last minute: market buying ${pb}%, market selling ${100 - pb}% (${t60.length} trades).`); }
    el.innerHTML = out.map(x => `<div>${esc(x)}</div>`).join('') + `<div class="bmnote">${ar ? 'دي وصف للي ظاهر دلوقتي، مش توقع ومش نصيحة. الأوامر الواقفة ممكن تتسحب في أي لحظة.' : 'These describe what is on screen now. They are not predictions or advice. Resting orders can be pulled at any moment.'}</div>`;
  }
  /* ---------- tap to explain ---------- */
  tap(x, y) {
    if (!this.v) return; let best = null, bd = 1e9; for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d <= h.r + 8 && d < bd) { bd = d; best = h; } }
    if (best) { this.explain('trade', best.tr); return; }
    const v = this.v; if (x > v.plotW || y > v.heatH) return; const t = v.tS + x / v.plotW * v.wMs, p = v.hi - y / v.heatH * (v.hi - v.lo); let s = null, sd = 1e9; for (const q of v.S) { const d = Math.abs(q.t - t); if (d < sd) { sd = d; s = q; } } if (!s || sd > 6000) { this.explain('empty'); return; }
    const k = Math.floor(p / v.bin); const b = s.B.find(a => a[0] === k), a = s.A.find(a => a[0] === k); this.explain('cell', { p: (k + .5) * v.bin, t: s.t, b: b ? b[1] : 0, a: a ? a[1] : 0, mid: s.mid, bin: v.bin });
  }
  explain(kind, o) {
    const ar = isAr(), coin = (this.sym || '').replace(/USDT$/, ''); let title = '', html = ''; const row = (h, b) => `<div class="kv"><span><b>${h}</b></span></div><div style="padding:2px 0 8px">${b}</div>`;
    const caution = c => `<div class="note"><b>${ar ? 'خد بالك' : 'Careful'}:</b> ${c}</div>`;
    if (kind === 'cell') {
      const side = o.b > o.a ? 'bid' : 'ask', q = Math.max(o.a, o.b), d = decs(o.mid);
      title = ar ? 'خلية في الخريطة' : 'Heatmap cell';
      html = row(ar ? 'إيه اللي بتشوفه؟' : 'What you are looking at', ar ? `الساعة ${clock(o.t)} وعند سعر حوالين ${fmt(o.p, d)} (خانة ${fmt(o.bin, d)} دولار): ${q > 0 ? `كان فيه ${fmt(q, 3)} ${coin} (≈ $${fmt(q * o.p)}) أوامر ${side === 'bid' ? 'شراء' : 'بيع'} واقفة.` : 'مفيش أوامر واقفة بحجم يُذكر هنا.'}` : `At ${clock(o.t)} near price ${fmt(o.p, d)} (bucket of ${fmt(o.bin, d)}): ${q > 0 ? `there were ${fmt(q, 3)} ${coin} (about $${fmt(q * o.p)}) of resting ${side === 'bid' ? 'buy' : 'sell'} orders.` : 'no resting orders of note.'}`) +
        row(ar ? 'أقراها إزاي؟' : 'How to read it', ar ? 'الأخضر = أوامر شراء واقفة تحت السعر. الأحمر = أوامر بيع واقفة فوق السعر. اللون الأغمق = حجم أكبر (مقياس لوغاريتمي، يعني الفرق بين الألوان أقل من الفرق الحقيقي في الحجم). الخط الأبيض هو سعر المنتصف.' : 'Green = resting buy orders below price. Red = resting sell orders above price. Darker = bigger size (log scale, so colour differences understate real size differences). The white line is the mid price.') + caution(ar ? 'أوامر واقفة مش صفقات. بتتسحب وتتغير في أي لحظة، وممكن تكون وهمية. الجدار الكبير مش ضمان إن السعر هيقف عنده.' : 'Resting orders are not trades. They can be cancelled at any moment and some are fake. A big wall is not a guarantee that price will stop there.');
    } else if (kind === 'trade') {
      const x = o, d = decs(x.p); title = ar ? 'فقاعة صفقة' : 'Trade bubble';
      html = row(ar ? 'إيه اللي بتشوفه؟' : 'What you are looking at', ar ? `صفقة حقيقية الساعة ${clock(x.t)}: ${x.buy ? 'شراء بالسوق' : 'بيع بالسوق'} حجم ${fmt(x.q, 4)} ${coin} (≈ $${fmt(x.q * x.p)}) بسعر ${fmt(x.p, d)}.` : `A real trade at ${clock(x.t)}: market ${x.buy ? 'buy' : 'sell'} of ${fmt(x.q, 4)} ${coin} (about $${fmt(x.q * x.p)}) at ${fmt(x.p, d)}.`) +
        row(ar ? 'أقراها إزاي؟' : 'How to read it', ar ? 'بنعرض بس أكبر 10% من الصفقات في النافذة (لو فيه 20 صفقة على الأقل). الفقاعة الأكبر = صفقة أكبر. الأخضر = مشتري ضرب السوق، الأحمر = بائع ضرب السوق.' : 'Only the largest 10% of trades in the window are shown (once there are at least 20). Bigger bubble = bigger trade. Green = a buyer hit the market, red = a seller hit the market.') + caution(ar ? 'ده من Binance Spot بس مش السوق كله. الصفقة الكبيرة لوحدها مش دليل اتجاه.' : 'Binance Spot only, not the whole market. One big trade alone is not evidence of direction.');
    } else if (kind === 'empty') { title = ar ? 'مفيش بيانات هنا' : 'No data here'; html = `<div class="note">${ar ? 'مفيش عمود مسجل عند النقطة دي. التسجيل بيبدأ من لحظة فتح الصفحة بس.' : 'No recorded column at this point. Recording only starts when the page is opened.'}</div>`; }
    else {
      const K = {
        bid: [ar ? 'أوامر شراء واقفة' : 'Resting buy orders', ar ? 'لون أخضر: أوامر شراء مستنية في الدفتر تحت السعر الحالي ولسه ماتنفذتش.' : 'Green: buy orders waiting in the book below the current price, not yet executed.'],
        ask: [ar ? 'أوامر بيع واقفة' : 'Resting sell orders', ar ? 'لون أحمر: أوامر بيع مستنية في الدفتر فوق السعر الحالي.' : 'Red: sell orders waiting in the book above the current price.'],
        buy: [ar ? 'صفقة شراء بالسوق' : 'Market buy trade', ar ? 'دايرة خضرا: مشتري أخد أوامر البيع الواقفة فنفذت صفقة فعلية. حجم الدايرة = حجم الصفقة.' : 'Green circle: a buyer took resting sell orders and a real trade happened. Circle size = trade size.'],
        sell: [ar ? 'صفقة بيع بالسوق' : 'Market sell trade', ar ? 'دايرة حمرا: بائع ضرب أوامر الشراء الواقفة فنفذت صفقة فعلية.' : 'Red circle: a seller hit resting buy orders and a real trade happened.'],
        line: [ar ? 'سعر المنتصف' : 'Mid price', ar ? 'الخط الأبيض: منتصف أحسن سعر شراء وأحسن سعر بيع في الدفتر كل ثانيتين.' : 'White line: the midpoint of the best bid and best ask, sampled every 2 seconds.'],
        int: [ar ? 'شدة اللون' : 'Colour intensity', ar ? 'كل ما اللون أغمق الحجم الواقف أكبر، بمقياس لوغاريتمي مضبوط على الأكبر في النافذة الظاهرة. الألوان الباهتة جدًا بتتخفى.' : 'Darker means more size resting, on a log scale set from the largest in the visible window. Very faint levels are hidden.']
      }[kind]; title = K[0]; html = `<div style="padding:4px 0 8px">${K[1]}</div>`;
    }
    html += `<div class="note">${ar ? 'شرح تعليمي مش نصيحة تداول.' : 'Educational only, not trading advice.'}</div>`;
    $('#sheetT').textContent = title; $('#sheetB').innerHTML = html; $('#sheet').hidden = false; this.app._noClose = Date.now() + 900;
  }
}
function wrapText(g, text, x, y, maxW, lh) { const words = text.split(' '); let line = '', yy = y; for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = t; } g.fillText(line, x, yy); }
