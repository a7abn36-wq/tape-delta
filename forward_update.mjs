// Run by GitHub Actions every 4h (and on demand). Append-only log: existing entries are never changed except open -> resolved.
import fs from 'fs';
import { forwardLog, FREEZE_T, SYM, TF, PER } from './forward.js';
const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${SYM}&interval=${TF}&limit=1000`); if (!r.ok) throw new Error('HTTP ' + r.status);
const c = (await r.json()).map(x => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).filter(x => x.t + PER <= Date.now());
const fresh = forwardLog(c, FREEZE_T); let old = { signals: [] }; try { old = JSON.parse(fs.readFileSync('forward_log.json', 'utf8')); } catch (e) { }
const byT = new Map(old.signals.map(s => [s.t, s]));
for (const s of fresh) { const o = byT.get(s.t); if (!o) byT.set(s.t, s); else for (const k of ['r1', 'r2']) if (o[k].o === 'open') o[k] = s[k]; }
const signals = [...byT.values()].sort((a, b) => a.t - b.t);
const out = { symbol: SYM, tf: TF, freeze: FREEZE_T, updated: Date.now(), lastCandleClose: c[c.length - 1].t + PER, signals };
fs.writeFileSync('forward_log.json', JSON.stringify(out, null, 1)); console.log('signals', signals.length, 'last close', new Date(out.lastCandleClose).toISOString());
