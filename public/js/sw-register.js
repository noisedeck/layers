/**
 * Service Worker Registration - Auto-updates immediately
 *
 * @module sw-register
 */

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return null
    }

    try {
        const registration = await navigator.serviceWorker.register('/service-worker.js')

        let refreshing = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return
            refreshing = true
            window.location.reload()
        })

        if (registration.waiting) {
            registration.waiting.postMessage('skipWaiting')
        }

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing
            if (!newWorker) return

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && registration.waiting) {
                    registration.waiting.postMessage('skipWaiting')
                }
            })
        })

        registration.update().catch(() => {})

        return registration
    } catch (error) {
        console.error('Service Worker registration failed:', error)
        return null
    }
}
