const fs=require('fs');
const {JSDOM}=require('jsdom');
let html=fs.readFileSync('sales.html','utf8');
const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{runScripts:'dangerously',pretendToBeVisual:true});
const w=dom.window, d=w.document;
w.Chart=function(){ return {destroy(){}, update(){}, data:{}, options:{} }; };
w.Chart.defaults={font:{}, color:''};
w.fetch=()=>Promise.reject(new Error('no-net'));
// insert body (minus scripts)
const bodyMatch=html.match(/<body>([\s\S]*)<\/body>/);
d.body.innerHTML=bodyMatch[1].replace(/<script[\s\S]*?<\/script>/g,'');
// grab inline app script (last <script> block without src)
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const app=scripts[scripts.length-1];
const runner=new dom.window.Function; // ensure Function available
// eval snapshot, data, app inside window
function run(code){ const s=d.createElement('script'); s.textContent=code; d.body.appendChild(s); }
const errors=[];
w.addEventListener('error',e=>errors.push('window error: '+e.message));
w.onerror=(m)=>{ errors.push('onerror: '+m); };
try{
  run(fs.readFileSync('assets/snapshot.js','utf8'));
  run(fs.readFileSync('assets/data.js','utf8'));
  // neutralize the async IIFE network parts: define GENERATED_AT
  run('window.GENERATED_AT="2026-07-14";');
  run(app);
}catch(e){ errors.push('THROWN: '+e.message+'\n'+e.stack); }
// after boot, force renderAll synchronously
try{ w.renderAll(); }catch(e){ errors.push('renderAll: '+e.message+'\n'+e.stack); }
// check key elements populated
function txt(id){ const e=d.getElementById(id); return e?e.textContent.trim():'(MISSING '+id+')'; }
console.log('yr-ytd:', txt('yr-ytd'));
console.log('yr-run:', txt('yr-run'));
console.log('g-cur:', txt('g-cur'), '| g-ytd:', txt('g-ytd'), '| g-year:', txt('g-year'));
console.log('g-adperf has content:', (d.getElementById('g-adperf').innerHTML.length>50));
console.log('tb-goal rows:', d.querySelectorAll('#tb-goal tbody tr').length);
console.log('tb-yr rows:', d.querySelectorAll('#tb-yr tbody tr').length);
console.log('ERRORS:', errors.length? errors.join('\n---\n'):'NONE');
