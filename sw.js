const CACHE='nivelfeldbuch-v1.2.0';
const CORE=['./','./index.html','./style.css','./app.mjs','./state.mjs','./calc.mjs','./ocr.mjs','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',ev=>{ev.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',ev=>{ev.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',ev=>{
 const url=new URL(ev.request.url);
 if(ev.request.method!=='GET'||url.origin!==self.location.origin)return;
 ev.respondWith(fetch(ev.request).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(ev.request,copy));}return res;}).catch(()=>caches.match(ev.request)));
});
