import { absorption, deltaDiv } from './flow2.js';
const syms=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT'];const H=5;
const A={bull:[0,0],bear:[0,0]},D={bull:[0,0],bear:[0,0]},B=[0,0];
for(const s of syms)for(const tf of ['15m','1h']){const r=await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&limit=1000`);const k=await r.json();
const c=k.map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],d:2*+x[9]-+x[5]}));
for(let i=40;i<c.length-H-1;i++){const m=c[i+H].c-c[i].c;if(m!==0){B[1]++;if(m>0)B[0]++}}
for(const a of absorption(c)){const i=a.i;if(i+H>=c.length)continue;const m=c[i+H].c-c[i].c;if(m===0)continue;const hit=(a.dir==='bull')===(m>0);A[a.dir][1]++;if(hit)A[a.dir][0]++}
for(const a of deltaDiv(c)){const i=a.conf;if(i+H>=c.length)continue;const m=c[i+H].c-c[i].c;if(m===0)continue;const hit=(a.type==='bull')===(m>0);D[a.type][1]++;if(hit)D[a.type][0]++}}
console.log('baseline up',(B[0]/B[1]*100).toFixed(1)+'%',B[1]);console.log('ABS bull(up after)',A.bull,(A.bull[0]/A.bull[1]*100).toFixed(1),'bear(down after)',A.bear,(A.bear[0]/A.bear[1]*100).toFixed(1));console.log('DD bull',D.bull,(D.bull[0]/D.bull[1]*100).toFixed(1),'bear',D.bear,(D.bear[0]/D.bear[1]*100).toFixed(1));
