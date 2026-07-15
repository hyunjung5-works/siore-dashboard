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

// ---- sales.html goal ----
{
  const {w,d,errors}=boot('sales.html');
  try{ w.renderAll(); }catch(e){errors.push('renderAll:'+e.stack);}
  console.log('== sales 아마존 목표 ==');
  console.log('default tab:', d.querySelector('.nav button.on')?.textContent.trim(), '| on tab id:', d.querySelector('.tab.on')?.id);
  console.log('g-cur:',t(d,'g-cur'),'| g-ytd:',t(d,'g-ytd'),'| g-year:',t(d,'g-year'));
  const goalRows=[...d.querySelectorAll('#tb-goal tbody tr')].slice(2,7).map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' / '));
  goalRows.forEach(x=>console.log('  ',x));
  console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
}
// ---- inventory.html ----
{
  const {w,d,errors}=boot('inventory.html');
  try{ w.render(); w.renderDom&&w.renderDom(45); }catch(e){errors.push('render:'+e.stack);}
  console.log('\n== inventory ==');
  console.log('k-urg:',t(d,'k-urg'),'| urg names:',t(d,'k-urg-s'));
  // find serum row in tb-dom
  const domRows=[...d.querySelectorAll('#tb-dom tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | '));
  domRows.filter(r=>/세럼|리치/.test(r)).forEach(x=>console.log('  ',x));
  console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
}
// ---- index.html ----
{
  const {w,d,errors}=boot('index.html');
  try{ w.renderAll(); }catch(e){errors.push('renderAll:'+e.stack);}
  console.log('\n== index ==');
  const dom=[...d.querySelectorAll('#tb-dom tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | '));
  dom.filter(r=>/세럼|리치/.test(r)).forEach(x=>console.log('  dom:',x));
  const need=[...d.querySelectorAll('#po-need tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | '));
  need.forEach(x=>console.log('  need:',x));
  console.log('signal#2:',[...d.querySelectorAll('#signals h3')][1]?.textContent.trim());
  console.log('src links:',[...d.querySelectorAll('#tb-src a')].map(a=>a.textContent.trim()).join(' | '));
  console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
}
