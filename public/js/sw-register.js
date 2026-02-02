/**
 * Service Worker Registration - Auto-updates immediately
 *
 * @module sw-register
 */

/**
 * Register the service worker with immediate auto-update
 */
export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return null;
    }

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');

        // Auto-reload when new service worker takes control
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        // If there's a waiting worker, activate it immediately
        if (registration.waiting) {
            registration.waiting.postMessage('skipWaiting');
        }

        // When a new worker is installed, activate it immediately
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && registration.waiting) {
                    registration.waiting.postMessage('skipWaiting');
                }
            });
        });

        // Force check for updates immediately on every page load
        registration.update().catch(() => {});

        return registration;
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        return null;
    }
}
