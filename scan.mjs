import { absorption, deltaDiv } from './flow2.js';
const syms=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];const tfs=['15m','1h'];
for(const s of syms)for(const tf of tfs){const r=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&limit=1000`);const k=await r.json();
const c=k.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],d:2*+x[9]-+x[5]}));
const a=absorption(c),d=deltaDiv(c);console.log(s,tf,'abs',a.length,'(bull',a.filter(x=>x.dir==='bull').length+')','ddiv',d.length,'(bull',d.filter(x=>x.type==='bull').length+')','of',c.length,'last abs idx',a.slice(-3).map(x=>x.i).join(','),'last div',d.slice(-3).map(x=>x.i).join(','))}
