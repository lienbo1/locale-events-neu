const CACHE="lokale-events-clean-v1";
const STATIC=["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));
});

self.addEventListener("activate",e=>{
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch",e=>{
  if(e.request.url.includes("/api/")) return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
