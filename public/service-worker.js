/**
 * Service Worker for Layers PWA
 * Network-first strategy - always serves fresh code
 */

const CACHE_NAME = 'layers-v7';

// Only cache static assets that rarely change
const CACHE_ASSETS = [
    '/fonts/Nunito.woff2',
    '/fonts/CormorantUpright-SemiBold.woff2',
    '/img/icon-192.svg',
    '/img/icon-512.svg'
];

// Install - cache fonts/icons only, skip waiting immediately
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CACHE_ASSETS))
            .then(() => self.skipWaiting()) // Activate immediately
    );
});

// Activate - clean old caches, claim clients immediately
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names
                    .filter((name) => name.startsWith('layers-') && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim()) // Take control immediately
    );
});

// Fetch - network-first for everything, cache fallback for offline
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin
    if (url.origin !== location.origin) return;

    // Always try network first
    event.respondWith(
        fetch(request)
            .then((response) => {
                // Cache successful responses for offline fallback
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            })
            .catch(() => caches.match(request)) // Offline fallback
    );
});

// Handle skipWaiting message from app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
