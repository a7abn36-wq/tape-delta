import fs from 'fs';
import { wilderATR } from './ict.js';
const PER={'5m':300e3,'15m':900e3,'1h':3600e3,'4h':14400e3};
export const load=(s,tf)=>JSON.parse(fs.readFileSync(`/tmp/kc/${s}_${tf}.json`));
export function sim(c,atr,i,dir,mult=1,MAXH=48){const e=c[i].c,risk=atr[i];if(!(risk>0)||i+1>=c.length)return null;const L=dir>0,tp=e+dir*mult*risk,sl=e-dir*risk,end=Math.min(c.length-1,i+MAXH);
 for(let j=i+1;j<=end;j++){const x=c[j],hs=L?x.l<=sl:x.h>=sl,ht=L?x.h>=tp:x.l<=tp;if(hs)return-1;if(ht)return mult}
 if(i+MAXH>c.length-1)return null;return dir*(c[end].c-e)/risk}
export const mean=a=>a.reduce((x,y)=>x+y,0)/a.length, sdv=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1))};
// normal cdf / inverse
export const Phi=x=>{const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
export const PhiInv=p=>{let lo=-10,hi=10;for(let k=0;k<80;k++){const m=(lo+hi)/2;if(Phi(m)<p)lo=m;else hi=m}return(lo+hi)/2};
const skew=a=>{const m=mean(a),s=sdv(a)||1;return mean(a.map(x=>((x-m)/s)**3))},kurt=a=>{const m=mean(a),s=sdv(a)||1;return mean(a.map(x=>((x-m)/s)**4))};
// Deflated Sharpe (Bailey & Lopez de Prado 2014). SR per trade. N = number of independent-ish trials tried, varSR = variance of SR across trials.
export function dsr(rs,N,varSR){const T=rs.length,sr=mean(rs)/(sdv(rs)||1),g=0.5772156649,sr0=Math.sqrt(varSR)*((1-g)*PhiInv(1-1/N)+g*PhiInv(1-1/(N*Math.E))),g3=skew(rs),g4=kurt(rs);
 const z=(sr-sr0)*Math.sqrt(T-1)/Math.sqrt(Math.max(1e-9,1-g3*sr+(g4-1)/4*sr*sr));return{sr,sr0,dsr:Phi(z),psr0:Phi(sr*Math.sqrt(T-1)/Math.sqrt(Math.max(1e-9,1-g3*sr+(g4-1)/4*sr*sr)))}}
// circular-shift permutation: keeps the signal clustering, destroys alignment with price. R[dir][i] precomputed for the window.
export function shiftPerm(sigs,Rb,Rs,lo,hi,iters=5000){const W=hi-lo;const get=(i,d)=>{const v=(d>0?Rb:Rs)[i];return v};
 const obs=mean(sigs.map(s=>get(s.i,s.dir)));let ge=0,cnt=0;const rnd=(()=>{let x=12345;return()=>{x^=x<<13;x^=x>>17;x^=x<<5;return(x>>>0)/4294967296}})();
 for(let k=0;k<iters;k++){const sh=1+Math.floor(rnd()*(W-1));let s=0,n=0;for(const q of sigs){const i=lo+((q.i-lo+sh)%W),v=get(i,q.dir);if(v!=null){s+=v;n++}}if(n&&s/n>=obs)ge++;cnt++}
 return{obs,p:(ge+1)/(cnt+1)}}
// S4 signals (same as forward.js)
export function s4(c,from){const n=c.length,out=[],last={1:-99,'-1':-99};for(let i=21;i<n;i++){let s=0;for(let j=i-19;j<=i;j++)s+=Math.abs(c[j].c-c[j-1].c);const er=s?Math.abs(c[i].c-c[i-20].c)/s:0;if(!(er>0.5))continue;const rr=c[i].c-c[i-12].c,d=rr>0?1:rr<0?-1:0;if(!d)continue;if(i-last[d]<6)continue;last[d]=i;if(i>=from)out.push({i,dir:d})}return out}
if(process.argv[1].endsWith('quant.mjs')){
 const N=294,varSR=0.00692; // variance of mean-R across the 198 strategy tests
 for(const s of ['PAXGUSDT','BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']){const c=load(s,'4h'),n=c.length,cut=Math.floor(n*.6),atr=wilderATR(c);const sg=s4(c,cut);
  for(const mult of [1,2]){const Rb=new Array(n).fill(null),Rs=new Array(n).fill(null);for(let i=cut;i<n;i++){Rb[i]=sim(c,atr,i,1,mult);Rs[i]=sim(c,atr,i,-1,mult)}
   const rs=sg.map(q=>(q.dir>0?Rb:Rs)[q.i]).filter(x=>x!=null);const D=dsr(rs,N,varSR),P=shiftPerm(sg.filter(q=>(q.dir>0?Rb:Rs)[q.i]!=null),Rb,Rs,cut,n,5000);
   console.log(s,'4h',mult+'R','n',rs.length,'meanR',mean(rs).toFixed(3),'SR/trade',D.sr.toFixed(3),'SR0(luck bar)',D.sr0.toFixed(3),'DSR',D.dsr.toFixed(3),'PSR(vs0)',D.psr0.toFixed(3),'perm p',P.p.toFixed(4))}}
}
