// Service Worker — faz o app funcionar offline e permite instalação
const CACHE = 'maya-v1'
const ARQUIVOS = ['/', '/index.html', '/manifest.json']

// Instala e guarda os arquivos em cache
self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ARQUIVOS))
  )
})

// Quando o app pede um arquivo, tenta o cache primeiro
self.addEventListener('fetch', ev => {
  ev.respondWith(
    caches.match(ev.request).then(cached => cached || fetch(ev.request))
  )
})