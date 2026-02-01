/**
 * Service Worker Registration with Graceful Updates
 *
 * @module sw-register
 */

import { toast } from './ui/toast.js';

/**
 * Register the service worker and set up update handling
 */
export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.log('[PWA] Service Worker not supported');
        return null;
    }

    console.log('[PWA] Registering service worker...');

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[PWA] Service Worker registered:', registration.scope);
        console.log('[PWA] Status - installing:', !!registration.installing,
                    'waiting:', !!registration.waiting,
                    'active:', !!registration.active);

        // Check for updates on registration
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
                // When new service worker is installed and waiting
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateNotification(newWorker);
                }
            });
        });

        // Handle controller change (when skipWaiting is called)
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        // Check for waiting service worker on page load
        if (registration.waiting) {
            showUpdateNotification(registration.waiting);
        }

        return registration;
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        return null;
    }
}

/**
 * Show a toast notification prompting the user to update
 * @param {ServiceWorker} worker - The waiting service worker
 */
function showUpdateNotification(worker) {
    const toastEl = toast.show('A new version is available', {
        type: 'info',
        duration: 0, // Persistent until dismissed
        closable: true
    });

    // Add update button to the toast
    const updateBtn = document.createElement('button');
    updateBtn.className = 'toast-action';
    updateBtn.textContent = 'Update';
    updateBtn.addEventListener('click', () => {
        updateBtn.disabled = true;
        updateBtn.textContent = 'Updating...';
        worker.postMessage('skipWaiting');
    });

    const messageEl = toastEl.querySelector('.toast-message');
    if (messageEl) {
        messageEl.appendChild(updateBtn);
    }
}

/**
 * Check for service worker updates manually
 * @returns {Promise<boolean>} Whether an update was found
 */
export async function checkForUpdates() {
    if (!('serviceWorker' in navigator)) {
        return false;
    }

    try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
            await registration.update();
            return registration.waiting !== null;
        }
        return false;
    } catch (error) {
        console.error('Update check failed:', error);
        return false;
    }
}
