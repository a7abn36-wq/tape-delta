// Wolf SK: rule-based marking of the SK System sequence 0-A-B-C (top-down: HTF sequence, M30 entries).
// Same rules as sk2_rules_PREREGISTERED.txt. DERIVED from candles. Not a prediction; our tests found no proven edge.
import { wilderATR } from './ict.js';
export const SK_F = [0.5, 0.559, 0.618, 0.667];
export const SK_ASSUME = [ // every discretionary [CHOICE], listed once, shown in the app
  ['Leg 0-A must be at least 2 x ATR14 of the higher timeframe (ignores noise legs).', 'ساق 0-A لازم تبقى على الأقل 2 × ATR14 للفريم الأعلى (بيتجاهل الحركات الصغيرة).'],
  ['Swings (0, A, B) are HTF fractal pivots, 3 candles each side. They are confirmed only 3 HTF candles after they form, so the sequence is drawn late by design.', 'النقاط (0 و A و B) قمم/قيعان فراكتال على الفريم الأعلى، 3 شموع من كل جهة. بتتأكد بعد 3 شموع HTF فالرسم بيتأخر بالتصميم.'],
  ['Existence: B must retrace at least 38.2% of 0-A and stay above 0.', 'الوجود: B لازم يرجّع 38.2% على الأقل من 0-A ويفضل فوق 0.'],
  ['Entry levels 0.5 / 0.559 / 0.618 / 0.667 of 0-A, each used once. Only levels below the current M30 close are placed.', 'مستويات الدخول 0.5 / 0.559 / 0.618 / 0.667 من 0-A، كل واحد مرة. بس المستويات تحت إغلاق M30 الحالي.'],
  ['E1 (before the break of A): limit orders placed when A is confirmed, cancelled when price trades above A, below 0, or after 384 M30 candles.', 'E1 (قبل كسر A): أوامر limit بتتحط لما A يتأكد، وتتلغي لما السعر يعدي A أو يكسر 0 أو بعد 384 شمعة M30.'],
  ['E2 (re-entry after the break): C = first M30 swing high (3 candles each side) above A. Fib levels are drawn on B-C. Cancel: M30 close below B, below 0, 48 candles, or price reaches B + 100% of 0-A first.', 'E2 (دخول تاني بعد الكسر): C = أول قمة M30 (3 شموع من كل جهة) فوق A. مستويات فيب على B-C. بتتلغي لو M30 قفلت تحت B أو تحت 0 أو بعد 48 شمعة أو السعر وصل B + 100% من 0-A قبل الدخول.'],
  ['Stop: 20 pips = $2.00 on gold (PAXG, 1 pip = $0.10). On other symbols a 20-pip stop is meaningless, so the stop is 1 x ATR14 of M30.', 'الستوب: 20 نقطة = $2.00 على الدهب (PAXG، النقطة = 0.10$). على باقي الرموز الستوب = 1 × ATR14 على M30.'],
  ['Targets: 3R, and 161.8% / 200% extension of 0-A projected from B (E2) or from the entry level (E1, because B does not exist yet).', 'الأهداف: 3R، وامتداد 161.8% / 200% من 0-A محسوب من B (E2) أو من مستوى الدخول (E1 لأن B لسه مش موجود).'],
  ['Stop is checked first if stop and target are both inside one candle. Trades time out after 192 M30 candles.', 'لو الستوب والهدف في نفس الشمعة بنحسب الستوب الأول. الصفقة بتنتهي بعد 192 شمعة M30.'],
  ['NOT coded: weekly/monthly reading, the trader\'s own judgement of valid/invalid sequences, risk 1-3% per day. Only the mechanical part is marked.', 'مش متكود: قراءة الأسبوعي/الشهري وحكم المتداول على صلاحية التسلسل وإدارة المخاطر 1-3% يوميا. بنعلّم الجزء الميكانيكي بس.'],
  ['Source partly read (first pages only), so the rules follow the brief and the pages that could be read.', 'المصدر اتقرا جزء منه بس (أول صفحات)، فالقواعد من الملخص والصفحات اللي اتقرت.']
];
const MH = 192, TTL1 = 384, TTL2 = 48, P30 = 1800e3;
function resample(c, hp) { const out = [], k = hp / P30; let cur = null; for (const x of c) { const b = Math.floor(x.t / hp) * hp; if (!cur || cur.t !== b) { if (cur && cur.n === k) out.push(cur); cur = { t: b, o: x.o, h: x.h, l: x.l, c: x.c, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.n++; } } if (cur && cur.n === k) out.push(cur); return out; }
export function to30(c, tfMs, now) { // chart candles -> closed M30 candles
  let o; if (tfMs === P30) o = c.slice(); else if (tfMs < P30 && P30 % tfMs === 0) { const k = P30 / tfMs; o = []; let cur = null; for (const x of c) { const b = Math.floor(x.t / P30) * P30; if (!cur || cur.t !== b) { if (cur && cur.n === k) o.push(cur); cur = { t: b, o: x.o, h: x.h, l: x.l, c: x.c, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.n++; } } if (cur && cur.n === k) o.push(cur); } else return null;
  while (o.length && o[o.length - 1].t + P30 > now) o.pop(); return o;
}
function piv(c, L) { const n = c.length, P = []; for (let i = L; i < n - L; i++) { let h = true, l = true; for (let k = 1; k <= L; k++) { if (!(c[i].h > c[i - k].h && c[i].h > c[i + k].h)) h = false; if (!(c[i].l < c[i - k].l && c[i].l < c[i + k].l)) l = false; } if (h) P.push({ i, t: 'H', p: c[i].h }); else if (l) P.push({ i, t: 'L', p: c[i].l }); } return P; }
const flip = c => c.map(x => ({ t: x.t, o: -x.o, h: -x.l, l: -x.h, c: -x.c }));
const lowerIdx = (c, t) => { let lo = 0, hi = c.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c[m].t >= t) hi = m; else lo = m + 1; } return lo; };
function resolve(c, fill, entry, sd, tp1, tp2) { // outcome of one filled order (long logic)
  const stop = entry - sd, n = c.length; if (c[fill].l <= stop) return { out: 'SL', j: fill, r: -1 };
  const end = Math.min(n - 1, fill + MH);
  for (let j = fill + 1; j <= end; j++) { if (c[j].l <= stop) return { out: 'SL', j, r: -1 }; if (c[j].h >= tp1) return { out: 'T3R', j, r: 3 }; }
  if (fill + MH > n - 1) return { out: 'OPEN', j: n - 1 };
  return { out: 'TIME', j: end, r: (c[end].c - entry) / sd };
}
// opts: { hp (ms), stopFix (price distance or 0 for ATR), e1, e2 }
export function computeSK(c0, tfMs, opts, now) {
  const hp = opts.hp, c30 = to30(c0, tfMs, now || Date.now()); if (!c30) return { err: 'tf' }; if (c30.length < 200) return { err: 'data', n: c30.length };
  const H0 = resample(c30, hp); if (H0.length < 20) return { err: 'data', n: c30.length };
  const atr = wilderATR(c30), hatr = wilderATR(H0), n = c30.length, seqs = [];
  for (const d of [1, -1]) {
    const c = d > 0 ? c30 : flip(c30), H = d > 0 ? H0 : flip(H0), P = piv(H, 3), px = p => p * d;
    const sdOf = j => opts.stopFix ? opts.stopFix : atr[j];
    const mkFill = (j, pr, mode, tgtBase, leg, extra) => { const sd = sdOf(j - 1), tp1 = pr + 3 * sd, tp2 = tgtBase + 1.618 * leg, tp3 = tgtBase + 2 * leg; const r = resolve(c, j, pr, sd, tp1, tp2); return { t: c30[j].t, j, pr: px(pr), sl: px(pr - sd), t3: px(tp1), t162: px(tp2), t200: px(tp3), sd, out: r.out, tEnd: c30[r.j].t, r: r.r, mode, ...extra }; };
    for (let k = 1; k < P.length; k++) {
      const o = P[k - 1], a = P[k]; if (!(o.t === 'L' && a.t === 'H' && a.p > o.p)) continue; const leg = a.p - o.p; if (leg < 2 * hatr[a.i]) continue;
      const confA = H[a.i + 3] ? H[a.i + 3].t + hp : null; if (!confA) continue; const m0 = lowerIdx(c, confA); if (m0 <= 15 || m0 >= n) continue;
      const S = { d, hp, o: { t: H[o.i].t, p: px(o.p) }, a: { t: H[a.i].t, p: px(a.p) }, leg: leg, m0t: c30[m0].t, fills: [], pend: [], status: '', b: null, cc: null, endT: null, aBreakT: null };
      // find 0 and A on M30 for exact time of the extreme inside the HTF bar
      const ext = (i0, i1, hi) => { let bi = lowerIdx(c30, i0), best = bi, bp = hi ? -Infinity : Infinity; for (let j = bi; j < n && c30[j].t < i1; j++) { const v = hi ? c30[j].h : c30[j].l; if (hi ? v > bp : v < bp) { bp = v; best = j; } } return c30[best].t; };
      S.o.t = ext(H[o.i].t, H[o.i].t + hp, d < 0); S.a.t = ext(H[a.i].t, H[a.i].t + hp, d > 0);
      // E1 phase
      let dead = false, act = -1; for (let j = lowerIdx(c, H[a.i].t + hp); j < m0; j++) { if (c[j].h > a.p) { act = j; break; } if (c[j].l < o.p) { dead = true; break; } }
      if (!dead && act < 0) {
        const lv = SK_F.map(f => ({ f, pr: a.p - f * leg, done: false })).filter(x => c[m0 - 1].c > x.pr); let j = m0, end = -1, why = '';
        for (; j < Math.min(n, m0 + TTL1); j++) { if (c[j].h > a.p) { act = j; why = 'break'; break; } if (c[j].l < o.p) { why = 'inv'; break; } for (const q of lv) if (!q.done && c[j].l <= q.pr) { q.done = true; S.fills.push(mkFill(j, q.pr, 'E1', q.pr, leg, { f: q.f })); } }
        if (why === 'inv') { S.status = 'INVALID'; S.endT = c30[j].t; } else if (why === 'break') { S.aBreakT = c30[j].t; } else if (j >= n) { S.status = 'FORMING'; S.pend = lv.filter(q => !q.done).map(q => ({ f: q.f, pr: px(q.pr), sd: sdOf(n - 1) })); } else { S.status = 'EXPIRED'; S.endT = c30[j - 1].t; }
        if (why === 'break') { S.e1done = true; }
      }
      // E2 phase: needs B
      const b = P[k + 1]; let e2 = false;
      if (b && b.t === 'L' && b.p > o.p && (a.p - b.p) / leg >= 0.382 && H[b.i + 3] && !dead && (S.status === '' || S.status === 'INVALID' && false)) {
        const mB = lowerIdx(c, H[b.i + 3].t + hp); let act2 = -1, inv = false; for (let j = mB; j < n && j < mB + TTL1; j++) { if (c[j].l < o.p || c[j].c < b.p) { inv = true; break; } if (c[j].h > a.p) { act2 = j; break; } }
        S.b = { t: ext(H[b.i].t, H[b.i].t + hp, d < 0), p: px(b.p) };
        if (act2 >= 0) { e2 = true; S.aBreakT = S.aBreakT || c30[act2].t; S.status = 'ACTIVE'; let C = -1; for (let j = act2; j < Math.min(n - 3, act2 + TTL1); j++) { if (c[j].l < o.p || c[j].c < b.p) break; if (c[j].h <= a.p) continue; let isH = true; for (let q = 1; q <= 3; q++) if (!(c[j].h > c[j - q].h && c[j].h > c[j + q].h)) { isH = false; break; } if (isH) { C = j; break; } }
          if (C >= 0) { const pl = C + 3; let bad = false; for (let j = C + 1; j <= pl; j++) if (c[j].c < b.p || c[j].l < o.p) { bad = true; break; } S.cc = { t: c30[C].t, p: px(c[C].h) };
            if (bad) { S.status = 'INVALID'; S.endT = c30[Math.min(n - 1, pl)].t; } else { const cp = c[C].h, te1 = b.p + leg, lv = SK_F.map(f => ({ f, pr: cp - f * (cp - b.p), done: false })); S.status = 'E2'; S.pend = []; let j = pl + 1, stop = false; for (; j < Math.min(n, pl + 1 + TTL2); j++) { if (c[j].c < b.p || c[j].l < o.p) { S.status = 'INVALID'; S.endT = c30[j].t; stop = true; break; } for (const q of lv) if (!q.done && c[j].l <= q.pr) { q.done = true; S.fills.push(mkFill(j, q.pr, 'E2', b.p, leg, { f: q.f })); } if (c[j].h >= te1 && lv.some(q => !q.done)) { for (const q of lv) q.done = true; } }
              if (!stop) { if (j >= n) S.pend = lv.filter(q => !q.done).map(q => ({ f: q.f, pr: px(q.pr), sd: sdOf(n - 1) })); else { S.status = 'DONE'; S.endT = c30[j - 1].t; } } }
          } else { // C not yet confirmed: provisional highest high after the break
            let hh = -Infinity, hi = -1; for (let j = act2; j < n; j++) { if (c[j].l < o.p || c[j].c < b.p) { S.status = 'INVALID'; S.endT = c30[j].t; break; } if (c[j].h > hh) { hh = c[j].h; hi = j; } } if (S.status === 'ACTIVE' && hi >= 0) S.cp = { t: c30[hi].t, p: px(hh) };
          } }
        else if (inv) { S.status = S.status || 'INVALID'; }
        else if (!S.status) S.status = 'FORMING';
      } else if (!S.status && S.aBreakT) { S.status = 'ACTIVE'; for (let j = lowerIdx(c, S.aBreakT); j < n; j++) if (c[j].l < o.p) { S.status = 'INVALID'; S.endT = c30[j].t; break; } }
      if (!S.status) S.status = dead ? 'INVALID' : 'FORMING';
      if (S.status === 'INVALID' && !S.endT) S.endT = S.endT || c30[m0].t;
      if (!(S.status === 'FORMING' || S.status === 'ACTIVE' || S.status === 'E2' || S.fills.length)) { if (S.status === 'INVALID' || S.status === 'EXPIRED' || S.status === 'DONE') { /* keep for display as faded */ } }
      seqs.push(S);
    }
  }
  seqs.sort((x, y) => x.m0t - y.m0t);
  return { seqs, c30n: n, hp };
}
