const CACHE='almeri-feldbuch-v1.4';
const ASSETS=['./','./index.html?v=1.4','./style.css?v=1.4','./app.mjs?v=1.4','./calc.mjs?v=1.4','./ocr.mjs?v=1.4','./state.mjs?v=1.4','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/almeri-logo.png'];
self.addEventListener('install',ev=>{ev.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',ev=>{ev.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',ev=>{if(ev.request.method!=='GET')return;ev.respondWith(caches.match(ev.request,{ignoreSearch:true}).then(hit=>hit||fetch(ev.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(ev.request,copy)).catch(()=>{});return res;}).catch(()=>hit)));});
