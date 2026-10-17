// NivelFeldbuch v1.2: Projekt enthält beliebig viele unabhängige Nivellement-Schleifen.
// Altdaten aus v1.0/v1.1 werden 1:1 als erste Schleife übernommen.
const id=()=>globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createRun(name='Schleife 1',tol='3,0'){
 return {id:id(),name,startPoint:'HFP-01',startH:'100,0000',endPoint:'',endH:'',tolerance:tol,
  showAdjustment:false,obs:[],history:[],confirmedStart:false,created:Date.now()};
}
export function createProject(name='Neues Projekt'){
 const r=createRun();return {id:id(),name,runs:[r],activeRun:r.id,created:Date.now()};
}
export function migrateState(input){
 if(!input||!Array.isArray(input.projects)) throw Error('Ungültiger Datenbestand.');
 const projects=input.projects.map(p=>{
   if(Array.isArray(p.runs)){
     if(!p.runs.length) throw Error('Projekt ohne Schleife.');
     const runs=p.runs.map(r=>({...r,history:Array.isArray(r.history)?r.history:[],confirmedStart:r.confirmedStart!==false}));
     return {...p,runs,activeRun:runs.some(r=>r.id===p.activeRun)?p.activeRun:runs[0].id};
   }
   if(!Array.isArray(p.obs)) throw Error('Ungültiges Altprojekt.');
   const r={...p,id:id(),name:'Schleife 1',history:Array.isArray(p.history)?p.history:[],confirmedStart:true};
   return {id:p.id,name:p.name||'Projekt',created:p.created||Date.now(),runs:[r],activeRun:r.id};
 });
 const active=projects.some(p=>p.id===input.active)?input.active:projects[0]?.id||null;
 return {version:2,projects,active};
}
export function getRun(project){return project?.runs.find(r=>r.id===project.activeRun) || project?.runs[0] || null;}
