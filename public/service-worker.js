/**
 * Service Worker for Layers PWA
 * Handles caching and graceful updates
 */

const CACHE_NAME = 'layers-v2';

// Assets to cache on install (core app shell)
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/fonts.css',
    '/css/colors.css',
    '/css/menu.css',
    '/css/layout.css',
    '/css/layers.css',
    '/css/components.css',
    '/css/loading.css',
    '/fonts/Nunito.woff2',
    '/fonts/CormorantUpright-SemiBold.woff2',
    '/img/icon-192.svg',
    '/img/icon-512.svg',
    '/js/app.js',
    '/js/sw-register.js',
    '/js/ui/toast.js',
    '/js/ui/open-dialog.js',
    '/js/ui/add-layer-dialog.js',
    '/js/ui/about-dialog.js',
    '/js/ui/save-project-dialog.js',
    '/js/ui/project-manager-dialog.js',
    '/js/ui/confirm-dialog.js',
    '/js/ui/canvas-size-dialog.js',
    '/js/ui/effect-picker.js',
    '/js/layers/layer-model.js',
    '/js/layers/layer-stack.js',
    '/js/layers/layer-item.js',
    '/js/layers/effect-params.js',
    '/js/layers/blend-modes.js',
    '/js/utils/export.js',
    '/js/utils/storage.js',
    '/js/utils/project-storage.js',
    '/js/noisemaker/renderer.js',
    '/js/noisemaker/bundle.js',
    '/js/selection/selection-manager.js',
    '/js/selection/clipboard-ops.js',
    '/js/selection/flood-fill.js'
];

// Install event - precache essential assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(() => {
                console.log('[SW] Install complete');
                // Don't skip waiting - let the app control when to update
                // This allows for graceful update prompts
            })
            .catch((error) => {
                console.error('[SW] Install failed:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('layers-') && name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Claiming clients');
            // Take control of all clients immediately after activation
            return self.clients.claim();
        })
    );
});

// Fetch event - network-first for HTML, cache-first for assets
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // Network-first for HTML documents (to get fresh content)
    if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Clone and cache the fresh response
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(() => {
                    // Fall back to cache if network fails
                    return caches.match(request);
                })
        );
        return;
    }

    // Cache-first for assets (JS, CSS, fonts, images)
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // Return cached version, but also fetch fresh version in background
                    fetch(request).then((response) => {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, response);
                        });
                    }).catch(() => {});
                    return cachedResponse;
                }

                // Not in cache - fetch from network
                return fetch(request).then((response) => {
                    // Cache successful responses
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                });
            })
    );
});

// Handle skip waiting message from the app
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
