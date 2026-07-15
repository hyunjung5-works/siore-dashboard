const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('inventory.html','utf8');
const dom=new JSDOM('<!DOCTYPE html><html><body></body></html>',{runScripts:'dangerously',pretendToBeVisual:true});
const w=dom.window,d=w.document;
w.Chart=function(){return{destroy(){},update(){}}};w.Chart.defaults={font:{},color:''};w.fetch=()=>Promise.reject(new Error('x'));
d.body.innerHTML=html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g,'');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const run=c=>{const s=d.createElement('script');s.textContent=c;d.body.appendChild(s);};
const errors=[];
try{run(fs.readFileSync('assets/snapshot.js','utf8'));run(fs.readFileSync('assets/data.js','utf8'));run('window.GENERATED_AT="x";');run(scripts[scripts.length-1]);}catch(e){errors.push(e.stack);}
try{ w.render(); w.renderPO(); }catch(e){errors.push('render:'+e.stack);}
const po=[...d.querySelectorAll('#tb-po-inv tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()).join(' | '));
po.forEach(x=>console.log('PO:',x));
console.log('ERRORS:',errors.length?errors.join('\n'):'NONE');
