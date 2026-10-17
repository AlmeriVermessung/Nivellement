import {parseMeters,formatM,formatSignedMm,checkSequence,csvForRun} from './calc.mjs?v=1.3.1';
import {runOcr} from './ocr.mjs?v=1.3.1';
import {createRun,createProject,migrateState,getRun} from './state.mjs?v=1.3.1';
const $=id=>document.getElementById(id);
let state={version:3,projects:[],active:null}, project=null, run=null, calc=null, selectedKind='RB',activeTab='messen';
let pendingPhoto=null, pendingOcrText='', pendingSource='manuell', photoCanvas=$('photoCanvas'), photoRect={x:.175,y:.38,w:.60,h:.185};
let storageWarning='', db=null,saveTimer=0,toastTimer=0;
const uuid=()=>crypto.randomUUID?.()||String(Date.now()+Math.random());
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const setMsg=(msg)=>{const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),3500)};
const legacyDbName=['ni','vel','feld','buch','-data'].join('');
const legacyStateKey=['ni','vel','feld','buch','-state'].join('');
function openDb(name){return new Promise((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('kv'))req.result.createObjectStore('kv');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function readDb(){
 try{db=await openDb('almeri-feldbuch-data');const value=await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readonly');const rq=tx.objectStore('kv').get('state');rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);});if(value)return value;}catch(e){}
 try{const legacyDb=await openDb(legacyDbName);const value=await new Promise((resolve,reject)=>{const tx=legacyDb.transaction('kv','readonly');const rq=tx.objectStore('kv').get('state');rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);});try{legacyDb.close();}catch{}if(value){try{db=await openDb('almeri-feldbuch-data');}catch{}return value;}}catch(e){}
 try{return JSON.parse(localStorage.getItem('almeri-feldbuch-state'))||JSON.parse(localStorage.getItem(legacyStateKey));}catch{return null;}
}
function writeDb(value){return new Promise((resolve,reject)=>{if(!db)return reject(Error('DB nicht verfügbar'));const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(value,'state');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
async function load(){
 let saved=null;
 try{saved=await readDb();}catch(e){
  storageWarning='Nur temporäre Speicherung verfügbar';
  try{saved=JSON.parse(localStorage.getItem('almeri-feldbuch-state'))||JSON.parse(localStorage.getItem(legacyStateKey));}catch{}
 }
 try{state=saved?.projects?.length?migrateState(saved):{version:3,projects:[],active:null};}
 catch(e){storageWarning='Datenfehler: JSON-Sicherung prüfen';setMsg('Gespeicherte Projekte nicht geladen: '+e.message);return;}
 if(!state.projects.length){const created=createProject();state.projects=[created];state.active=created.id;}
 project=state.projects.find(p=>p.id===state.active)||state.projects[0];state.active=project.id;
 run=getRun(project);project.activeRun=run.id;
 try{for(const p of state.projects)for(const r of p.runs)checkSequence(r);}catch(e){
  storageWarning='Fehler im Altbestand – bitte Sicherung prüfen';setMsg(e.message);return;
 }
 chooseKind('RB');renderAll();fillProject();persist();
 if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
function persist(){clearTimeout(saveTimer);$('storageState').textContent='Speichere …';saveTimer=setTimeout(async()=>{
 try{if(db)await writeDb(state);else {localStorage.setItem('almeri-feldbuch-state',JSON.stringify(state));localStorage.setItem(legacyStateKey,JSON.stringify(state));}$('storageState').textContent=storageWarning||'Lokal gespeichert';}
 catch(e){$('storageState').textContent='Sicherung dringend erforderlich';setMsg('Speicherfehler. Bitte JSON-Sicherung exportieren!');}
},300);}
function current(){try{return checkSequence(run)}catch(e){setMsg('Datenfehler: '+e.message);return null}}
function goTab(tab){activeTab=tab;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-content').forEach(p=>p.classList.toggle('hidden',p.id!==`tab-${tab}`));if(tab==='projekt')fillProject();if(tab==='feldbuch')renderLedger();}
function chooseKind(kind){
 selectedKind=kind;document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('selected',b.dataset.kind===kind));
 const c=current(); if(c && kind==='RB')$('pointInput').value=c.needsBacksight?c.pending:run.startPoint;
 // Beim Umschalten zwischen ZB und VB Punktnummer und Entwurf behalten.
 updatePreview();
}
function formatHeight(t){return Number.isFinite(t)?formatM(t)+' m':'—';}
function renderAll(){calc=current(); if(!calc)return;
 $('activeName').textContent=project.name;$('summaryInfo').textContent=`${run.name} · ${run.obs.length} Messungen · ${calc.station} Standpunkte`;
 $('loopSelect').innerHTML=project.runs.map(r=>`<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('');
 $('loopSelect').value=run.id;
 $('undoLastQuick').disabled=run.obs.length===0;
 $('reclassifyLast').classList.toggle('hidden',run.obs.at(-1)?.kind!=='VB');
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
  if(run.obs.length===0 && !run.confirmedStart && !confirm('Für diese Schleife sind noch die Beispielwerte HFP-01 / 100,0000 m eingestellt. Sind Startpunkt und Starthöhe wirklich richtig?'))return;
  if(v===0 && !confirm('Rh = 0,0000 m. Das kann ein Display-Platzhalter sein. Ist dies ein tatsächlich gemessener Wert?'))return;
  const o={id:uuid(),kind:selectedKind,point,reading:formatM(v),dist:dist?formatM(parseMeters(dist,{max:1000})): '',note,time:Date.now(),source:pendingSource,ocrRaw:pendingOcrText,photo:pendingPhoto};
  const candidate={...run,obs:[...run.obs,o]};checkSequence(candidate);
  run.obs.push(o);run.confirmedStart=true;persist();pendingPhoto=null;pendingSource='manuell';pendingOcrText='';$('ocrFlag').textContent='';$('readingInput').value='';$('distanceInput').value='';$('noteInput').value='';$('pointInput').value='';
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

function fillProject(){
 if(!run)return;
 $('projectName').value=project.name;
 $('runName').value=run.name;
 for(const [id,key] of [['startPoint','startPoint'],['startH','startH'],['endPoint','endPoint'],['endH','endH'],['tolerance','tolerance']])$(id).value=run[key]??'';
 $('startPoint').disabled=run.obs.length>0;$('startH').disabled=run.obs.length>0;
 $('projectCount').textContent=state.projects.length+' Projekte';
 $('loopCount').textContent=project.runs.length+' Schleifen';
 $('loopList').innerHTML=project.runs.map(r=>`<div class="project-entry"><div><strong>${escapeHtml(r.name)}</strong><span class="muted">${r.obs.length} Messungen · ${escapeHtml(r.startPoint)} → ${escapeHtml(r.endPoint||'offen')}</span></div><div class="row-actions"><button class="${r.id===run.id?'secondary':'ghost'}" data-loop="${escapeHtml(r.id)}">${r.id===run.id?'Aktiv':'Öffnen'}</button><button class="ghost" data-delete-loop="${escapeHtml(r.id)}">Löschen</button></div></div>`).join('');
 $('projectList').innerHTML=state.projects.map(p=>`<div class="project-entry"><div><strong>${escapeHtml(p.name)}</strong><span class="muted">${p.runs.length} Schleife(n) · ${p.runs.reduce((a,r)=>a+r.obs.length,0)} Messungen</span></div><div class="row-actions"><button class="${p.id===project.id?'secondary':'ghost'}" data-switch="${escapeHtml(p.id)}">${p.id===project.id?'Aktiv':'Öffnen'}</button><button class="ghost" data-delete-project="${escapeHtml(p.id)}">Löschen</button></div></div>`).join('');
 document.querySelectorAll('[data-switch]').forEach(b=>b.addEventListener('click',()=>switchProject(b.dataset.switch)));
 document.querySelectorAll('[data-loop]').forEach(b=>b.addEventListener('click',()=>switchLoop(b.dataset.loop)));
 document.querySelectorAll('[data-delete-loop]').forEach(b=>b.addEventListener('click',()=>deleteLoop(b.dataset.deleteLoop)));
 document.querySelectorAll('[data-delete-project]').forEach(b=>b.addEventListener('click',()=>deleteProject(b.dataset.deleteProject)));
}
function saveProjectName(){
 const name=$('projectName').value.trim();if(!name){setMsg('Projektname fehlt.');return;}
 project.name=name;persist();renderAll();fillProject();setMsg('Projektname gespeichert');
}
function saveProject(){try{
 const name=$('runName').value.trim(),startPoint=$('startPoint').value.trim();
 if(!name||!startPoint)throw Error('Schleifenname und Startpunkt sind erforderlich.');
 const startH=$('startH').value.trim();parseMeters(startH,{allowNegative:true});
 const endPoint=$('endPoint').value.trim(),endH=$('endH').value.trim();
 if((endPoint&&!endH)||(!endPoint&&endH))throw Error('Zielpunkt und Sollhöhe bitte gemeinsam angeben.');
 if(endH)parseMeters(endH,{allowNegative:true});
 const tol=$('tolerance').value.trim().replace(',','.');
 if(!/^(?:\d+)(?:\.\d+)?$/.test(tol)||+tol<=0||+tol>1000)throw Error('Schlussgrenze bitte als mm >0 angeben.');
 if(run.obs.length&&(run.startPoint!==startPoint||parseMeters(run.startH,{allowNegative:true})!==parseMeters(startH,{allowNegative:true})))throw Error('Startpunkt / Starthöhe lassen sich nach Messbeginn nicht ändern.');
 const updated={...run,name,startPoint,startH:formatM(parseMeters(startH,{allowNegative:true})),endPoint,
  endH:endH?formatM(parseMeters(endH,{allowNegative:true})):'',tolerance:tol.replace('.',','),confirmedStart:true};
 checkSequence(updated);Object.assign(run,updated);
 persist();renderAll();fillProject();setMsg('Schleifeneinstellungen gespeichert');goTab('messen');
 }catch(e){setMsg(e.message);}
}
function clearDraft(){pendingPhoto=null;pendingSource='manuell';pendingOcrText='';$('ocrFlag').textContent='';
 for(const id of ['readingInput','distanceInput','noteInput','pointInput'])$(id).value='';}
function switchProject(id){const p=state.projects.find(x=>x.id===id);if(!p)return;
 project=p;run=getRun(p);state.active=p.id;project.activeRun=run.id;clearDraft();renderAll();chooseKind(current().needsBacksight?'RB':'ZB');persist();goTab('messen');}
function switchLoop(id){const r=project.runs.find(x=>x.id===id);if(!r)return;
 run=r;project.activeRun=r.id;clearDraft();renderAll();chooseKind(current().needsBacksight?'RB':'ZB');persist();goTab('messen');}
function addProject(){const p=createProject();state.projects.push(p);project=p;run=getRun(p);state.active=p.id;clearDraft();persist();renderAll();fillProject();goTab('projekt');setMsg('Neues Projekt angelegt. Startpunkt und Höhe prüfen.');}
function addLoop(){
 const r=createRun(`Schleife ${project.runs.length+1}`,run.tolerance);
 project.runs.push(r);run=r;project.activeRun=r.id;clearDraft();persist();renderAll();fillProject();goTab('projekt');
 setMsg('Neue unabhängige Schleife angelegt: Startpunkt und -höhe einstellen!');
}
function deleteLoop(id=run?.id){
 const target=project.runs.find(x=>x.id===id);if(!target)return;
 if(!confirm(`Schleife „${target.name}“ wirklich löschen? ${target.obs.length} Messung(en) und alle Einstellungen dieser Schleife gehen verloren.`))return;
 project.runs=project.runs.filter(x=>x.id!==target.id);
 if(!project.runs.length){project.runs=[createRun('Schleife 1',target.tolerance||'3,0')];}
 if(target.id===run.id||!project.runs.some(x=>x.id===project.activeRun))project.activeRun=project.runs[0].id;
 run=getRun(project);clearDraft();persist();renderAll();fillProject();goTab('projekt');setMsg('Schleife gelöscht');
}
function deleteProject(id=project?.id){
 const target=state.projects.find(x=>x.id===id);if(!target)return;
 if(!confirm(`Projekt „${target.name}“ wirklich löschen? ${target.runs.length} Schleife(n) und alle zugehörigen Messungen gehen verloren.`))return;
 state.projects=state.projects.filter(x=>x.id!==target.id);
 if(!state.projects.length){const replacement=createProject();state.projects=[replacement];state.active=replacement.id;}
 else if(state.active===target.id){state.active=state.projects[0].id;}
 project=state.projects.find(x=>x.id===state.active)||state.projects[0];run=getRun(project);project.activeRun=run.id;
 clearDraft();persist();renderAll();fillProject();goTab('projekt');setMsg('Projekt gelöscht');
}
function exportFile(filename,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),45000);}
function safeName(s){return String(s).replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g,'_').slice(0,45);}
function reportCsv(){try{exportFile(safeName(project.name)+'_'+safeName(run.name)+'_Feldbuch.csv',csvForRun(run,project.name),'text/csv;charset=utf-8');}catch(e){setMsg(e.message);}}
function allLoopsCsv(){try{
 const content='\uFEFF'+project.runs.map(r=>csvForRun(r,project.name).replace(/^\uFEFF/,'')).join('\r\n\r\n');
 exportFile(safeName(project.name)+'_alle_Schleifen.csv',content,'text/csv;charset=utf-8');
 }catch(e){setMsg(e.message);}}
function exportJson(){exportFile('AlmeriFeldbuch_Sicherung_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({version:3,exportedAt:new Date().toISOString(),...state},null,2),'application/json');}
async function importFile(file){if(!file)return;try{
 const raw=JSON.parse(await file.text()),obj=migrateState(raw);
 if(!obj.projects.length)throw Error('Keine Projekte in der Sicherung.');
 for(const p of obj.projects)for(const r of p.runs)checkSequence(r);
 if(!confirm(`Die Sicherung enthält ${obj.projects.length} Projekte und ${obj.projects.reduce((n,p)=>n+p.runs.length,0)} Schleifen. Aktuelle Daten ersetzen? Bitte zuvor sichern!`))return;
 state=obj;project=state.projects.find(p=>p.id===state.active)||state.projects[0];run=getRun(project);
 state.active=project.id;clearDraft();persist();renderAll();fillProject();goTab('messen');setMsg('Sicherung importiert');
 }catch(e){setMsg('Import fehlgeschlagen: '+e.message);}}
function recordChange(type,o,details=''){
 if(!Array.isArray(run.history))run.history=[];
 run.history.push({time:Date.now(),type,observation:{...o,photo:o.photo?'[Foto gespeichert]':null},details});
}
function undo(){
 if(!run.obs.length){setMsg('Keine Messung vorhanden.');return;}
 const o=run.obs.at(-1);
 if(!confirm(`Letzte ${o.kind}-Messung auf ${o.point} zurücknehmen? Die Werte werden zum erneuten Speichern in die Eingabe übernommen.`))return;
 recordChange('zurückgenommen',o);
 run.obs.pop();renderAll();chooseKind(o.kind);
 $('pointInput').value=o.point;$('readingInput').value=o.reading;$('distanceInput').value=o.dist||'';$('noteInput').value=o.note||'';
 pendingPhoto=o.photo||null;pendingSource=o.source||'manuell';pendingOcrText=o.ocrRaw||'';
 $('ocrFlag').textContent=pendingPhoto?'Foto aus zurückgenommener Messung erhalten':'';
 updatePreview();persist();goTab('messen');setMsg('Messung zurückgenommen und in Eingabe übernommen');
}
function reclassifyLast(){
 const o=run.obs.at(-1);
 if(!o||o.kind!=='VB'){setMsg('Die letzte Messung ist kein Vorblick.');return;}
 const candidate={...run,obs:[...run.obs.slice(0,-1),{...o,kind:'ZB'}]};
 try{checkSequence(candidate);}catch(e){setMsg('Änderung nicht möglich: '+e.message);return;}
 if(!confirm(`Letzten Vorblick auf ${o.point} in Zwischenblick ändern? Ablesung, Entfernung und Foto bleiben erhalten.`))return;
 recordChange('VB → ZB',o,'Messart von Vorblick auf Zwischenblick geändert');
 o.kind='ZB';persist();renderAll();chooseKind('ZB');setMsg('Vorblick wurde zum Zwischenblick. Standpunkt bleibt offen.');
}
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
 on('saveReading',saveReading);on('saveProject',saveProject);on('saveProjectName',saveProjectName);on('newProject',addProject);on('newLoop',addLoop);on('deleteLoop',()=>deleteLoop());on('deleteProject',()=>deleteProject());
 $('loopSelect').addEventListener('change',ev=>switchLoop(ev.target.value));
 on('undoLastQuick',undo);on('reclassifyLast',reclassifyLast);
 $('adjustToggle').addEventListener('change',ev=>{run.showAdjustment=ev.target.checked;persist();renderLedger();});
 on('exportCsv',reportCsv);on('exportAllLoops',allLoopsCsv);on('exportJson',exportJson);on('printReport',()=>{goTab('feldbuch');window.print();});on('undoReading',undo);
 on('projectSwitcher',()=>goTab('projekt'));
 on('importBackup',()=>$('importFile').click());$('importFile').addEventListener('change',ev=>{importFile(ev.target.files?.[0]);ev.target.value='';});
 on('photoBtn',()=>$('takePhotoInput').click());on('pickPhotoBtn',()=>$('pickPhotoInput').click());
 for(const id of ['takePhotoInput','pickPhotoInput'])$(id).addEventListener('change',ev=>{loadPhoto(ev.target.files?.[0]);ev.target.value='';});
 on('photoClose',()=>$('photoModal').classList.add('hidden'));on('readOcr',readPhoto);on('acceptOcr',acceptOcr);
 on('helpBtn',()=>$('helpModal').classList.remove('hidden'));for(const id of ['helpClose','helpDone'])on(id,()=>$('helpModal').classList.add('hidden'));
 for(const id of ['helpModal','photoModal'])$(id).addEventListener('click',ev=>{if(ev.target===$(id))$(id).classList.add('hidden');});
}
bind();load();
