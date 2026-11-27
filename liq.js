// Liquidity map from the real Binance order book (snapshot + diff stream, kept in sync by update ids).
// History only exists from when the page was opened. Wall "pulled" tags are a heuristic and are labelled as such.
const nice = step => { const e = Math.pow(10, Math.floor(Math.log10(step))); const f = step / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; };
const TAU = 240e3; // spoof-ghost decay constant, ms
export class LiqMap {
  constructor(onChange) {
    this.cb = onChange || (() => {}); this.reset(); this.ws = null; this.timer = null; this.snapT = null;
  }
  reset() {
    this.bids = new Map(); this.asks = new Map(); this.snaps = []; this.events = []; this.walls = new Map(); this.win = new Map();
    this.ready = false; this.status = 'off'; this.lastU = 0; this.buf = []; this.resyncs = 0; this.since = null; this.cover = null; this.bin = 0; this.err = null; this.gen = (this.gen || 0) + 1;
  }
  stop() { this.reset(); clearInterval(this.snapT); clearTimeout(this.timer); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch {} } this.status = 'off'; }
  start(src, sym) {
    this.stop(); this.src = src; this.sym = sym; const g = this.gen; this.status = 'connecting';
    this.mode = 'ws'; const host = src.ws[(this.wsIdx || 0) % src.ws.length], s = sym.toLowerCase(); this.host = host; const suffix = src.key === 'fut' ? '@depth@500ms' : '@depth@1000ms';
    let ws; try { ws = new WebSocket(`${host}?streams=${s}${suffix}`); } catch (e) { this.status = 'error'; this.err = e.message; return; }
    this.ws = ws;
    ws.onmessage = ev => { if (g !== this.gen) return; let m; try { m = JSON.parse(ev.data).data; } catch { return; } if (!m || m.e !== 'depthUpdate') return; this.onDiff(m, g); };
    ws.onclose = () => { if (g !== this.gen || !this.ws) return; this.wsIdx = (this.wsIdx || 0) + 1; this.closes = (this.closes || 0) + 1; this.ready = false; this.status = 'reconnecting'; this.timer = setTimeout(() => { if (g === this.gen) this.start(this.src, this.sym); }, 3000); this.cb(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    this.sync(g);
    this.snapT = setInterval(() => this.snapshot(), 2000);
  }
  async sync(g) {
    this.ready = false; this.status = 'syncing'; this.cb();
    try {
      await new Promise(r => setTimeout(r, 600));
      const lim = this.lim || (this.src.key === 'spot' ? 5000 : 1000);
      const r = await fetch(`${this.src.rest}/depth?symbol=${this.sym}&limit=${lim}`); if (!r.ok) throw new Error('HTTP ' + r.status); const d = await r.json(); if (g !== this.gen) return;
      this.edge = { lo: Math.min(...d.bids.map(x => +x[0])), hi: Math.max(...d.asks.map(x => +x[0])) }; this.bids = new Map(d.bids.map(x => [+x[0], +x[1]])); this.asks = new Map(d.asks.map(x => [+x[0], +x[1]])); this.lastU = d.lastUpdateId;
      const pend = this.buf; this.buf = []; this.first = true; this.ready = true; this.status = 'live'; if (!this.since) this.since = Date.now();
      for (const m of pend) this.onDiff(m, g);
    } catch (e) { if (g !== this.gen) return; this.status = 'error'; this.err = e.message; this.cb(); this.timer = setTimeout(() => { if (g === this.gen) this.sync(g); }, 8000); }
  }
  onDiff(m, g) {
    if (!this.ready) { this.buf.push(m); if (this.buf.length > 500) this.buf.shift(); return; }
    if (m.u <= this.lastU) return;
    const prevFinal = m.pu; // futures carry pu; spot uses U contiguity
    if (this.first) { if (m.U > this.lastU + 1) { this.resync(g); return; } this.first = false; }
    else if (prevFinal !== undefined ? prevFinal !== this.lastU : m.U !== this.lastU + 1) { this.resync(g); return; }
    for (const [p, q] of m.b) { const k = +p, v = +q; if (v === 0) this.bids.delete(k); else this.bids.set(k, v); }
    for (const [p, q] of m.a) { const k = +p, v = +q; if (v === 0) this.asks.delete(k); else this.asks.set(k, v); }
    this.lastU = m.u; this.lastEvT = m.E;
  }
  startRest(src, sym, limit = 500) { // REST-only fallback: full book every 2 s, no diff stream
    this.stop(); this.src = src; this.sym = sym; const g = this.gen; this.mode = 'rest'; this.status = 'connecting'; this.cb();
    const tick = async () => { try { const r = await fetch(src.kind === 'okx' ? `${src.rest}/books?instId=${sym}&sz=${limit}` : `${src.rest}/depth?symbol=${sym}&limit=${limit}`); if (!r.ok) throw new Error('HTTP ' + r.status); let d = await r.json(); if (src.kind === 'okx') { if (d.code !== '0' || !d.data || !d.data[0]) throw new Error('OKX: ' + (d.msg || 'no data for ' + sym)); d = d.data[0]; } if (g !== this.gen) return; this.edge = { lo: Math.min(...d.bids.map(x => +x[0])), hi: Math.max(...d.asks.map(x => +x[0])) }; this.bids = new Map(d.bids.map(x => [+x[0], +x[1]])); this.asks = new Map(d.asks.map(x => [+x[0], +x[1]])); this.ready = true; if (!this.since) this.since = Date.now(); this.snapshot(); } catch (e) { if (g !== this.gen) return; this.status = 'error'; this.err = e.message; this.cb(); } };
    tick(); this.snapT = setInterval(tick, 2000);
  }
  resync(g) { this.resyncs++; this.ready = false; this.buf = []; this.sync(g); }
  addTrade(t) { if (!this.bin) return; const k = Math.floor(t.p / this.bin); const w = this.win.get(k) || [0, 0]; w[t.side === 'buy' ? 1 : 0] += t.q; this.win.set(k, w); }
  best() { let b = -Infinity, a = Infinity; for (const p of this.bids.keys()) if (p > b) b = p; for (const p of this.asks.keys()) if (p < a) a = p; return [b, a]; }
  snapshot() {
    if (!this.ready || !this.bids.size || !this.asks.size) return; const now = Date.now(); const [bb, ba] = this.best(); if (!isFinite(bb) || !isFinite(ba)) return; const mid = (bb + ba) / 2;
    if (!this.bin) this.bin = nice(mid * 0.00004); const bin = this.bin;
    const R = mid * 0.03; const agg = m => { const o = new Map(); for (const [p, q] of m) { if (Math.abs(p - mid) > R) continue; const k = Math.floor(p / bin); o.set(k, (o.get(k) || 0) + q); } return o; };
    const B = agg(this.bids), A = agg(this.asks);
    const lo = this.edge ? this.edge.lo : mid, hi = this.edge ? this.edge.hi : mid; // coverage = edges of the last full snapshot (levels beyond are only partly known)
    this.cover = { lo, hi, loPct: (mid - lo) / mid * 100, hiPct: (hi - mid) / mid * 100 };
    const near = [...B, ...A].filter(([k]) => Math.abs((k + 0.5) * bin - mid) <= mid * 0.015).map(x => x[1]).sort((x, y) => x - y); const med = near[near.length >> 1] || 0, p97 = near[Math.floor(near.length * 0.97)] || 0; const p99 = near[Math.floor(near.length * 0.99)] || 0; const big = Math.max(med * 10, p99, 1e-9);
    // wall tracking
    const prevT = this.snaps.length ? this.snaps[this.snaps.length - 1].t : now - 2000;
    const upd = (side, M) => {
      for (const [k, q] of M) { if (q >= big && Math.abs((k + 0.5) * bin - mid) <= mid * 0.015) { const key = side + k; const w = this.walls.get(key); if (!w) this.walls.set(key, { side, k, t0: now, peak: q, q, seen: now }); else { w.peak = Math.max(w.peak, q); w.q = q; w.seen = now; } } }
      for (const [key, w] of this.walls) {
        if (w.side !== side) continue; const q = M.get(w.k) || 0;
        if (q < w.peak * 0.25 && w.seen !== now) {
          this.walls.delete(key); if (now - w.t0 < 5000) continue;
          const tr = this.win.get(w.k) || [0, 0]; const hit = side === 'b' ? tr[0] : tr[1]; const gone = w.peak - q;
          const dist = Math.abs((w.k + 0.5) * bin - mid) / mid;
          const kind = hit >= gone * 0.4 ? 'filled' : dist < 0.0006 ? 'pulled' : 'cancelled';
          this.events.push({ t: now, side, p: (w.k + 0.5) * bin, qty: w.peak, life: now - w.t0, kind }); if (this.events.length > 300) this.events.shift();
        } else if (q >= big) w.seen = now; else if (q >= w.peak * 0.25) w.seen = now;
      }
    };
    upd('b', B); upd('a', A); this.win = new Map();
    const top = (M, dir) => [...M].filter(([k]) => true).sort((x, y) => dir * (y[0] - x[0])).slice(0, 400);
    this.snaps.push({ t: now, mid, B: [...B].filter(x => x[1] > 0), A: [...A].filter(x => x[1] > 0), big }); if (this.snaps.length > 1000) this.snaps.shift();
    this.status = 'live'; this.cb();
  }
  stats() {
    const e = this.events, now = Date.now();
    return { status: this.status, err: this.err, snaps: this.snaps.length, since: this.since, cover: this.cover, bin: this.bin, resyncs: this.resyncs,
      pulled: e.filter(x => x.kind === 'pulled').length, cancelled: e.filter(x => x.kind === 'cancelled').length, filled: e.filter(x => x.kind === 'filled').length,
      walls: [...this.walls.values()].map(w => ({ side: w.side, p: (w.k + 0.5) * this.bin, q: w.q, age: now - w.t0 })).sort((a, b) => b.q - a.q).slice(0, 6) };
  }
  ghostAlpha(ev, now) { return Math.exp(-(now - ev.t) / TAU); }
}
