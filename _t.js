const fs=require('fs');const {JSDOM}=require('jsdom');
function boot(file){
  const html=fs.readFileSync(file,'utf8');
  const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{runScripts:'dangerously',pretendToBeVisual:true});
  const w=dom.window,d=w.document;
  w.Chart=function(){return{destroy(){},update(){}}};w.Chart.defaults={font:{},color:''};
  w.fetch=()=>Promise.reject(new Error('x'));
  d.body.innerHTML=html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const app=scripts[scripts.length-1];const errors=[];
  const run=c=>{const s=d.createElement('script');s.textContent=c;d.body.appendChild(s);};
  try{run(fs.readFileSync('assets/snapshot.js','utf8'));run(fs.readFileSync('assets/data.js','utf8'));run('window.GENERATED_AT="2026-07-14";');run(app);}catch(e){errors.push('THROWN:'+e.stack);}
  return {w,d,errors};
}
const t=(d,id)=>{const e=d.getElementById(id);return e?e.textContent.trim().replace(/\s+/g,' '):'(MISS '+id+')';};

// ---- marketing.html ----
{
  const {w,d,errors}=boot('marketing.html');
  try{ w.renderInf(); }catch(e){errors.push('renderInf:'+e.stack);}
  console.log('== marketing 인플루언서 ==');
  console.log('건수:',t(d,'if-cnt'),'| 비용:',t(d,'if-cost'),'| 뷰:',t(d,'if-views'),'| ER:',t(d,'if-er'),'| CPV:',t(d,'if-cpv'));
  console.log('inf 표 rows:',d.querySelectorAll('#tb-if-inf tbody tr').length,'| seed rows:',d.querySelectorAll('#tb-seed tbody tr').length);
  console.log('seed-cmp len:',d.getElementById('seed-cmp').innerHTML.length>50);
  console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
}
// ---- index.html ----
{
  const {w,d,errors}=boot('index.html');
  try{ w.renderAll(); }catch(e){errors.push('renderAll:'+e.stack);}
  console.log('\n== index 02 마케팅 ==');
  console.log('paid-per:',t(d,'paid-per'));
  console.log('traffic-per:',t(d,'traffic-per'));
  console.log('inf-per:',t(d,'inf-per'));
  console.log('mk-inf rows:',d.querySelectorAll('#mk-inf .mkrow').length);
  console.log('mk-inf text:',t(d,'mk-inf').slice(0,200));
  const smallRed=[...d.querySelectorAll('#mk-paid .v small')].length;
  console.log('mk-paid small count:',smallRed);
  console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
}
