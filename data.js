// TAPE DELTA data layer. Real exchange data only. No synthetic fallback.
export const SYMBOLS = [
  { id: 'BTCUSDT', name: 'Bitcoin', kinds: ['fut', 'spot'] },
  { id: 'ETHUSDT', name: 'Ethereum', kinds: ['fut', 'spot'] },
  { id: 'SOLUSDT', name: 'Solana', kinds: ['fut', 'spot'] },
  { id: 'BNBUSDT', name: 'BNB', kinds: ['fut', 'spot'] },
  { id: 'XRPUSDT', name: 'XRP', kinds: ['fut', 'spot'] },
  { id: 'PAXGUSDT', name: 'Gold token (PAXG)', kinds: ['fut', 'spot'] },
  { id: 'XAUUSDT', name: 'Gold (XAU perp)', kinds: ['fut'] },
  { id: 'DOGEUSDT', name: 'Dogecoin', kinds: ['spot'], group: 'more' },
  { id: 'ADAUSDT', name: 'Cardano', kinds: ['spot'], group: 'more' },
  { id: 'AVAXUSDT', name: 'Avalanche', kinds: ['spot'], group: 'more' },
  { id: 'LINKUSDT', name: 'Chainlink', kinds: ['spot'], group: 'more' },
  { id: 'DOTUSDT', name: 'Polkadot', kinds: ['spot'], group: 'more' },
  { id: 'TRXUSDT', name: 'TRON', kinds: ['spot'], group: 'more' },
  { id: 'LTCUSDT', name: 'Litecoin', kinds: ['spot'], group: 'more' },
  { id: 'BCHUSDT', name: 'Bitcoin Cash', kinds: ['spot'], group: 'more' },
  { id: 'NEARUSDT', name: 'NEAR', kinds: ['spot'], group: 'more' },
  { id: 'ATOMUSDT', name: 'Cosmos', kinds: ['spot'], group: 'more' },
  { id: 'UNIUSDT', name: 'Uniswap', kinds: ['spot'], group: 'more' },
  { id: 'ARBUSDT', name: 'Arbitrum', kinds: ['spot'], group: 'more' },
  { id: 'OPUSDT', name: 'Optimism', kinds: ['spot'], group: 'more' },
  { id: 'SUIUSDT', name: 'Sui', kinds: ['spot'], group: 'more' },
  { id: 'APTUSDT', name: 'Aptos', kinds: ['spot'], group: 'more' },
  { id: 'INJUSDT', name: 'Injective', kinds: ['spot'], group: 'more' },
  { id: 'TONUSDT', name: 'Toncoin', kinds: ['spot'], group: 'more' },
  { id: 'SHIBUSDT', name: 'Shiba Inu', kinds: ['spot'], group: 'more' },
  { id: 'PEPEUSDT', name: 'Pepe', kinds: ['spot'], group: 'more' },
  { id: 'FILUSDT', name: 'Filecoin', kinds: ['spot'], group: 'more' },
  { id: 'ETCUSDT', name: 'Ethereum Classic', kinds: ['spot'], group: 'more' },
  { id: 'XLMUSDT', name: 'Stellar', kinds: ['spot'], group: 'more' },
  { id: 'HBARUSDT', name: 'Hedera', kinds: ['spot'], group: 'more' },
  { id: 'AAVEUSDT', name: 'Aave', kinds: ['spot'], group: 'more' },
  { id: 'POLUSDT', name: 'Polygon (POL)', kinds: ['spot'], group: 'more' },
  { id: 'RUNEUSDT', name: 'THORChain', kinds: ['spot'], group: 'more' },
  { id: 'TIAUSDT', name: 'Celestia', kinds: ['spot'], group: 'more' },
  { id: 'SEIUSDT', name: 'Sei', kinds: ['spot'], group: 'more' },
  { id: 'WLDUSDT', name: 'Worldcoin', kinds: ['spot'], group: 'more' },
  { id: 'FETUSDT', name: 'Fetch.ai', kinds: ['spot'], group: 'more' },
  { id: 'RENDERUSDT', name: 'Render', kinds: ['spot'], group: 'more' },
  { id: 'TAOUSDT', name: 'Bittensor', kinds: ['spot'], group: 'more' },
  { id: 'ENAUSDT', name: 'Ethena', kinds: ['spot'], group: 'more' },
  { id: 'ONDOUSDT', name: 'Ondo', kinds: ['spot'], group: 'more' },
  { id: 'JUPUSDT', name: 'Jupiter', kinds: ['spot'], group: 'more' },
  { id: 'WIFUSDT', name: 'dogwifhat', kinds: ['spot'], group: 'more' },
  { id: 'BONKUSDT', name: 'Bonk', kinds: ['spot'], group: 'more' },
  { id: 'ICPUSDT', name: 'Internet Computer', kinds: ['spot'], group: 'more' },
  { id: 'ALGOUSDT', name: 'Algorand', kinds: ['spot'], group: 'more' },
  { id: 'VETUSDT', name: 'VeChain', kinds: ['spot'], group: 'more' },
  { id: 'MKRUSDT', name: 'Maker', kinds: ['spot'], group: 'more' },
  { id: 'CRVUSDT', name: 'Curve', kinds: ['spot'], group: 'more' },
  { id: 'LDOUSDT', name: 'Lido DAO', kinds: ['spot'], group: 'more' },
  { id: 'IMXUSDT', name: 'Immutable', kinds: ['spot'], group: 'more' },
  { id: 'STXUSDT', name: 'Stacks', kinds: ['spot'], group: 'more' },
];
export const TFS = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3, '1d': 864e5, '1w': 6048e5 };
export const SRC = {
  fut: { key: 'fut', label: 'Binance Futures', rest: 'https://fapi.binance.com/fapi/v1', ws: ['wss://fstream.binance.com/stream'] },
  spot: { key: 'spot', label: 'Binance Spot', rest: 'https://api.binance.com/api/v3', rests: ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3'], ws: ['wss://stream.binance.com:443/stream', 'wss://stream.binance.com:9443/stream', 'wss://data-stream.binance.vision/stream'] },
};

async function jget(url, ms = 7000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const resolved = new Map(); // symbol -> source
export function parseKline(k) {
  const v = +k[5], bv = +k[9];
  return { t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v, bv, sv: v - bv, d: 2 * bv - v, n: k[8] };
}
export async function resolveSource(sym, force = false) {
  if (!force && resolved.has(sym)) return resolved.get(sym);
  const info = SYMBOLS.find(s => s.id === sym) || { kinds: ['fut', 'spot'] };
  const errs = [];
  for (const kind of info.kinds) {
    const src = SRC[kind];
    for (const base of (src.rests || [src.rest])) {
      for (let at = 0; at < (kind === 'fut' ? 2 : 1); at++) { // futures REST can be slow on mobile networks: one patient retry before falling back to spot
        try {
          const k = await jget(`${base}/klines?symbol=${sym}&interval=1m&limit=2`, kind === 'fut' ? 10000 : 6000);
          if (Array.isArray(k) && k.length) { src.rest = base; resolved.set(sym, src); return src; }
        } catch (e) { if (at) errs.push(`${src.label} (${base.split('/')[2]}): ${e.message}`); }
      }
    }
  }
  const err = new Error('No live feed reachable for ' + sym + ' (' + errs.join('; ') + ')');
  err.tried = errs; throw err;
}
export async function fetchKlines(src, sym, tf, limit = 700, endTime) {
  let u = `${src.rest}/klines?symbol=${sym}&interval=${tf}&limit=${limit}`;
  if (endTime) u += `&endTime=${endTime}`;
  return (await jget(u, 10000)).map(parseKline);
}
export async function fetchKlinesFrom(src, sym, tf, startTime, limit = 1000) { return (await jget(`${src.rest}/klines?symbol=${sym}&interval=${tf}&startTime=${startTime}&limit=${limit}`, 10000)).map(parseKline); }
export async function fetchTrades(src, sym, limit = 1000, endTime) {
  let u = `${src.rest}/aggTrades?symbol=${sym}&limit=${limit}`;
  if (endTime) u += `&endTime=${endTime}`;
  return (await jget(u, 10000)).map(parseTrade);
}
// All aggregated trades whose time falls inside [t0, t1]. Pages by id. Returns ticks [price, qty, isBuy, id] and whether it reached the end.
export async function fetchTickWindow(src, sym, t0, t1, maxPages = 30) {
  const out = []; let u = `${src.rest}/aggTrades?symbol=${sym}&startTime=${t0}&endTime=${t1}&limit=1000`; let complete = false;
  for (let p = 0; p < maxPages; p++) {
    const a = await jget(u, 10000); for (const x of a) { if (x.T > t1) { complete = true; break; } out.push([+x.p, +x.q, x.m ? 0 : 1, x.a, x.T]); }
    if (complete || a.length < 1000) { complete = true; break; }
    u = `${src.rest}/aggTrades?symbol=${sym}&fromId=${a[a.length - 1].a + 1}&limit=1000`;
  }
  return { ticks: out, complete };
}
export async function fetchAggFrom(src, sym, fromId) { return (await jget(`${src.rest}/aggTrades?symbol=${sym}&fromId=${fromId}&limit=1000`, 6000)).map(parseTrade); }
export function parseTrade(a) { return { id: a.a, t: a.T, p: +a.p, q: +a.q, side: a.m ? 'sell' : 'buy' }; }
export async function fetchDepth(src, sym) {
  const d = await jget(`${src.rest}/depth?symbol=${sym}&limit=20`, 5000);
  return { bids: d.bids.map(x => [+x[0], +x[1]]), asks: d.asks.map(x => [+x[0], +x[1]]) };
}
export async function fetchTicker(src, sym) {
  const d = await jget(`${src.rest}/ticker/24hr?symbol=${sym}`, 6000);
  return { last: +d.lastPrice, chg: +d.priceChangePercent, hi: +d.highPrice, lo: +d.lowPrice, vol: +d.volume, qvol: +d.quoteVolume };
}
export async function fetchPrice(src, sym) {
  const d = await jget(`${src.rest}/ticker/price?symbol=${sym}`, 6000);
  return +d.price;
}
export async function fetchFutExtras(sym) { // futures only: funding, OI, mark
  const [p, oi] = await Promise.allSettled([
    jget(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${sym}`, 5000),
    jget(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}`, 5000)]);
  return {
    mark: p.status === 'fulfilled' ? +p.value.markPrice : null,
    funding: p.status === 'fulfilled' ? +p.value.lastFundingRate : null,
    oi: oi.status === 'fulfilled' ? +oi.value.openInterest : null,
  };
}

// Live stream with reconnect, host fallback and staleness detection.
export class Feed {
  constructor(handlers) { this.h = handlers; this.ws = null; this.alive = false; this.retry = 0; this.hostIdx = 0; this.last = 0; this.timer = null; this.closed = false; }
  open(src, sym, tf) {
    this.close(); this.closed = false;
    this.src = src; this.sym = sym; this.tf = tf; this.hostIdx = 0; this.retry = 0;
    const ls = (k, v) => { try { return v === undefined ? JSON.parse(localStorage.getItem(k) || 'null') : localStorage.setItem(k, JSON.stringify(v)); } catch { return null; } };
    this.ls = ls; const good = ls('td_wsgood_' + src.key), fails = ls('td_wsfail') || {}, now = Date.now();
    let hs = src.ws.slice(); if (good && hs.includes(good)) hs = [good, ...hs.filter(x => x !== good)];
    const fresh = hs.filter(h => !(fails[h] && now - fails[h] < 600000)); this.hosts = fresh.length ? fresh : hs;
    this._connect();
    this.watch = setInterval(() => {
      if (this.closed) return;
      if (this.alive && Date.now() - this.last > 90000) { this.h.status('stale'); try { this.ws.close(); } catch {} }
    }, 5000);
  }
  _connect() {
    const hosts = this.hosts; const host = hosts[this.hostIdx % hosts.length];
    const s = this.sym.toLowerCase();
    const url = `${host}?streams=${s}@kline_${this.tf}/${s}@aggTrade`;
    this.h.status('connecting');
    let ws; try { ws = new WebSocket(url); } catch (e) { return this._retry(); }
    this.ws = ws; this.host = host.replace('wss://', '').replace('/stream', ''); let opened = false; const ct = setTimeout(() => { if (!opened) { try { ws.close(); } catch {} } }, 4500);
    ws.onopen = () => { opened = true; clearTimeout(ct); this.ls('td_wsgood_' + this.src.key, host); const f = this.ls('td_wsfail') || {}; delete f[host]; this.ls('td_wsfail', f); this.alive = true; this.retry = 0; this.last = Date.now(); this.h.status('live'); };
    ws.onmessage = ev => {
      this.last = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const d = m.data; if (!d) return; if (d.E) this.skew = Date.now() - d.E;
      if (d.e === 'kline') { const k = d.k; this.h.kline({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, bv: +k.V, sv: +k.v - +k.V, d: 2 * +k.V - +k.v, n: k.n, closed: k.x }); }
      else if (d.e === 'aggTrade') this.h.trade({ id: d.a, t: d.T, p: +d.p, q: +d.q, side: d.m ? 'sell' : 'buy' });
    };
    ws.onclose = () => { clearTimeout(ct); this.alive = false; if (this.closed || ws !== this.ws) return; if (!opened) { this.hostIdx++; const f = this.ls('td_wsfail') || {}; f[host] = Date.now(); this.ls('td_wsfail', f); } this._retry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  _retry() {
    if (this.closed) return;
    this.h.status('reconnecting');
    const n = this.retry++; const wait = n < this.hosts.length ? 400 : Math.min(60000, 10000 * (n - this.hosts.length + 1)); // one quick pass over the hosts, then 10s, 20s ... up to 60s: gentle on battery while REST carries, and it keeps trying to upgrade back to the websocket
    this.timer = setTimeout(() => this._connect(), wait);
  }
  close() { this.closed = true; this.alive = false; clearTimeout(this.timer); clearInterval(this.watch); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch {} } }
}

// Diagnostics: which hosts this device can reach. Every row is a real test from this browser.
const tget = async (url, ms = 6000) => { const t0 = performance.now(); const ac = new AbortController(); const to = setTimeout(() => ac.abort(), ms); try { const r = await fetch(url, { signal: ac.signal }); const ok = r.ok; await r.text(); return { ok, ms: Math.round(performance.now() - t0), note: ok ? '' : 'HTTP ' + r.status }; } catch (e) { return { ok: false, ms: Math.round(performance.now() - t0), note: e.name === 'AbortError' ? 'timeout ' + ms / 1000 + 's' : 'blocked / unreachable' }; } finally { clearTimeout(to); } };
const twss = (url, sub, ms = 7000) => new Promise(res => { const t0 = performance.now(); let ws, done = false, tOpen = null; const fin = (ok, note) => { if (done) return; done = true; clearTimeout(to); try { ws.close(); } catch {} res({ ok, ms: Math.round(performance.now() - t0), note }); }; const to = setTimeout(() => fin(false, tOpen ? 'opened ' + tOpen + 'ms, no data in ' + ms / 1000 + 's' : 'timeout, never opened'), ms); try { ws = new WebSocket(url); } catch { return fin(false, 'cannot create'); } ws.onopen = () => { tOpen = Math.round(performance.now() - t0); if (sub) ws.send(JSON.stringify(sub)); }; ws.onmessage = ev => { let ok = true, note = 'open ' + tOpen + 'ms, first data'; if (sub) { try { const m = JSON.parse(ev.data); if (m.op === 'subscribe') { ok = m.success !== false; note = ok ? 'open ' + tOpen + 'ms, subscribed' : 'subscribe refused'; } else if (m.topic) { note = 'open ' + tOpen + 'ms, data'; } else return; } catch { return; } } fin(ok, note); }; ws.onerror = () => fin(false, tOpen ? 'error after open' : 'blocked / refused'); ws.onclose = () => fin(false, tOpen ? 'closed after open' : 'blocked / refused'); });
export const DIAG_TESTS = [
  { g: 'REST', n: 'api.binance.com', f: () => tget('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT') },
  { g: 'REST', n: 'data-api.binance.vision', f: () => tget('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT') },
  { g: 'REST', n: 'fapi.binance.com (futures)', f: () => tget('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT') },
  { g: 'REST', n: 'api.bybit.com', f: () => tget('https://api.bybit.com/v5/market/time') },
  { g: 'WS', n: 'stream.binance.com:443', f: () => twss('wss://stream.binance.com:443/ws/btcusdt@aggTrade') },
  { g: 'WS', n: 'stream.binance.com:9443', f: () => twss('wss://stream.binance.com:9443/ws/btcusdt@aggTrade') },
  { g: 'WS', n: 'data-stream.binance.vision', f: () => twss('wss://data-stream.binance.vision/ws/btcusdt@aggTrade') },
  { g: 'WS', n: 'fstream.binance.com (futures)', f: () => twss('wss://fstream.binance.com/ws/btcusdt@aggTrade') },
  { g: 'WS', n: 'stream.bybit.com spot', f: () => twss('wss://stream.bybit.com/v5/public/spot', { op: 'subscribe', args: ['publicTrade.BTCUSDT'] }) },
];

// All Binance Spot USDT pairs (symbol list only, ~60 KB). REAL list from the exchange, used by the symbol search.
export async function fetchUsdtPairs() { const a = await jget('https://data-api.binance.vision/api/v3/ticker/price', 12000); return a.map(x => x.symbol).filter(s => /USDT$/.test(s) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(s)).sort(); }
