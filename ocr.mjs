// Liest möglichst ausschließlich Rh und Hd. OCR ist niemals eine verbindliche Messung.
function decimal(number){return number.replace(/[,;:]/g,'.').replace(/\s+/g,'');}
function numericMatches(t){
 const text = t.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[Ss]/g,'5');
 return [...text.matchAll(/(?:^|[^\d])([+-]?\d{1,3}[\.,:]\d{2,4}|\d{1,3})(?!\d)/g)].map(m=>decimal(m[1]));
}
export function parseOcrText(text){
 const raw=String(text||''); const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 let rh=null,hd=null;
 for (const ln of lines) {
  const isRh=/\bR\s*[hHn]\b|[Rr][hHn]\s*[:;]?/i.test(ln);
  const isHd=/\bH\s*[dD]\b|[Hh][dD]\s*[:;]?/i.test(ln);
  const after=ln.replace(/^.*?(?:[Rr][hHn]|[Hh][dD])\s*[:;]?/,'');
  const vals=numericMatches(after);
  if(isRh && vals.length && rh===null)rh=vals[0];
  if(isHd && vals.length && hd===null)hd=vals[0];
 }
 if(rh===null || hd===null) {
  const flat = numericMatches(raw);
  if(rh===null && flat.length)rh=flat[0];
  if(hd===null && flat.length>=2)hd=flat[1];
 }
 const valid=(v,min,max)=>v!==null && Number.isFinite(+v) && +v>=min && +v<=max;
 return {rh:valid(rh,0,7)?rh:null,hd:valid(hd,0,150)?hd:null,raw};
}
export function preprocess(sourceCanvas, rect, mode='binary') {
 const sx=Math.round(rect.x*sourceCanvas.width),sy=Math.round(rect.y*sourceCanvas.height);
 const sw=Math.max(10,Math.round(rect.w*sourceCanvas.width)),sh=Math.max(10,Math.round(rect.h*sourceCanvas.height));
 const scale=Math.max(1.5,Math.min(3.2,1400/sw));
 const dst=document.createElement('canvas'); dst.width=Math.round(sw*scale);dst.height=Math.round(sh*scale);
 const ctx=dst.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,dst.width,dst.height);
 ctx.imageSmoothingEnabled=true; ctx.drawImage(sourceCanvas,sx,sy,sw,sh,0,0,dst.width,dst.height);
 const id=ctx.getImageData(0,0,dst.width,dst.height),d=id.data;
 let avg=0,avgSq=0,num=d.length/4;
 for(let i=0;i<d.length;i+=4){let v=.30*d[i]+.59*d[i+1]+.11*d[i+2]; avg+=v;avgSq+=v*v;}
 avg/=num; let sd=Math.sqrt(Math.max(0,avgSq/num-avg*avg));
 // Niedriger Kontrast des LCDs: tiefblaue/dunkle Pixel gezielt verstärken.
 const cut=Math.max(135,Math.min(243,avg-0.46*sd));
 for(let i=0;i<d.length;i+=4){
  let v=0.30*d[i]+0.59*d[i+1]+0.11*d[i+2];
  let nv=mode==='binary'?(v<cut?0:255):Math.round(Math.max(0,Math.min(255,(v-(avg-52))*3.2)));
  d[i]=d[i+1]=d[i+2]=nv;
 }
 ctx.putImageData(id,0,0); return dst;
}
function digitImage(sourceCanvas, frame, part, cutBias=1.45){
 const area={x:frame.x+frame.w*part.x,y:frame.y+frame.h*part.y,w:frame.w*part.w,h:frame.h*part.h};
 const sx=Math.round(area.x*sourceCanvas.width),sy=Math.round(area.y*sourceCanvas.height),sw=Math.max(10,Math.round(area.w*sourceCanvas.width)),sh=Math.max(10,Math.round(area.h*sourceCanvas.height));
 const canvas=document.createElement('canvas');const scale=Math.max(2,Math.min(4,900/sw));canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);
 const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(sourceCanvas,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
 const id=c.getImageData(0,0,canvas.width,canvas.height),d=id.data;
 let mean=0,sq=0,n=d.length/4;
 for(let i=0;i<d.length;i+=4){const v=.299*d[i]+.587*d[i+1]+.114*d[i+2];mean+=v;sq+=v*v;}
 mean/=n;const sd=Math.sqrt(Math.max(1,sq/n-mean*mean));const cut=Math.max(150,Math.min(223,mean-cutBias*sd));
 for(let i=0;i<d.length;i+=4){const v=.299*d[i]+.587*d[i+1]+.114*d[i+2];const b=v<cut?0:255;d[i]=d[i+1]=d[i+2]=b;}
 c.putImageData(id,0,0);return canvas;
}
function asNumber(t,max){
 let x=String(t||'').trim().replace(/\s/g,'').replace(/[,;:]/g,'.').replace(/[oO]/g,'0');
 x=x.replace(/^\./,'0.').replace(/\.+$/, '');
 // Keine unvollständigen Zahlen oder mehrere Werte blind akzeptieren.
 if(!/^\d{1,3}\.\d{3,4}$/.test(x)||!Number.isFinite(+x)||+x>max)return null;
 return x;
}
async function readRoi(worker,canvas,rect,part,max,progress){
 const values=[],logs=[];
 for(const bias of [1.6,.85]){
  progress('Lese Ziffern …');
  const result=(await worker.recognize(digitImage(canvas,rect,part,bias))).data.text.trim();
  logs.push(result);values.push(asNumber(result,max));
 }
 if(values[0] && values[0]===values[1])return {value:values[0],log:logs.join(' | ')};
 // Bei unstimmigen Ergebnissen dritter Versuch: nur Konsens wird akzeptiert.
 const third=(await worker.recognize(digitImage(canvas,rect,part,1.15))).data.text.trim();
 logs.push(third);values.push(asNumber(third,max));
 const agree=values.find(v=>v&&values.filter(x=>x===v).length>=2);
 return {value:agree||null,log:logs.join(' | ')};
}
export async function runOcr(canvas,rect,onProgress=()=>{}) {
 // Keine Daten an einen OCR-Dienst: Nur JS, WASM und Sprachdateien werden per CDN geladen.
 if(!window.Tesseract){
  onProgress('Lade Texterkennung (Internet erforderlich beim ersten Mal) …');
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
   script.onload=resolve;script.onerror=()=>reject(new Error('OCR-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.'));
   document.head.append(script);
  });
 }
 let worker;
 try{
  onProgress('Starte Texterkennung …');
  worker=await window.Tesseract.createWorker('eng',1,{
   logger:m=>{if(m.status==='recognizing text')onProgress(`Erkenne Zeichen: ${Math.round((m.progress||0)*100)} %`);}
  });
  // Der LCD-Bildschirm besteht aus zwei festen Zeilen, daher Ziffernregionen
  // getrennt erkennen; das reduziert Verwechslungen mit Rh, Hd und Batterie.
  await worker.setParameters({tessedit_char_whitelist:'0123456789.,',tessedit_pageseg_mode:'13'});
  const top=await readRoi(worker,canvas,rect,{x:.355,y:.12,w:.37,h:.36},7,onProgress);
  const bottom=await readRoi(worker,canvas,rect,{x:.415,y:.51,w:.305,h:.35},150,onProgress);
  let rh=top.value,hd=bottom.value;
  let raw=`Rh-Zeile: ${top.log}\nHd-Zeile: ${bottom.log}`;
  if(rh===null || hd===null){
   onProgress('Zusätzlicher Versuch mit vollständigem Display …');
   await worker.setParameters({tessedit_char_whitelist:'0123456789.RhHd:m',tessedit_pageseg_mode:'6'});
   const full=(await worker.recognize(preprocess(canvas,rect,'binary'))).data.text;
   const p=parseOcrText(full);raw+='\nGesamtbild: '+full;
   if(rh===null)rh=p.rh;if(hd===null)hd=p.hd;
  }
  return {rh,hd,raw};
 }finally{if(worker)await worker.terminate();}
}
