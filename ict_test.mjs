import fs from 'fs';
import { wilderATR, nyHour } from './ict.js';
import { load, sim, mean, sdv, dsr, shiftPerm } from './quant.mjs';
const wilson=(k,n)=>{if(!n)return[0,1];const z=1.96,p=k/n,d=1+z*z/n,c=p+z*z/(2*n),a=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return[(c-a)/d,(c+a)/d]};
function swings(c){const n=c.length,H=new Array(n).fill(false),L=new Array(n).fill(false);for(let i=3;i<n-3;i++){let h=true,l=true;for(let k=1;k<=3;k++){if(!(c[i].h>c[i-k].h&&c[i].h>c[i+k].h))h=false;if(!(c[i].l<c[i-k].l&&c[i].l<c[i+k].l))l=false}H[i]=h;L[i]=l}return{H,L}}
function rules(c,atr){const n=c.length,S={R1:[],R2:[],R3:[],R4:[],R5:[],R6:[]};const add=(k,i,d)=>S[k].push({i,dir:d});
 const sweepL=[],sweepS=[];// bar idx where sweep long/short signals
 for(let i=21;i<n;i++){let mx=-Infinity,mn=Infinity;for(let j=i-20;j<i;j++){if(c[j].h>mx)mx=c[j].h;if(c[j].l<mn)mn=c[j].l}
  if(c[i].h>mx&&c[i].c<mx){add('R1',i,-1);sweepS.push(i)}else if(c[i].l<mn&&c[i].c>mn){add('R1',i,1);sweepL.push(i)}}
 const hasSw=(arr,a,b)=>arr.some(x=>x>=a&&x<=b);
 // FVG
 for(let k=22;k<n;k++){for(const d of [1,-1]){const a=c[k-2],b=c[k];const top=d>0?b.l:a.l,bot=d>0?a.h:b.h;if(d>0?!(a.h<b.l):!(a.l>b.h))continue;if(Math.abs(top-bot)<0.5*atr[k])continue;const lo=Math.min(top,bot),hi=Math.max(top,bot),mid=(lo+hi)/2;
   for(let i=k+1;i<=Math.min(n-1,k+20);i++){const x=c[i];if(d>0?x.c<lo:x.c>hi)break;if(d>0?(x.l<=hi&&x.c>=mid):(x.h>=lo&&x.c<=mid)){add('R2',i,d);const sw=d>0?sweepL:sweepS;if(hasSw(sw,k-15,k))add('R6',i,d);break}}}}
 // OB
 for(let d0=12;d0<n;d0++){const x=c[d0],body=Math.abs(x.c-x.o);if(body<1.5*atr[d0])continue;let mx=-Infinity,mn=Infinity;for(let j=d0-10;j<d0;j++){if(c[j].h>mx)mx=c[j].h;if(c[j].l<mn)mn=c[j].l}
  const d=x.c>mx&&x.c>x.o?1:x.c<mn&&x.c<x.o?-1:0;if(!d)continue;let ob=-1;for(let j=d0-1;j>=d0-5;j--)if(d>0?c[j].c<c[j].o:c[j].c>c[j].o){ob=j;break}if(ob<0)continue;const lo=c[ob].l,hi=c[ob].h,mid=(lo+hi)/2;
  for(let i=d0+1;i<=Math.min(n-1,d0+30);i++){const y=c[i];if(d>0?y.c<lo:y.c>hi)break;if(d>0?(y.l<=hi&&y.c>=mid):(y.h>=lo&&y.c<=mid)){add('R3',i,d);break}}}
 // structure
 const{H,L}=swings(c);let sh=null,sl=null,state=0;
 for(let i=0;i<n;i++){if(i>=3){if(H[i-3])sh={p:c[i-3].h,used:false};if(L[i-3])sl={p:c[i-3].l,used:false}}
  if(sh&&!sh.used&&c[i].c>sh.p){sh.used=true;if(state===1)add('R4',i,1);else if(state===-1)add('R5',i,1);state=1}
  else if(sl&&!sl.used&&c[i].c<sl.p){sl.used=true;if(state===-1)add('R4',i,-1);else if(state===1)add('R5',i,-1);state=-1}}
 return S}
const thin=L=>{const out=[],last={1:-99,'-1':-99};for(const s of L.sort((a,b)=>a.i-b.i)){if(s.i-last[s.dir]>=6){out.push(s);last[s.dir]=s.i}}return out};
const kz=t=>{const h=nyHour(t);return(h>=2&&h<5)||(h>=8&&h<11)};
const syms=process.argv[2].split(','),res=[];
for(const s of syms)for(const tf of ['15m','1h','4h']){const c=load(s,tf),n=c.length,cut=Math.floor(n*.6),atr=wilderATR(c),S=rules(c,atr);
 const Rb=new Array(n).fill(null),Rs=new Array(n).fill(null),cb=new Array(n).fill(0);for(let i=cut;i<n;i++){Rb[i]=sim(c,atr,i,1);Rs[i]=sim(c,atr,i,-1)}
 const bw=[],bs=[];for(let i=cut;i<n;i++){if(Rb[i]!=null)bw.push(Rb[i]);if(Rs[i]!=null)bs.push(Rs[i])}const wr=a=>a.filter(x=>x>0).length/Math.max(1,a.filter(x=>x!==0&&Math.abs(x)===1||x>0).length);
 const bwin=a=>{const w=a.filter(x=>x===1).length,l=a.filter(x=>x===-1).length;return w/(w+l)};const BW=bwin(bw),BS=bwin(bs);
 for(const k of Object.keys(S))for(const v of (tf==='4h'?['ALL']:['ALL','KZ'])){let L=S[k];if(v==='KZ')L=L.filter(q=>kz(c[q.i].t));L=thin(L).filter(q=>q.i>=cut);
  const tr=[];for(const q of L){const r=sim(c,atr,q.i,q.dir);if(r!=null)tr.push({...q,r,cost:0.001*c[q.i].c/atr[q.i]})}
  const w=tr.filter(x=>x.r===1).length,l=tr.filter(x=>x.r===-1).length,nb=tr.filter(x=>x.dir>0).length,base=tr.length?(nb*BW+(tr.length-nb)*BS)/tr.length:NaN;
  const[lo,hi]=wilson(w,w+l),g=tr.length?mean(tr.map(x=>x.r)):NaN,n10=tr.length?mean(tr.map(x=>x.r-x.cost)):NaN,n20=tr.length?mean(tr.map(x=>x.r-2*x.cost)):NaN;
  const pass=(w+l)>=30&&lo>base&&g>0;let P=null,D=null;if(pass){P=shiftPerm(tr,Rb,Rs,cut,n,3000).p;D=dsr(tr.map(x=>x.r),474,0.00692).dsr}
  res.push({sym:s,tf,rule:k,v,n:tr.length,win:w/(w+l),lo,hi,base,g,n10,n20,pass,p:P,dsr:D,sr:tr.length?mean(tr.map(x=>x.r))/(sdv(tr.map(x=>x.r))||1):NaN})}}
fs.writeFileSync('/tmp/ict_'+syms.join('_')+'.json',JSON.stringify(res));console.log('done',res.length,'pass',res.filter(r=>r.pass).length)
