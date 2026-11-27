// Data integrity layer. Everything the app shows is tagged REAL, DERIVED, PARTIAL, PROXY or N/A, and checked against itself.
export function checkCandles(c, tf) {
  const issues = new Map(); const add = (i, why) => { const a = issues.get(i) || []; a.push(why); issues.set(i, a); };
  let gaps = 0, bad = 0;
  for (let i = 0; i < c.length; i++) {
    const b = c[i], e = 1e-9 * Math.max(1, b.h);
    if (i && tf < 6048e5) { const d = b.t - c[i - 1].t; if (d > tf) { add(i, 'gap: ' + (Math.round(d / tf) - 1) + ' candle(s) missing before this one'); gaps++; } else if (d <= 0) { add(i, 'duplicate or out-of-order timestamp'); bad++; } }
    if (b.h < Math.max(b.o, b.c) - e || b.l > Math.min(b.o, b.c) + e || b.h < b.l) { add(i, 'OHLC inconsistent'); bad++; }
    if (b.v < 0 || b.bv < -e || b.bv > b.v * (1 + 1e-9) + 1e-9) { add(i, 'taker volume exceeds total volume'); bad++; }
  }
  return { issues, gaps, bad };
}
// Compare tick-built footprint totals with the exchange candle (volume and taker-buy delta). Only for fully loaded candles.
export function reconcile(candle, ticks) {
  let buy = 0, sell = 0; for (const t of ticks) { if (t[2]) buy += t[1]; else sell += t[1]; }
  const v = buy + sell, dv = candle.v ? (v - candle.v) / candle.v : 0, dd = candle.v ? ((buy - sell) - candle.d) / candle.v : 0;
  return { vol: v, volDiffPct: dv * 100, deltaDiffPct: dd * 100, ok: Math.abs(dv) < 0.005 && Math.abs(dd) < 0.005 };
}
export const TAGS = {
  REAL: 'Exchange data, as published',
  DERIVED: 'Computed by the app from real data (rules, not a prediction)',
  PARTIAL: 'Real but incomplete: coverage limited, labelled on screen',
  PROXY: 'Different instrument standing in for the one you asked about',
  NA: 'Not available from this feed, so not shown',
};
