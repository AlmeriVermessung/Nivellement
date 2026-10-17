import {parseMeters,formatM,formatSignedMm,checkSequence,csvForRun} from './calc.mjs';
import {runOcr} from './ocr.mjs';
const $=id=>document.getElementById(id);
let state={projects:[],active:null}, run=null, calc=null, selectedKind='RB',activeTab='messen';
let pendingPhoto=null, pendingOcrText='', pendingSource='manuell', photoCanvas=$('photoCanvas'), photoRect={x:.175,y:.38,w:.60,h:.185};
let storageWarning='', db=null,saveTimer=0,toastTimer=0;
const uuid=()=>crypto.randomUUID?.()||String(Date.now()+Math.random());
const newRun=()=>({id:uuid(),name:'Neues Nivellement',startPoint:'HFP-01',startH:'100,0000',endPoint:'',endH:'',tolerance:'3,0',showAdjustment:false,obs:[],created:Date.now()});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const setMsg=(msg)=>{const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),3500)};
function readDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('nivelfeldbuch-data',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');};req.onsuccess=()=>{db=req.result;const tx=db.transaction('kv','readonly');const rq=tx.objectStore('kv').get('state');rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);};req.onerror=()=>reject(req.error);});}
function writeDb(value){return new Promise((resolve,reject)=>{if(!db)return reject(Error('DB nicht verfügbar'));const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(value,'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function load(){
 try{const saved=await readDb();if(saved?.projects?.length)state=saved;}catch(e){
  storageWarning='Nur temporäre Speicherung verfügbar';try{state=JSON.parse(localStorage.getItem('nivelfeldbuch-state'))||state;}catch{}
 }
 if(!state.projects.length){const created=newRun();state.projects=[created];state.active=created.id;}
 run=state.projects.find(p=>p.id===state.active)||state.projects[0];state.active=run.id;
 chooseKind('RB');renderAll();fillProject();persist();
 if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
function persist(){clearTimeout(saveTimer);$('storageState').textContent='Speichere …';saveTimer=setTimeout(async()=>{
 try{if(db)await writeDb(state);else localStorage.setItem('nivelfeldbuch-state',JSON.stringify(state));$('storageState').textContent=storageWarning||'Lokal gespeichert';}
 catch(e){$('storageState').textContent='Sicherung dringend erforderlich';setMsg('Speicherfehler. Bitte JSON-Sicherung exportieren!');}
},300);}
function current(){try{return checkSequence(run)}catch(e){setMsg('Datenfehler: '+e.message);return null}}
function goTab(tab){activeTab=tab;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-content').forEach(p=>p.classList.toggle('hidden',p.id!==`tab-${tab}`));if(tab==='projekt')fillProject();if(tab==='feldbuch')renderLedger();}
function chooseKind(kind){
 selectedKind=kind;document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('selected',b.dataset.kind===kind));
 const c=current(); if(c && kind==='RB')$('pointInput').value=c.needsBacksight?c.pending:run.startPoint;
 else if(kind!=='RB')$('pointInput').value='';
 updatePreview();
}
function formatHeight(t){return Number.isFinite(t)?formatM(t)+' m':'—';}
function renderAll(){calc=current(); if(!calc)return;
 $('activeName').textContent=run.name;$('summaryInfo').textContent=`${run.obs.length} Messungen · ${calc.station} Standpunkte`;
 $('currentHI').textContent=calc.hi!==null?formatHeight(calc.hi):'—';
 $('currentPoint').textContent=calc.pending || run.startPoint;
 $('stageBadge').textContent=calc.needsBacksight?'Rückblick auf '+calc.pending:'Standpunkt offen · ZB oder VB';
 $('stationTag').textContent='Standpunkt '+(calc.needsBacksight?calc.station+1:calc.station);
 document.querySelectorAll('[data-kind]').forEach(b=>{b.disabled=calc.needsBacksight ? b.dataset.kind!=='RB':b.dataset.kind==='RB';});
 if(calc.needsBacksight && selectedKind!=='RB')chooseKind('RB');
 if(!calc.needsBacksight && selectedKind==='RB')chooseKind('ZB');
 $('pointInput').readOnly=selectedKind==='RB';
 if(selectedKind==='RB')$('pointInput').value=calc.pending;
 const recent=[...calc.rows].reverse().slice(0,4);
 $('recentObs').innerHTML=recent.length?recent.map(o=>`<div class="recent-item"><div class="recent-main"><span class="kind-bubble ${o.kind.toLowerCase()}">${o.kind}</span><div><strong>${escapeHtml(o.point)}</strong><div class="muted">${formatM(o.readingTicks)} m · St. ${o.station}</div></div></div><span class="recent-height">${formatM(o.height)} m</span></div>`).join(''):'<p class="muted">Hier erscheinen deine Messungen.</p>';
 updatePreview(); renderLedger();
}
function updatePreview(){const box=$('previewHeight'),hint=$('previewHint');
 try {const c=current(); const read=parseMeters($('readingInput').value,{max:10});
 if(c.needsBacksight){const h=parseMeters(run.startH,{allowNegative:true});box.textContent=formatHeight(c.station===0?h:c.pointHeights.get(c.pending));hint.textContent='Neue Instrumentenhöhe nach Rückblick: '+formatHeight((c.station===0?h:c.pointHeights.get(c.pending))+read);}
 else{box.textContent=formatHeight(c.hi-read);hint.textContent=selectedKind==='VB'?'Nächster Wechselpunkt':'Aktueller Standpunkt';}
 }catch{box.textContent='—';hint.textContent='Lattenablesung eingeben';}
}
function saveReading(){
 if(!calc)return;
 const point=$('pointInput').value.trim(), reading=$('readingInput').value.trim(), dist=$('distanceInput').value.trim(),note=$('noteInput').value.trim();
 if(!point){setMsg('Bitte eine Punktnummer eingeben.');$('pointInput').focus();return;}
 if(!reading){setMsg('Bitte die Lattenablesung eingeben.');$('readingInput').focus();return;}
 try{const v=parseMeters(reading,{max:10});if(v>70000)throw Error('Ablesung über 7 m: bitte überprüfen.');if(dist)parseMeters(dist,{max:1000});
  if(calc.needsBacksight &&(selectedKind!=='RB'||point!==calc.pending))throw Error('Rückblick muss auf '+calc.pending+' erfolgen.');
  if(!calc.needsBacksight && selectedKind==='RB')throw Error('Zunächst Zwischen- oder Vorblick erfassen.');
  if(run.obs.length===0 && run.name==='Neues Nivellement' && !confirm('Das Projekt verwendet noch den Standardnamen und eine beispielhafte Starthöhe. Hast du die richtige Punkthöhe unter „Projekt“ eingestellt?'))return;
  if(v===0 && !confirm('Rh = 0,0000 m. Das kann ein Display-Platzhalter sein. Ist dies ein tatsächlich gemessener Wert?'))return;
  const o={id:uuid(),kind:selectedKind,point,reading:formatM(v),dist:dist?formatM(parseMeters(dist,{max:1000})): '',note,time:Date.now(),source:pendingSource,ocrRaw:pendingOcrText,photo:pendingPhoto};
  const candidate={...run,obs:[...run.obs,o]};checkSequence(candidate);
  run.obs.push(o);persist();pendingPhoto=null;pendingSource='manuell';pendingOcrText='';$('ocrFlag').textContent='';$('readingInput').value='';$('distanceInput').value='';$('noteInput').value='';
  const kind=o.kind;renderAll(); if(kind==='VB')chooseKind('RB');else chooseKind('ZB');
  setMsg(kind==='VB'?'Vorblick gespeichert · Wechselpunkt übernommen':'Messung gespeichert');
 }catch(e){setMsg(e.message);}
}
function renderLedger(){
 const c=current();if(!c)return;
 const show=!!run.showAdjustment&&c.adjustment.available;
 $('adjustToggle').checked=!!run.showAdjustment;
 document.querySelectorAll('.adjust-col').forEach(e=>e.classList.toggle('hidden',!show));
 $('obsCounter').textContent=c.rows.length+' Messungen';
 $('obsRows').innerHTML=c.rows.length?c.rows.map((o,i)=>{
  const adj=show?c.adjustment.rows[i]:null;
  return `<tr><td>${i+1}</td><td>${o.kind}</td><td>${escapeHtml(o.point)}</td><td>${formatM(o.readingTicks)}</td><td>${o.distance===null?'—':o.distance.toFixed(2).replace('.',',')}</td><td>${formatM(o.height)}</td><td>${o.diff===null?'—':formatM(o.diff)}</td>${show?`<td>${formatM(adj.adjustedHeight)}</td><td>${(adj.correction/10).toFixed(1).replace('.',',')}</td>`:''}</tr>`;
 }).join(''):`<tr><td colspan="${show?9:7}" class="muted">Noch keine Messwerte vorhanden.</td></tr>`;
 $('sumDelta').textContent=formatM(c.netRise)+' m';
 $('riseFall').textContent=formatM(c.riseFallCumulative)+' m'+(c.hi!==null?' *':'');
 $('lengthInfo').textContent=(c.hi!==null?'* Aktueller Standpunkt noch offen. ':'')+
   `Summe RB/VB-Visuren: ${c.length.toFixed(2).replace('.',',')} m (RB: ${c.totalBackDistance.toFixed(2).replace('.',',')} m; VB: ${c.totalForeDistance.toFixed(2).replace('.',',')} m). Erfasste RB/VB-Entfernungen: ${c.measuredLegs} von ${c.expectedLegs}. `+
   (c.missingLegs>0?'Die Strecke ist unvollständig und eignet sich so nicht für eine distanzabhängige Korrektur.':'ZB-Entfernungen sind dokumentiert, aber keine Zuglängenanteile.');
 if(c.closure){
  const error=Math.abs(c.closure.error/10),good=error<=c.tolMm;
  $('closureBox').innerHTML=`<div class="${good?'ok':'bad'}"><strong>${formatSignedMm(c.closure.error)}</strong> Schlussabweichung auf ${escapeHtml(c.closure.point)} ${good?'(innerhalb':'(außerhalb'} der eingestellten ±${String(c.tolMm).replace('.',',')} mm)</div><p class="tiny muted">Rohhöhe: ${formatM(c.closure.actual)} m · Soll: ${formatM(c.closure.expected)} m.${!c.needsBacksight?' Aktueller Standpunkt noch offen.':''} Die Schlussgrenze ist anwenderdefiniert, kein Normnachweis.</p>`;
 } else $('closureBox').textContent=run.endPoint&&run.endH?'Zielpunkt '+run.endPoint+' noch nicht als letzter Vor- oder Zwischenblick erfasst.':'Bitte im Projekt Zielpunkt und bekannte Sollhöhe eintragen.';
 if(c.adjustment.available) {
  const last=c.adjustment.rows.at(-1);
  $('adjustmentBox').innerHTML=`<div class="${show?'adjust-rows':''}">Berechenbar aus <strong>${c.adjustment.stations.length} Standpunkten</strong> und <strong>${c.adjustment.totalLength.toFixed(2).replace('.',',')} m</strong> RB/VB-Gesamtstrecke. Schlussfehler: <strong>${formatSignedMm(c.closure.error)}</strong>.${c.closure&&Math.abs(c.closure.error/10)>c.tolMm?`<p class="bad"><b>Warnung:</b> Schlussabweichung größer als die festgelegte Toleranz. Vor Verwendung der korrigierten Höhen Messung prüfen; die Korrektur stellt keinen Genauigkeitsnachweis dar.</p>`:''}${show?`<p> Korrigierte Zielhöhe: <strong>${formatM(last.adjustedHeight)} m</strong>. Die Korrektur wird pro Standpunkt proportional zu RB+VB verteilt; Zwischenblicke übernehmen die Korrektur am Standpunktbeginn.</p>`:' Aktivieren, um zusätzliche Höhenwerte und Korrekturen anzuzeigen und im CSV zu exportieren.'}</div>`;
 } else $('adjustmentBox').textContent='Noch nicht möglich: '+c.adjustment.reason;
}

function fillProject(){if(!run)return;for(const [id,key] of [['projectName','name'],['startPoint','startPoint'],['startH','startH'],['endPoint','endPoint'],['endH','endH'],['tolerance','tolerance']])$(id).value=run[key]??'';
 $('startPoint').disabled=run.obs.length>0;$('startH').disabled=run.obs.length>0;
 $('projectCount').textContent=state.projects.length+' Projekte';
 $('projectList').innerHTML=state.projects.map(p=>`<div class="project-entry"><div><strong>${escapeHtml(p.name)}</strong><span class="muted">${p.obs.length} Messungen · ${new Date(p.created).toLocaleDateString('de-DE')}</span></div><button class="${p.id===run.id?'secondary':'ghost'}" data-switch="${escapeHtml(p.id)}">${p.id===run.id?'Aktiv':'Öffnen'}</button></div>`).join('');
 document.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',()=>switchProject(b.dataset.switch)));
}
function saveProject(){try{
 const name=$('projectName').value.trim(),startPoint=$('startPoint').value.trim();if(!name||!startPoint)throw Error('Projektname und Startpunkt sind erforderlich.');
 const startH=$('startH').value.trim();parseMeters(startH,{allowNegative:true});
 const endPoint=$('endPoint').value.trim(),endH=$('endH').value.trim();if((endPoint&&!endH)||(!endPoint&&endH))throw Error('Zielpunkt und Sollhöhe bitte gemeinsam angeben.');
 if(endH)parseMeters(endH,{allowNegative:true});
 const tol=$('tolerance').value.trim().replace(',','.');if(!/^(?:\d+)(?:\.\d+)?$/.test(tol)||+tol<=0||+tol>1000)throw Error('Schlussgrenze bitte als mm >0 angeben.');
 if(run.obs.length&&(run.startPoint!==startPoint||parseMeters(run.startH,{allowNegative:true})!==parseMeters(startH,{allowNegative:true})))throw Error('Startpunkt / Starthöhe lassen sich nach Messbeginn nicht ändern.');
 Object.assign(run,{name,startPoint,startH:formatM(parseMeters(startH,{allowNegative:true})),endPoint,endH:endH?formatM(parseMeters(endH,{allowNegative:true})):'',tolerance:tol.replace('.',',')});
 checkSequence(run);persist();renderAll();setMsg('Projekteinstellungen gespeichert');goTab('messen');
 }catch(e){setMsg(e.message);}}
function switchProject(id){const p=state.projects.find(x=>x.id===id);if(!p)return;run=p;state.active=p.id;pendingPhoto=null;pendingSource='manuell';$('readingInput').value='';$('distanceInput').value='';renderAll();chooseKind(current().needsBacksight?'RB':'ZB');persist();goTab('messen');}
function addProject(){const r=newRun();state.projects.push(r);run=r;state.active=r.id;persist();renderAll();fillProject();goTab('projekt');setMsg('Neues Projekt erstellt');}
function exportFile(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),45000);}
function safeName(s){return String(s).replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g,'_').slice(0,45);}
function reportCsv(){try{exportFile(safeName(run.name)+'_Feldbuch.csv',csvForRun(run),'text/csv;charset=utf-8');}catch(e){setMsg(e.message);}}
function exportJson(){exportFile('NivelFeldbuch_Sicherung_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),...state},null,2),'application/json');}
async function importFile(file){if(!file)return;try{
 const obj=JSON.parse(await file.text());if(!obj.projects?.length||!Array.isArray(obj.projects))throw Error('Keine gültige NivelFeldbuch-Sicherung.');
 for(const p of obj.projects){if(!p.id||!p.startPoint||!Array.isArray(p.obs))throw Error('Ungültiges Projekt in der Sicherung.');checkSequence(p);}
 if(!confirm(`Die Sicherung enthält ${obj.projects.length} Projekte. Aktuelle Daten durch die Sicherung ersetzen? Bitte vorab sichern!`))return;
 state={projects:obj.projects,active:obj.active};run=state.projects.find(p=>p.id===state.active)||state.projects[0];state.active=run.id;persist();renderAll();fillProject();goTab('messen');setMsg('Sicherung importiert');
 }catch(e){setMsg('Import fehlgeschlagen: '+e.message);}}
function undo(){if(!run.obs.length){setMsg('Keine Messung vorhanden.');return;}const o=run.obs.at(-1);if(!confirm(`Letzte Messung ${o.kind} auf ${o.point} wirklich löschen?`))return;run.obs.pop();persist();renderAll();chooseKind(current().needsBacksight?'RB':'ZB');setMsg('Messung gelöscht');}
// Fotoablauf
async function loadPhoto(file){if(!file)return;
 try{const img=new Image();const u=URL.createObjectURL(file);await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Foto konnte nicht geöffnet werden'));img.src=u;});
  const scale=Math.min(1,1100/img.naturalWidth,1600/img.naturalHeight);photoCanvas.width=Math.round(img.naturalWidth*scale);photoCanvas.height=Math.round(img.naturalHeight*scale);photoCanvas.getContext('2d').drawImage(img,0,0,photoCanvas.width,photoCanvas.height);URL.revokeObjectURL(u);
  photoRect={x:.17,y:.375,w:.63,h:.19};$('cropWidth').value='63';$('cropHeight').value='19';updateCrop();$('ocrReadout').classList.add('hidden');$('ocrStatus').textContent='Rahmen auf die beiden Zeilen Rh und Hd ziehen, dann „Werte erkennen“ wählen.';$('photoModal').classList.remove('hidden');
 }catch(e){setMsg(e.message);}}
function updateCrop(){photoRect.w=Math.min(photoRect.w,1);photoRect.h=Math.min(photoRect.h,1);photoRect.x=Math.max(0,Math.min(1-photoRect.w,photoRect.x));photoRect.y=Math.max(0,Math.min(1-photoRect.h,photoRect.y));const r=$('cropRect');for(const [k,prop] of [['x','left'],['y','top'],['w','width'],['h','height']])r.style[prop]=(photoRect[k]*100)+'%';}
let touchStart=null;
$('cropRect').addEventListener('pointerdown',ev=>{ev.preventDefault();touchStart={px:ev.clientX,py:ev.clientY,x:photoRect.x,y:photoRect.y};$('cropRect').setPointerCapture(ev.pointerId);});
$('cropRect').addEventListener('pointermove',ev=>{if(!touchStart)return;const b=$('cropWrap').getBoundingClientRect();photoRect.x=touchStart.x+(ev.clientX-touchStart.px)/b.width;photoRect.y=touchStart.y+(ev.clientY-touchStart.py)/b.height;updateCrop();});
$('cropRect').addEventListener('pointerup',()=>touchStart=null);$('cropRect').addEventListener('pointercancel',()=>touchStart=null);
$('cropWidth').addEventListener('input',ev=>{photoRect.w=+ev.target.value/100;updateCrop();});
$('cropHeight').addEventListener('input',ev=>{photoRect.h=+ev.target.value/100;updateCrop();});
function cropPhotoSmall(){const c=document.createElement('canvas');const w=photoCanvas.width*photoRect.w,h=photoCanvas.height*photoRect.h;const scale=Math.min(1,800/w);c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));c.getContext('2d').drawImage(photoCanvas,photoCanvas.width*photoRect.x,photoCanvas.height*photoRect.y,w,h,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.7);}
async function readPhoto(){const btn=$('readOcr');btn.disabled=true;$('ocrReadout').classList.add('hidden');try{
 const result=await runOcr(photoCanvas,photoRect,msg=>$('ocrStatus').textContent=msg);
 $('ocrRh').value=result.rh?.replace('.',',')??'';$('ocrHd').value=result.hd?.replace('.',',')??'';$('ocrRaw').textContent=result.raw||'(keine Zeichen erkannt)';
 pendingOcrText=result.raw;$('ocrReadout').classList.remove('hidden');$('ocrStatus').textContent=result.rh===null?'Rh nicht sicher erkannt. Bitte am Originaldisplay ablesen und manuell ergänzen.':'Die Werte sind Vorschläge. Jede Ziffer unbedingt mit dem Displayfoto vergleichen.';
 if(result.rh===null)setMsg('Fotoerkennung unsicher – bitte selbst ablesen.');
 }catch(e){$('ocrStatus').textContent='Fotoerkennung fehlgeschlagen: '+e.message+' · Du kannst die Werte weiter manuell erfassen.';}finally{btn.disabled=false;}}
function acceptOcr(){try{
 const rh=$('ocrRh').value.trim(),hd=$('ocrHd').value.trim();if(!rh)throw Error('Lattenablesung fehlt – bitte ergänzen.');parseMeters(rh,{max:7});if(hd)parseMeters(hd,{max:150});
 $('readingInput').value=rh.replace('.',',');$('distanceInput').value=hd.replace('.',',');pendingPhoto=cropPhotoSmall();pendingSource='foto-geprüft';$('ocrFlag').textContent='✓ Displayfoto angehängt';$('photoModal').classList.add('hidden');updatePreview();setMsg('Werte übernommen – bitte Messung speichern');
 }catch(e){setMsg(e.message);}}
function on(id,fn){$(id).addEventListener('click',fn)}
function bind(){
 document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>goTab(b.dataset.tab)));
 document.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{if(!b.disabled)chooseKind(b.dataset.kind);}));
 for(const id of ['readingInput','pointInput','distanceInput'])$(id).addEventListener('input',updatePreview);
 on('saveReading',saveReading);on('saveProject',saveProject);on('newProject',addProject);
 $('adjustToggle').addEventListener('change',ev=>{run.showAdjustment=ev.target.checked;persist();renderLedger();});
 on('exportCsv',reportCsv);on('exportJson',exportJson);on('printReport',()=>{goTab('feldbuch');window.print();});on('undoReading',undo);
 on('projectSwitcher',()=>goTab('projekt'));
 on('importBackup',()=>$('importFile').click());$('importFile').addEventListener('change',ev=>{importFile(ev.target.files?.[0]);ev.target.value='';});
 on('photoBtn',()=>$('takePhotoInput').click());on('pickPhotoBtn',()=>$('pickPhotoInput').click());
 for(const id of ['takePhotoInput','pickPhotoInput'])$(id).addEventListener('change',ev=>{loadPhoto(ev.target.files?.[0]);ev.target.value='';});
 on('photoClose',()=>$('photoModal').classList.add('hidden'));on('readOcr',readPhoto);on('acceptOcr',acceptOcr);
 on('helpBtn',()=>$('helpModal').classList.remove('hidden'));for(const id of ['helpClose','helpDone'])on(id,()=>$('helpModal').classList.add('hidden'));
 for(const id of ['helpModal','photoModal'])$(id).addEventListener('click',ev=>{if(ev.target===$(id))$(id).classList.add('hidden');});
}
bind();load();
