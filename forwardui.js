import { forwardLog, board, FREEZE_T, SYM, TF, PER } from './forward.js';
import { isAr } from './i18n.js';
const $ = s => document.querySelector(s);
const pc = v => isFinite(v) ? Math.round(v * 100) + '%' : '-', rr = v => isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + 'R' : '-';
const fmt = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const oc = (x, ar) => x.o === 'w' ? '<b style="color:#1fbf75">WIN</b>' : x.o === 'l' ? '<b style="color:#e5484d">LOSS</b>' : x.o === 't' ? (ar ? 'وقت ' : 'timeout ') + rr(x.r) : (ar ? 'مفتوحة' : 'open');
export class Forward {
  constructor() { $('#fwX').onclick = () => { $('#fw').hidden = true; }; $('#fwRef').onclick = () => this.run(); }
  open() { $('#fw').hidden = false; this.run(); }
  async run() {
    const ar = isAr(), body = $('#fwBody'); body.innerHTML = `<div class="note">${ar ? 'بيحمّل...' : 'Loading...'}</div>`;
    let file = null, live = [], err = '';
    try { const r = await fetch('forward_log.json?_=' + Date.now()); if (r.ok) file = await r.json(); } catch (e) { }
    try { const r = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${SYM}&interval=${TF}&limit=1000`); const k = await r.json(); const c = k.map(x => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).filter(x => x.t + PER <= Date.now()); live = forwardLog(c, FREEZE_T); this.lastC = c[c.length - 1].t + PER; } catch (e) { err = e.message; }
    const m = new Map((file ? file.signals : []).map(s => [s.t, { ...s, src: 'log' }]));
    for (const s of live) { const o = m.get(s.t); if (!o) m.set(s.t, { ...s, src: 'live' }); else for (const k of ['r1', 'r2']) if (o[k].o === 'open' && s[k].o !== 'open') { o[k] = s[k]; o.src = 'live'; } }
    const L = [...m.values()].sort((a, b) => b.t - a.t), b1 = board(L, 'r1'), b2 = board(L, 'r2');
    const card = (nm, b, be, bt) => `<div class="ssc"><div class="ssh"><b>${nm}</b><span class="ssv ${b.w + b.l < 30 ? 'few' : 'none'}">${b.w + b.l < 30 ? (ar ? 'عينة صغيرة (n<30)' : 'too few (n<30)') : 'n=' + (b.w + b.l)}</span></div>
      <div>${ar ? 'اتحسمت' : 'Resolved'}: <b>${b.n}</b> (${b.w} ${ar ? 'كسب' : 'win'}, ${b.l} ${ar ? 'خسارة' : 'loss'}, ${b.t} ${ar ? 'وقت' : 'timeout'}) · ${ar ? 'مفتوحة' : 'open'}: ${b.open}</div>
      <div>${ar ? 'نسبة كسب' : 'Win rate'}: <b>${pc(b.win)}</b> ${b.w + b.l ? `(95% CI ${pc(b.ci[0])}-${pc(b.ci[1])})` : ''} · ${ar ? 'متوسط R (إجمالي)' : 'avg R (gross)'}: <b>${rr(b.avgR)}</b></div>
      <div class="bmnote">${ar ? 'التعادل' : 'Break-even win rate'} ${be} · ${ar ? 'الباك تست (فترة الاختبار القديمة، 4h PAXG)' : 'Backtest on old held-out data (PAXG 4h)'}: ${bt}</div></div>`;
    let h = `<div class="bmnote"><b>${ar ? 'متابعة حية (forward) لإشارة S4' : 'Live forward test of signal S4'}</b> · PAXG 4h · ${ar ? 'القاعدة متجمدة من' : 'rule frozen at'} ${fmt(FREEZE_T)}. ${ar ? 'إشارات بس، مفيش فلوس حقيقية، من غير عمولة.' : 'Signals only, no real money, gross (no fees or slippage).'}</div>`;
    h += card('+1R / -1R', b1, '50%', '59.8% win, +0.20R, n=164') + card('+2R / -1R', b2, '33%', '42.7% win, +0.28R, n=164');
    h += `<div class="bmnote">${ar ? 'آخر شمعة 4h مقفولة' : 'Last closed 4h candle'}: ${this.lastC ? fmt(this.lastC) : '-'} · ${ar ? 'السجل المحفوظ اتحدّث' : 'saved log updated'}: ${file ? fmt(file.updated) : (ar ? 'لسه مفيش' : 'not found')}${err ? ' · ' + err : ''}</div>`;
    h += L.length ? L.map(s => `<div class="ssc"><div class="ssh"><b>${s.dir === 'long' ? 'LONG' : 'SHORT'} · ${fmt(s.t)}</b><span class="bmnote">${s.src === 'log' ? (ar ? 'متسجلة' : 'logged') : (ar ? 'حية، لسه مش في السجل' : 'live, not yet in saved log')}</span></div>
      <div>${ar ? 'دخول' : 'entry'} ${s.entry.toFixed(2)} · ${ar ? 'ستوب' : 'stop'} ${s.stop.toFixed(2)} · 1R ${s.t1p.toFixed(2)} · 2R ${s.t2p.toFixed(2)}</div><div>1R: ${oc(s.r1, ar)} · 2R: ${oc(s.r2, ar)}</div></div>`).join('') : `<div class="note">${ar ? 'لسه مفيش ولا إشارة من وقت التجميد. الإشارة بتظهر بس لما ER(20) فوق 0.5 على شمعة 4h مقفولة.' : 'No signals yet since the freeze. A signal only appears when ER(20) is above 0.5 on a closed 4h candle, which is not every day.'}</div>`;
    h += `<div class="bmnote"><b>${ar ? 'القاعدة (مش هتتغير)' : 'Rule (frozen)'}:</b> ER(20) > 0.5 ${ar ? 'واتجاه آخر 12 شمعة (إغلاق الشمعة ناقص إغلاق من 12 شمعة)' : 'and sign of the 12-candle return'} → long/short ${ar ? 'عند إغلاق الشمعة. ستوب = 1 × ATR14. هدف +1R و+2R. بعد 48 شمعة من غير نتيجة بتتحسب بالإغلاق. نفس الاتجاه بفاصل 6 شموع على الأقل.' : 'at the candle close. Stop 1 x ATR14, targets +1R and +2R. 48 candles without a result = timeout at close. Same-direction signals at least 6 candles apart.'}</div>
    <div class="bmnote"><b>${ar ? 'حدود' : 'Limits'}:</b> ${ar ? 'العينة هتبقى صغيرة لشهور (إشارات قليلة). نتيجة 30-50 إشارة بس هي اللي تقول حاجة. الباك تست كان في صعود قوي للدهب. PAXG مش XAU. من غير عمولة. السجل بيتحدث من خلال GitHub كل 4 ساعات من غير ما التطبيق يكون مفتوح، وكمان التطبيق بيحسب الإشارات الحية لما تفتحه.' : 'The sample will stay small for months (few signals); only 30-50 resolved signals will say anything. The backtest period was a strong gold uptrend. PAXG is a proxy, not XAU. Gross, no costs. The saved log is updated by a scheduled GitHub job every 4 hours without the app open; the app also recomputes live signals when opened.'}</div>`;
    body.innerHTML = h;
  }
}
