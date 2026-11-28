import { compute, htfSeries, TYPES, MAXH, SPLIT, MIN_N, KS } from './stats.js';
import { TFS } from './data.js';
import { isAr } from './i18n.js';
const $ = s => document.querySelector(s);
const REST = 'https://data-api.binance.vision/api/v3';
const pc = v => isFinite(v) ? Math.round(v * 100) + '%' : '-';
const rr = v => isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + 'R' : '-';
const day = t => new Date(t).toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' });
async function klines(sym, tf, N, prog) {
  let all = [], end; for (let p = 0; p < Math.ceil(N / 1000); p++) { const r = await fetch(`${REST}/klines?symbol=${sym}&interval=${tf}&limit=1000` + (end ? `&endTime=${end}` : '')); if (!r.ok) throw new Error('HTTP ' + r.status); const k = await r.json(); if (!k.length) break; all = k.concat(all); end = k[0][0] - 1; if (prog) prog(all.length, N); if (k.length < 1000) break; }
  return all.map(x => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], d: 2 * +x[9] - +x[5] }));
}
export class SignalStats {
  constructor(app) { this.app = app; this.htfOn = false; this.sess = 'all'; this.cache = {}; this.busy = false; this._ui(); }
  _ui() {
    const el = $('#ss'); this.el = el; $('#ssX').onclick = () => { el.hidden = true; };
    $('#ssHtf').onchange = e => { this.htfOn = e.target.checked; this.run(); }; $('#ssSess').onchange = e => { this.sess = e.target.value; this.run(); }; $('#ssRef').onclick = () => { this.cache = {}; this.run(); };
  }
  open() { this.el.hidden = false; this.run(); }
  async data(sym, tf) {
    const key = sym + tf, now = Date.now(); const c0 = this.cache[key]; if (c0 && now - c0.at < 600e3) return c0;
    const per = TFS[tf], N = { '1m': 20000, '5m': 40000, '15m': 40000, '1h': 20000, '4h': 10000, '1d': 3000 }[tf] || 5000; const ar = isAr(), bd = $('#ssBody');
    let c = await klines(sym, tf, N, (a, b) => { bd.innerHTML = `<div class="note">${ar ? 'بيحمّل التاريخ' : 'Loading history'}: ${a}/${b}</div>`; }); c = c.filter(x => x.t + per <= now);
    let htf = null, htfTf = per < 3600e3 ? '1h' : per < 4 * 3600e3 ? '4h' : null;
    if (htfTf) { const hp = TFS[htfTf], need = Math.ceil((c[c.length - 1].t - c[0].t) / hp) + 80; let h = await klines(sym, htfTf, Math.min(need, 12000)); h = h.filter(x => x.t + hp <= now); htf = htfSeries(h); htf.dt = hp; }
    return (this.cache[key] = { c, htf, htfTf, at: now });
  }
  async run() {
    if (this.busy) return; const ar = isAr(), app = this.app, sym = app.state.symbol, tf = app.state.tf, body = $('#ssBody'); const spot = /USDT$/.test(sym) && !app.noFlow;
    $('#ssT').textContent = (ar ? 'إحصائيات الإشارات' : 'Signal stats') + ' · ' + sym + ' ' + tf;
    if (!spot) { body.innerHTML = `<div class="note">N/A: ${ar ? 'الإحصائيات محتاجة بيانات taker حقيقية من Binance Spot (عملات USDT بس).' : 'Needs real Binance Spot taker data (USDT crypto pairs only).'}</div>`; return; }
    if (!(tf in TFS) || TFS[tf] > 864e5) { body.innerHTML = `<div class="note">N/A: ${ar ? 'اختار فريم من 1m لـ 1d.' : 'Pick a timeframe from 1m to 1d.'}</div>`; return; }
    this.busy = true; body.innerHTML = `<div class="note">${ar ? 'بيحمّل التاريخ من Binance...' : 'Loading history from Binance...'}</div>`;
    try {
      const D = await this.data(sym, tf); const useH = this.htfOn && D.htf; $('#ssHtfL').textContent = D.htfTf ? (ar ? `ترند ${D.htfTf}: EMA50 (الاتجاه بس)` : `${D.htfTf} trend: EMA50 (trade with it only)`) : (ar ? 'فلتر الترند مش متاح على الفريم ده' : 'Trend filter not available on this timeframe'); $('#ssHtf').disabled = !D.htfTf;
      const t0 = performance.now(); const R = compute(D.c, useH ? D.htf : null, { sess: this.sess }); this.render(R, D, performance.now() - t0, useH);
    } catch (e) { body.innerHTML = `<div class="note">${ar ? 'فشل التحميل: ' : 'Load failed: '}${e.message}</div>`; }
    this.busy = false;
  }
  render(R, D, ms, useH) {
    const ar = isAr(), L = i => i[ar ? 1 : 0]; const nt = R.n;
    const chip = { few: [ar ? 'عينة صغيرة' : 'too few', 'few'], none: [ar ? 'مفيش ميزة' : 'NO EDGE', 'none'], maybe: [ar ? 'ممكن ميزة (مش إثبات)' : 'possible edge (not proof)', 'maybe'] };
    let h = `<div class="bmnote">${ar ? 'بيانات Binance Spot الحقيقية' : 'Real Binance Spot candles'}: ${nt} ${ar ? 'شمعة' : 'candles'}, ${day(R.tStart)} → ${day(R.tEnd)}. ${ar ? 'الأقدم 60% لاختيار الستوب، والأحدث 40% (من ' : 'Older 60% picks the stop, newest 40% (from '}${day(R.tCut)}${ar ? ') نتيجة مش اتستخدمت في الاختيار.' : ') is held-out and is the only result judged.'}</div>`;
    h += `<div class="ssfilters">${ar ? 'الفلاتر الحالية: ' : 'Filters now: '}<b>${useH ? (ar ? 'ترند ' + D.htfTf : D.htfTf + ' trend') : (ar ? 'من غير ترند' : 'no trend filter')}</b> · <b>${this.sess === 'all' ? (ar ? 'كل الجلسات' : 'all sessions') : ({london:'London',ny:'New York',lny:'London + NY'})[this.sess]}</b></div>`;
    for (const o of R.out) {
      const t = o.test, a = o.train, c = chip[o.verdict];
      h += `<div class="ssc"><div class="ssh"><b>${L(o.name)}</b><span class="ssv ${c[1]}">${c[0]}</span></div>
      <div>${ar ? 'الأحدث (غير مستخدم)' : 'Held-out'}: <b>n=${t.w + t.l + t.t}</b> (${ar ? 'من' : 'of'} ${o.total} ${ar ? 'كلها' : 'total'}) · ${ar ? 'وصل +1R قبل -1R' : 'reached +1R before -1R'}: <b>${pc(t.win)}</b> ${t.w + t.l ? `(${ar ? 'فاصل 95%' : '95% CI'} ${pc(o.ci[0])}-${pc(o.ci[1])}, ${t.w}/${t.w + t.l})` : ''} · ${ar ? 'متوسط R' : 'avg R'}: <b>${rr(t.avgR)}</b></div>
      <div class="bmnote">${ar ? 'دخول عشوائي بنفس القواعد' : 'Random entries, same rule'}: ${pc(o.base)} · ${ar ? 'الأقدم (للاختيار)' : 'Older (used to fit)'}: n=${a.n}, ${pc(a.win)}, ${rr(a.avgR)} · ${ar ? 'الستوب المختار' : 'chosen stop'} ${o.k}×ATR${t.t ? ` · ${t.t} ${ar ? 'انتهى بالوقت' : 'timed out'}` : ''}</div></div>`;
    }
    h += `<div class="bmnote"><b>${ar ? 'القاعدة' : 'Rule'}:</b> ${ar ? `الدخول عند إغلاق شمعة الإشارة (الدايفرجنس عند شمعة التأكيد). الستوب والهدف = k × ATR(14) (الهدف = +1R، الستوب = -1R، k من ${KS.join(' / ')} بيتختار على الـ60% الأقدم). لو شمعة لمست الاتنين نحسبها خسارة. بعد ${MAXH} شمعة من غير نتيجة بتتحسب بالإغلاق. من غير عمولات أو انزلاق.` : `Enter at the close of the signal candle (divergences: the candle that confirms the second swing). Stop and target are k x ATR(14) (target +1R, stop -1R; k from ${KS.join(' / ')} chosen on the older 60% only). A candle touching both counts as a loss. After ${MAXH} candles without a result the trade is scored at the close. No fees or slippage.`}</div>
    <div class="bmnote"><b>${ar ? 'الحكم' : 'Verdict'}:</b> ${ar ? `"ممكن ميزة" لو n ≥ ${MIN_N} على البيانات الأحدث، والحد الأدنى لفاصل 95% فوق الدخول العشوائي، ومتوسط R موجب. غير كده "مفيش ميزة". مع ${R.out.length} إشارات واختبارات كتير (فلاتر، فريمات) بيظهر "ممكن" بالصدفة كتير. مش إثبات ومش وعد.` : `"possible edge" needs n >= ${MIN_N} on the held-out data, the CI lower bound above random entries, and average R above 0. Otherwise "NO EDGE". With ${R.out.length} signal types and many filter and timeframe combinations, some will look good by chance. This is not proof and not a promise.`}</div>
    <div class="bmnote"><b>${ar ? 'حدود' : 'Limits'}:</b> ${ar ? 'Binance Spot فقط (دلتا taker من بورصة واحدة)؛ عينة محدودة بالتاريخ المحمّل (عشرات الآلاف من الشموع، سنة لسنتين على 15m/1h)؛ RUN والـABS المفلتر بمناطق السيولة مش متضمنين؛ الجلسات بتعريف التطبيق الثابت (لندن/نيويورك بتوقيت نيويورك) مش بتوقيت الشارت؛ الأرقام بتتغير مع الفريم والفترة.' : 'Binance Spot only (taker delta from one exchange); sample is the loaded history (tens of thousands of candles, 1 to 2 years at 15m/1h, loaded each time the panel opens (about 10 min cache)); RUN and zone-gated ABS are not included; sessions use the app\'s fixed definitions (London / NY in New York time), not the chart display timezone; numbers change with timeframe and period.'}</div><div class="bmnote">${Math.round(ms)} ms</div>`;
    $('#ssBody').innerHTML = h;
  }
}
