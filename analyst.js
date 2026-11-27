// Rules-based market analyst. Runs on the phone, no external API, no cost. It reads what the app already computes
// (structure, liquidity, zones, order flow, ATR) and writes a short reading. It is a checklist in words, not a prediction.
import { wilderATR, nyHour } from './ict.js';
const f = (v, d = 2) => v == null || !isFinite(v) ? 'n/a' : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export function analyze(app, ar) {
  const c = app.visibleCandles(), n = c.length, k = app.conf, I = app.ict; if (n < 40 || !I || !k) return null;
  const t = (en, a) => ar ? a : en; const px = c[n - 1].c, dec = k.dec, atr = wilderATR(c)[n - 1];
  const out = { head: '', sections: [], tags: [] };
  // 1 headline
  const conf = k.score < 35 ? 0 : k.score < 60 ? 1 : k.score < 80 ? 2 : 3; const cl = [t('none', 'مفيش'), t('low', 'منخفضة'), t('medium', 'متوسطة'), t('high', 'عالية')][conf];
  const lab = k.label === 'NO EDGE' ? t('No clear edge', 'مفيش أفضلية واضحة') : k.dir === 'bull' ? t('Bullish lean (long side)', 'ميل صاعد (جهة الشراء)') : t('Bearish lean (short side)', 'ميل هابط (جهة البيع)');
  out.head = `${lab} · ${t('checklist score', 'درجة القايمة')} ${k.score}/100 · ${t('alignment', 'التوافق')}: ${cl}`;
  out.tags.push(t('This score counts how many rules agree. It is not a chance of winning.', 'الدرجة دي بتعدّ كام قاعدة متفقة. مش احتمال الكسب.'));
  // 2 structure and zone
  const S = [], st = I.struct[I.struct.length - 1];
  if (st) { const up = st.dir === 'bull'; const ago = Math.round((n - 1 - st.i2) * app.tfMs() / 60000); const agoT = ago >= 1440 ? Math.round(ago / 1440) + 'd' : ago >= 60 ? Math.round(ago / 60) + 'h' : ago + 'm';
    S.push(st.kind === 'CHoCH' ? t(`Last structure event: CHoCH ${up ? 'up' : 'down'}, ${agoT} ago. That is the first sign the trend may be turning ${up ? 'up' : 'down'}.`, `آخر حدث هيكلي: CHoCH ${up ? 'لأعلى' : 'لأسفل'} من ${agoT}. دي أول إشارة إن الاتجاه ممكن يتحول ${up ? 'لأعلى' : 'لأسفل'}.`)
      : t(`Last structure event: BOS ${up ? 'up' : 'down'}, ${agoT} ago. The ${up ? 'uptrend' : 'downtrend'} is continuing.`, `آخر حدث هيكلي: BOS ${up ? 'لأعلى' : 'لأسفل'} من ${agoT}. ${up ? 'الترند الصاعد' : 'الترند الهابط'} مكمل.`)); }
  if (I.pd) { const pos = Math.round((px - I.pd.lo) / (I.pd.hi - I.pd.lo) * 100); S.push(pos < 50 ? t(`Price is in discount (${pos}% of the range). Cheaper side: buys are favoured by ICT logic.`, `السعر في منطقة رخيصة (${pos}% من المدى). جهة الشراء مفضلة حسب منطق ICT.`) : t(`Price is in premium (${pos}% of the range). Expensive side: sells are favoured by ICT logic.`, `السعر في منطقة غالية (${pos}% من المدى). جهة البيع مفضلة حسب منطق ICT.`)); }
  const h = nyHour(c[n - 1].t); S.push(k.killzone ? t(`Time: inside the ${k.killzone} killzone (New York time), when moves are usually bigger.`, `الوقت: جوه كيلزون ${k.killzone} (توقيت نيويورك)، والحركة فيه غالبا أكبر.`) : t('Time: outside the main killzones. Moves are often slower and less reliable.', 'الوقت: برة الكيلزونز الرئيسية. الحركة غالبا أبطأ وأقل ثقة.'));
  out.sections.push([t('Structure and location', 'الهيكل والمكان'), S]);
  // 3 order flow
  const F = [], d3 = c[n - 1].d + c[n - 2].d + c[n - 3].d; F.push(d3 > 0 ? t(`Last 3 candles: net buying (delta +${f(d3, 2)}).`, `آخر 3 شموع: شراء صافي (دلتا +${f(d3, 2)}).`) : t(`Last 3 candles: net selling (delta ${f(d3, 2)}).`, `آخر 3 شموع: بيع صافي (دلتا ${f(d3, 2)}).`));
  const m = Math.min(12, n - 1), dp = px - c[n - 1 - m].c, ds = c.slice(n - m).reduce((s, x) => s + x.d, 0);
  if (dp > 0 && ds < 0) F.push(t(`Divergence: price rose over ${m} candles but net delta is negative. The rise has weak buying behind it (bearish warning).`, `تباعد: السعر طلع خلال ${m} شمعة بس الدلتا الصافية سالبة. الصعود ده وراه شراء ضعيف (تحذير هابط).`));
  else if (dp < 0 && ds > 0) F.push(t(`Divergence: price fell over ${m} candles but net delta is positive. The fall has weak selling behind it (bullish warning).`, `تباعد: السعر نزل خلال ${m} شمعة بس الدلتا الصافية موجبة. النزول ده وراه بيع ضعيف (تحذير صاعد).`));
  else F.push(t(`Price and delta over the last ${m} candles agree (${dp >= 0 ? 'up' : 'down'}).`, `السعر والدلتا خلال آخر ${m} شمعة متفقين (${dp >= 0 ? 'صعود' : 'هبوط'}).`));
  const dep = app.depth; if (dep && dep.bids && dep.asks) { const b = dep.bids.reduce((s, x) => s + x[1], 0), a = dep.asks.reduce((s, x) => s + x[1], 0), sh = Math.round(b / (a + b) * 100); F.push(t(`Order book (top 20 levels): ${sh}% of size is on the bid side. Resting orders can be pulled, so treat it as a hint only.`, `الأوردر بوك (أعلى 20 مستوى): ${sh}% من الحجم في جهة الشراء. الأوامر المستنية ممكن تتسحب فاعتبرها تلميح بس.`)); }
  out.sections.push([t('Order flow', 'الأوردر فلو'), F]);
  // 4 liquidity
  const L = [], above = I.liq.filter(l => l.p > px).sort((a, b) => a.p - b.p)[0], below = I.liq.filter(l => l.p < px).sort((a, b) => b.p - a.p)[0];
  if (above) L.push(t(`Nearest liquidity above: ${above.kind} at ${f(above.p, dec)} (${f((above.p - px) / atr, 1)} ATR away). Price is often drawn to stops there.`, `أقرب سيولة فوق: ${above.kind} عند ${f(above.p, dec)} (على بعد ${f((above.p - px) / atr, 1)} ATR). السعر كتير بيتجذب لستوبات المكان ده.`));
  if (below) L.push(t(`Nearest liquidity below: ${below.kind} at ${f(below.p, dec)} (${f((px - below.p) / atr, 1)} ATR away).`, `أقرب سيولة تحت: ${below.kind} عند ${f(below.p, dec)} (على بعد ${f((px - below.p) / atr, 1)} ATR).`));
  const sw = [...I.sweeps].reverse()[0]; if (sw) L.push(t(`Latest sweep: ${sw.type === 'L' ? 'sell-side' : 'buy-side'} liquidity at ${f(sw.p, dec)}.`, `آخر سويب: سيولة ${sw.type === 'L' ? 'جهة البيع' : 'جهة الشراء'} عند ${f(sw.p, dec)}.`));
  const poiNote = k.factors.find(x => x.name === 'POI'); if (poiNote) L.push(t(`Zone: ${poiNote.text}.`, `المنطقة: ${poiNote.text}.`));
  out.sections.push([t('Liquidity and zones', 'السيولة والمناطق'), L.length ? L : [t('No nearby liquidity level found.', 'مفيش مستوى سيولة قريب.')]]);
  // 5 volatility
  const V = [t(`ATR(14) on this timeframe: ${f(atr, dec)} (${f(atr / px * 100, 2)}% of price). Use it to judge if a stop is too tight.`, `ATR(14) على الفريم ده: ${f(atr, dec)} (${f(atr / px * 100, 2)}% من السعر). استخدمه تحكم لو الستوب ضيق زيادة.`)];
  if (app.gold && app.gold.atr && app.gold.today) { const u = Math.round((app.gold.today.h - app.gold.today.l) / app.gold.atr * 100); V.push(t(`Gold daily range so far is ${u}% of the daily ATR(14). ${u > 100 ? 'The usual daily move is already used, so chasing is riskier.' : 'There is still room compared with a normal day.'}`, `مدى الذهب اليومي لحد دلوقتي ${u}% من ATR اليومي (14). ${u > 100 ? 'الحركة اليومية المعتادة اتستهلكت فالمطاردة أخطر.' : 'لسه في مساحة مقارنة بيوم عادي.'}`)); }
  out.sections.push([t('Volatility', 'التذبذب'), V]);
  // 6 scenarios
  const Sc = [];
  if (k.label !== 'NO EDGE') {
    const bull = k.dir === 'bull';
    Sc.push(t(`Main idea (${bull ? 'long' : 'short'}): look for ${bull ? 'buys' : 'sells'} on a pullback into the zone, not in the middle of nowhere.`, `الفكرة الأساسية (${bull ? 'شراء' : 'بيع'}): دور على ${bull ? 'شراء' : 'بيع'} عند تصحيح لجوه المنطقة، مش في النص.`));
    if (k.tgt != null) Sc.push(t(`Target: ${f(k.tgt, dec)} (nearest liquidity${k.rr != null ? ', reward:risk ' + f(k.rr, 2) : ''}).`, `الهدف: ${f(k.tgt, dec)} (أقرب سيولة${k.rr != null ? '، العائد:المخاطرة ' + f(k.rr, 2) : ''}).`));
    if (k.inv != null) Sc.push(t(`Invalidation: ${bull ? 'below' : 'above'} ${f(k.inv, dec)}. If price closes through it, the idea is wrong. Do not hold on hope.`, `نقطة الإلغاء: ${bull ? 'تحت' : 'فوق'} ${f(k.inv, dec)}. لو السعر قفل عبرها الفكرة غلط. متكملش بالأمل.`));
    if (k.rr != null && k.rr < 1.5) Sc.push(t('Reward:risk is below 1.5, so the setup is weak even if the bias is right.', 'العائد:المخاطرة أقل من 1.5 فالسيتب ضعيف حتى لو الميل صح.'));
  } else Sc.push(t('Waiting is a position. Typical trigger: a liquidity sweep, then a CHoCH, then a pullback into an order block or FVG in the killzone.', 'الانتظار موقف. المحفز المعتاد: كسر سيولة، بعده CHoCH، بعده تصحيح لأوردر بلوك أو FVG داخل الكيلزون.'));
  out.sections.push([t('Scenario', 'السيناريو'), Sc]);
  const miss = ['Structure', 'Liquidity', 'Zone', 'POI', 'Flow', 'Day bias'].filter(x => !k.factors.find(y => y.name === x && y.pts > 0));
  out.sections.push([t('Not aligned yet', 'لسه مش متوافق'), [miss.length ? t('Missing: ' + miss.join(', ') + '.', 'ناقص: ' + miss.join('، ') + '.') : t('All main factors agree.', 'كل العوامل الأساسية متفقة.')]]);
  return out;
}
