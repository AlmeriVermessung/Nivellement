// Almeri Feldbuch — Rechenkern. Alle Höhen intern als 0,1 mm (= 0,0001 m).
// Distanzbasierte Korrektur: einfaches streckenproportionales Verteilen eines
// bekannten Schlussfehlers auf einen einzelnen RB/VB-Messzug.
// Dies ist KEINE Netz-Ausgleichung nach kleinsten Quadraten.
export function parseMeters(input, {allowNegative=false, max=100000}={}) {
  const s = String(input ?? '').trim().replace(/\s/g,'').replace(',','.');
  if (!/^[+-]?\d+(?:\.\d{1,4})?$/.test(s)) throw new Error('Bitte eine Zahl in Metern mit maximal 4 Nachkommastellen eingeben.');
  const n = Number(s);
  if (!Number.isFinite(n) || (!allowNegative && n < 0) || Math.abs(n) > max) throw new Error('Wert außerhalb des zulässigen Bereichs.');
  return Math.round(n * 10000);
}
export function formatM(ticks, digits=4) { return (ticks / 10000).toFixed(digits).replace('.',','); }
export function formatSignedMm(ticks) {return (ticks/10 >= 0 ? '+':'')+(ticks/10).toFixed(1).replace('.',',')+' mm';}
// Soll-Ablesung und Markierungsabweichung in 0,1-mm-Ticks.
// Positive Abweichung: gemessene Punkthöhe liegt über der Sollhöhe.
export function calculateStakeout(instrumentHeight, targetHeight, measuredReading=null){
 if(!Number.isInteger(instrumentHeight)||!Number.isInteger(targetHeight)||
    (measuredReading!==null&&!Number.isInteger(measuredReading)))
   throw new Error('Ungültige Höhen- oder Ablesungswerte.');
 const requiredReading=instrumentHeight-targetHeight;
 return {requiredReading, reachableWithUprightStaff:requiredReading>=0,
   deviation:measuredReading===null?null:requiredReading-measuredReading};
}
export function checkSequence(run) {
  if (!run || !Array.isArray(run.obs)) throw new Error('Projekt unvollständig');
  let pending=String(run.startPoint||'').trim(), known=parseMeters(run.startH,{allowNegative:true});
  if(!pending)throw new Error('Startpunkt fehlt.');
  let hi=null,station=0,sumRB=0,sumVB=0,length=0,measuredLegs=0;
  const rows=[],pointHeights=new Map([[pending,known]]),stationReadings=[],stations=[];
  for(let i=0;i<run.obs.length;i++) {
    const o=run.obs[i],kind=o.kind;
    if(!['RB','ZB','VB'].includes(kind))throw new Error(`Zeile ${i+1}: Ungültiger Messungstyp.`);
    const point=String(o.point||'').trim();if(!point)throw new Error(`Zeile ${i+1}: Punktnummer fehlt.`);
    if(String(o.targetH??'').trim()){
      if(kind!=='ZB')throw new Error(`Zeile ${i+1}: Sollhöhe ist nur bei Zwischenblicken zulässig.`);
      parseMeters(o.targetH,{allowNegative:true});
    }
    const reading=parseMeters(o.reading,{max:10});
    if(reading>70000)throw new Error(`Zeile ${i+1}: Lattenablesung ist ungewöhnlich hoch.`);
    let distance=null;
    if(String(o.dist??'').trim()!=='') {
      distance=parseMeters(o.dist,{max:1000})/10000;
      if(distance<=0)throw new Error(`Zeile ${i+1}: Eingegebene Entfernung muss größer als 0 m sein.`);
    }
    if(kind==='RB') {
      if(hi!==null)throw new Error(`Zeile ${i+1}: Vor dem nächsten Rückblick ist ein Vorblick erforderlich.`);
      if(point!==pending)throw new Error(`Zeile ${i+1}: Rückblick muss auf ${pending} erfolgen.`);
      station++;hi=known+reading;sumRB+=reading;
      if(distance!==null){length+=distance;measuredLegs++;}
      stationReadings.length=0;
      stations.push({no:station,startPoint:pending,startHeight:known,rbDistance:distance,vbDistance:null,vbPoint:null});
      rows.push({...o,station,kind,height:known,hi,diff:null,distance,readingTicks:reading,method:'RB'});
    } else {
      if(hi===null)throw new Error(`Zeile ${i+1}: Zuerst einen Rückblick erfassen.`);
      const height=hi-reading;
      const latest=stationReadings.length?stationReadings.at(-1):rows.at(-1);
      const diff=latest.readingTicks-reading;
      if(kind==='VB') {
        sumVB+=reading;pending=point;known=height;hi=null;
        stations.at(-1).vbDistance=distance;
        stations.at(-1).vbPoint=point;
        stations.at(-1).endHeight=height;
        if(distance!==null){length+=distance;measuredLegs++;}
      }
      stationReadings.push({readingTicks:reading,point,height});
      pointHeights.set(point,height);
      rows.push({...o,station,kind,height,hi:kind==='VB'?null:hi,diff,distance,readingTicks:reading,method:kind});
    }
  }
  const last=rows.at(-1),lastMeasured=[...rows].reverse().find(r=>r.kind!=='RB');
  const finalH=last?(last.kind==='RB'?known:last.height):parseMeters(run.startH,{allowNegative:true});
  let closure=null;
  if(String(run.endH??'').trim()!==''&&String(run.endPoint??'').trim()) {
    const endPoint=run.endPoint.trim();
    if(lastMeasured && lastMeasured.point===endPoint) {
      const expected=parseMeters(run.endH,{allowNegative:true});
      closure={actual:lastMeasured.height,expected,error:lastMeasured.height-expected,point:endPoint,
        closedStation:lastMeasured.kind==='VB',isLastObservation:lastMeasured===last};
    }
  }
  const scale=parseFloat(String(run.tolerance??'3').replace(',','.'));
  const tolMm=Number.isFinite(scale)&&scale>0?scale:3;
  const riseFallCumulative=rows.filter(r=>r.kind!=='RB').reduce((sum,r)=>sum+(r.diff??0),0);
  const expectedLegs=station*2,missingLegs=expectedLegs-measuredLegs;
  const totalBackDistance=stations.reduce((sum,s)=>sum+(s.rbDistance??0),0);
  const totalForeDistance=stations.reduce((sum,s)=>sum+(s.vbDistance??0),0);
  // Jede vollständige Standpunkthöhendifferenz RB−VB erhält das Gewicht
  // (Distanz RB + Distanz VB). ZB sind Seitensichten und zählen nicht zur Zuglänge.
  const adjustment={available:false,reason:'',totalLength:null,errorTicks:closure?.error??null,stations:[],rows:[]};
  if(!closure)adjustment.reason='Für die Ausgleichung Zielpunkt und Sollhöhe hinterlegen und den Messzug dort abschließen.';
  else if(!closure.closedStation||!closure.isLastObservation||hi!==null)
    adjustment.reason='Der letzte Messwert muss ein Vorblick auf den Zielhöhenfestpunkt sein (Standpunkt vollständig abgeschlossen).';
  else if(stations.some(s=>s.vbPoint===null))adjustment.reason='Mindestens ein Standpunkt ist nicht abgeschlossen.';
  else if(stations.some(s=>s.rbDistance===null||s.vbDistance===null))
    adjustment.reason='Für eine streckenproportionale Ausgleichung müssen sämtliche RB- und VB-Distanzen eingetragen sein.';
  else {
    const total=stations.reduce((a,s)=>a+s.rbDistance+s.vbDistance,0);
    if(!(total>0))adjustment.reason='Die Gesamtstrecke muss größer als 0 m sein.';
    else {
      adjustment.available=true;adjustment.totalLength=total;
      let cum=0;
      const stationCorrections=new Map();
      for(const s of stations) {
        const correctionStart=cum===0?0:Math.round(-closure.error*cum/total);
        cum+=s.rbDistance+s.vbDistance;
        const correctionEnd=Math.round(-closure.error*cum/total);
        const entry={...s,legLength:s.rbDistance+s.vbDistance,cumLength:cum,correctionStart,correctionEnd,
          correctedEndHeight:s.endHeight+correctionEnd};
        adjustment.stations.push(entry);
        stationCorrections.set(s.no,entry);
      }
      adjustment.rows=rows.map(r=>{
        const s=stationCorrections.get(r.station);
        // ZB: abgeleitete Höhe aus der am Standpunktstart korrigierten Höhe.
        // Keine eigene (unabhängige) ZB-Ausgleichung.
        const correction=r.kind==='VB'?s.correctionEnd:s.correctionStart;
        return {...r,correction,adjustedHeight:r.height+correction};
      });
    }
  }
  return {rows,stations,station,pending,needsBacksight:hi===null,hi,finalH,sumRB,sumVB,length,measuredLegs,expectedLegs,missingLegs,
    closure,tolMm,totalBackDistance,totalForeDistance,pointHeights,netRise:sumRB-sumVB,riseFallCumulative,last,adjustment};
}
export function csvForRun(run, projectName=run.name) {
 const c=checkSequence(run),q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const enabled=!!run.showAdjustment&&c.adjustment.available;
 const out=[['Projekt',projectName],['Schleife',run.name],['Startpunkt',run.startPoint],['Starthöhe [m]',run.startH],['Zielpunkt',run.endPoint||''],
  ['Sollhöhe Ziel [m]',run.endH||''],['Streckenausgleichung gewählt',run.showAdjustment?'ja':'nein'],
  ['Streckenausgleichung berechenbar',c.adjustment.available?'ja':'nein'],[],
  ['Nr','Zeit','Standpunkt','Typ','Punkt','Lattenablesung [m]','Distanz Hd [m]','Berechnete Höhe roh [m]',
    'Steigen/Fallen [m]','Instrumentenhöhe roh [m]','Korrektur [mm]','Höhe streckenproportional korrigiert [m]',
    'Erfassung','Bemerkung','OCR Rohtext','Absteckung Sollhöhe [m]','Soll-Ablesung [m]','Abweichung Ist minus Soll [mm]']];
 for(let i=0;i<c.rows.length;i++){
  const r=c.rows[i],adjusted=enabled?c.adjustment.rows[i]:null;
  const targetTicks=String(r.targetH??'').trim()?parseMeters(r.targetH,{allowNegative:true}):null;
  const st=targetTicks!==null&&r.kind==='ZB'?calculateStakeout(r.hi,targetTicks,r.readingTicks):null;
  out.push([i+1,new Date(r.time).toLocaleString('de-DE'),r.station,r.kind,r.point,formatM(r.readingTicks),
    r.distance===null?'':r.distance.toFixed(4).replace('.',','),formatM(r.height),r.diff===null?'':formatM(r.diff),
    r.hi===null?'':formatM(r.hi),adjusted?(adjusted.correction/10).toFixed(1).replace('.',','):'',
    adjusted?formatM(adjusted.adjustedHeight):'',r.source||'manuell',r.note||'',r.ocrRaw||'',
    st?formatM(targetTicks):'',st?formatM(st.requiredReading):'',
    st?(st.deviation/10).toFixed(1).replace('.',','):'']);
 }
 out.push([],['Summe Rückblicke [m]',formatM(c.sumRB)],['Summe Vorblicke [m]',formatM(c.sumVB)],
   ['Höhenunterschied (ΣRB−ΣVB) [m]',formatM(c.netRise)],
   ['Summe Steigen/Fallen der Messfolgen [m]',formatM(c.riseFallCumulative)],
   ['RB/VB-Distanzen erfasst',`${c.measuredLegs} von ${c.expectedLegs}`],
   ['Σ Rückblick-Distanzen [m]',c.totalBackDistance.toFixed(4).replace('.',',')],
   ['Σ Vorblick-Distanzen [m]',c.totalForeDistance.toFixed(4).replace('.',',')],
   ['Streckenlänge RB+VB, nur erfasste [m]',c.length.toFixed(4).replace('.',',')]);
 if(c.closure)out.push(['Schlussabweichung roh [mm]',(c.closure.error/10).toFixed(1).replace('.',',')],
   ['Benutzer-Toleranz [mm]',String(c.tolMm).replace('.',',')]);
 if(enabled)out.push(['Ausgleichungsmethode','Schlussfehler proportional zu RB+VB-Strecken je abgeschlossenem Standpunkt'],
   ['Ausgeglichene Zielhöhe [m]',formatM(c.adjustment.rows.at(-1).adjustedHeight)],
   ['Hinweis zu ZB','Zwischenblicke nur mit Standpunktstart-Korrektur fortgeführt; keine eigene statistische Ausgleichung']);
 else out.push(['Streckenausgleichung nicht angewendet',c.adjustment.reason||'Nicht ausgewählt']);
 if(c.closure&&Math.abs(c.closure.error/10)>c.tolMm)out.push(['ACHTUNG','Roh-Schlussfehler überschreitet die projektspezifische Toleranz. Messung und Bezugspunkte prüfen, Korrektur ist KEINE Freigabe.']);
 out.push(['Hinweis','Einfache streckenproportionale Korrektur für einen Zug; keine Netz-Ausgleichung oder unabhängiger Genauigkeitsnachweis']);
 if(run.history?.length){out.push([],['Änderungsprotokoll (Messungen zurückgenommen / Messart geändert)'],['Zeit','Aktion','Originalart','Punkt','Rh [m]','Bemerkung']);for(const a of run.history)out.push([new Date(a.time).toLocaleString('de-DE'),a.type,a.observation?.kind||'',a.observation?.point||'',a.observation?.reading||'',a.details||'']);}
 return '\uFEFF'+out.map(arr=>arr.map(q).join(';')).join('\r\n');
}
