const CACHE_NAME = 'campusaura-v1.41.0'
const CACHE_PREFIX = 'campusaura-'
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './accommodation.html',
  './marketplace.html',
  './events.html',
  './contact.html',
  './privacy.html',
  './terms.html',
  './account-frozen.html',
  './student.html',
  './provider.html',
  './admin.html',
  './auth.html',
  './reset-password.html',
  './register.html',
  './verify.html',
  './offline.html',
  './css/style.css',
  './css/rebuild.css',
  './css/home.css',
  './css/legal.css',
  './css/auth.css',
  './css/admin.css',
  './css/provider.css',
  './js/app.js',
  './js/pwa.js',
  './js/theme.js',
  './js/auth.js',
  './js/password-visibility.js',
  './js/reset-password.js',
  './js/email.js',
  './js/eventsScroll.js',
  './js/register.js',
  './js/verify.js',
  './js/student.js',
  './js/provider.js',
  './js/admin.js',
  './js/dashboard-nav.js',
  './js/supabase.js',
  './js/account-frozen.js',
  './images/books.jpeg',
  './images/P47.jpeg',
  './images/airpods.jpeg',
  './images/calculators.jpeg',
  './images/clothing.jpeg',
  './images/earphones.jpeg',
  './images/event1.jpeg',
  './images/event2.jpeg',
  './images/event3.jpeg',
  './images/event4.jpeg',
  './images/event5.jpeg',
  './images/hero-illustration.svg',
  './images/flash_drives.jpeg',
  './images/headphones.jpeg',
  './images/jacket.jpeg',
  './images/labcoats.jpeg',
  './images/laptop.jpeg',
  './images/laptop_chargers.jpeg',
  './images/market.jpeg',
  './images/mouse.jpeg',
  './images/mouse_pad.jpeg',
  './images/phone_chargers.jpeg',
  './images/phone_stand.jpeg',
  './images/pouchs.jpeg',
  './images/powerbanks.jpeg',
  './images/room.jpeg',
  './images/room1.jpeg',
  './images/room2.jpeg',
  './images/room3.jpeg',
  './images/room4.jpeg',
  './images/room5.jpeg',
  './images/students.jpeg',
  './icons/icon.png',
  './icons/android-chrome-192x192.png',
  './icons/android-chrome-512x512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-16x16.png',
  './icons/favicon-32x32.png',
  './icons/site.webmanifest'
]

function cacheResponse(request, response) {
  const cacheControl = response.headers.get('Cache-Control') || ''
  if (!response.ok || /(?:private|no-store)/i.test(cacheControl)) return Promise.resolve(response)

  return caches.open(CACHE_NAME)
    .then((cache) => cache.put(request, response.clone()))
    .then(() => response)
    .catch((error) => {
      console.warn('CampusAura could not update its offline cache:', error)
      return response
    })
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => clients.forEach((client) => client.postMessage({
        type: 'CAMPUSAURA_VERSION',
        version: CACHE_NAME
      })))
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CAMPUSAURA_GET_VERSION') {
    event.source?.postMessage({ type: 'CAMPUSAURA_VERSION', version: CACHE_NAME })
  }
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => cacheResponse(event.request, response))
        .catch(() => caches.open(CACHE_NAME).then((cache) =>
          cache.match(event.request)
            .then((cached) => cached || cache.match('./offline.html'))
        ))
    )
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cached) => {
      if (cached) return cached

      return fetch(event.request).then((response) => cacheResponse(event.request, response))
    })
  )
})
