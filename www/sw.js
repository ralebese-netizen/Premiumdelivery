/* =========================================================================
   Bofelo SAAS Driver Service Worker
   ========================================================================= */

// 🔥 1. REGISTER notificationclick FIRST
self.addEventListener('notificationclick', (event) => {
    console.log('[Driver SW] notificationclick FIRED');
    event.notification.close();

    const DRIVER_APP_URL = 'https://bofeloh.com/sadriver/pbx.html';
    const notificationData = event.notification.data || {};
    const isCall = notificationData.incomingCall === true;
    const orderId = notificationData.orderId || null;
    const baseUrl = notificationData.url || DRIVER_APP_URL;

    let targetUrl;
    try {
        targetUrl = new URL(baseUrl);
    } catch (e) {
        console.error('[Driver SW] Bad URL:', baseUrl, e);
        return;
    }
    if (isCall) targetUrl.searchParams.set('incomingCall', 'true');
    if (orderId) targetUrl.searchParams.set('orderId', orderId);
    const targetHref = targetUrl.href;
    console.log('[Driver SW] Target:', targetHref);

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            console.log('[Driver SW] windowClients count:', windowClients.length);

            const matchingClient = windowClients.find(client => {
                try {
                    const clientUrl = new URL(client.url);
                    return clientUrl.origin === targetUrl.origin &&
                           clientUrl.pathname === targetUrl.pathname;
                } catch { return false; }
            });

            if (matchingClient && 'focus' in matchingClient) {
                if (isCall && 'postMessage' in matchingClient) {
                    try {
                        matchingClient.postMessage({ type: 'play-ringtone', orderId });
                    } catch (e) {
                        console.warn('[Driver SW] postMessage failed:', e);
                    }
                }

                if (typeof matchingClient.navigate === 'function') {
                    return matchingClient.navigate(targetHref)
                        .then((client) => {
                            if (client && 'focus' in client) return client.focus();
                            return client;
                        })
                        .catch((err) => {
                            return matchingClient.focus();
                        });
                }
                return matchingClient.focus();
            }

            if (clients.openWindow) {
                return clients.openWindow(targetHref).catch(err => {
                    console.error('[Driver SW] openWindow FAILED:', err);
                });
            }
            return Promise.resolve();
        })
    );
});

// 2. Now import CDNs and initialize everything else
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const SW_VERSION = 'v11';
const CACHE_PREFIX = 'bofelo-driver';
const DRIVER_APP_URL = 'https://bofeloh.com/sadriver/pbx.html';

if (workbox) {
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    workbox.routing.registerRoute(
        ({ request }) => request.destination === 'script' || request.destination === 'style',
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: `${CACHE_PREFIX}-static-${SW_VERSION}`,
            plugins: [new workbox.expiration.ExpirationPlugin({ maxEntries: 100 })]
        })
    );

    workbox.routing.registerRoute(
        ({ request }) => request.destination === 'image',
        new workbox.strategies.CacheFirst({
            cacheName: `${CACHE_PREFIX}-images-${SW_VERSION}`,
            plugins: [
                new workbox.expiration.ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
                new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] })
            ]
        })
    );

    workbox.routing.registerRoute(
        ({ request }) => request.mode === 'navigate',
        new workbox.strategies.NetworkFirst({
            cacheName: `${CACHE_PREFIX}-html-${SW_VERSION}`,
            networkTimeoutSeconds: 3,
            plugins: [new workbox.cacheableResponse.CacheableResponsePlugin({ statuses: [0, 200] })]
        })
    );

    const driverSyncPlugin = new workbox.backgroundSync.BackgroundSyncPlugin('driver-api-queue', {
        maxRetentionTime: 24 * 60
    });

    workbox.routing.registerRoute(
        ({ url, request }) =>
            request.method === 'POST' &&
            url.hostname.endsWith('execute-api.eu-north-1.amazonaws.com') &&
            url.pathname.startsWith('/default/'),
        new workbox.strategies.NetworkOnly({ plugins: [driverSyncPlugin] })
    );

    workbox.precaching.precacheAndRoute([
        { url: '/sadriver/driver/offline.html', revision: SW_VERSION }
    ]);

    workbox.routing.setCatchHandler(async ({ event }) => {
        const { request } = event;
        if (request.destination === 'document') {
            const cached = await caches.match('/sadriver/driver/offline.html');
            if (cached) return cached;
        }
        if (request.destination === 'image') {
            const fallback = await caches.match('/sadriver/logo-192.png');
            if (fallback) return fallback;
        }
        return Response.error();
    });
}

firebase.initializeApp({
    apiKey: "AIzaSyDEWFybj_bQMCn8QNvc5uSeriwmen-ZfWQ",
    authDomain: "agile-skyline-489209-t3.firebaseapp.com",
    projectId: "agile-skyline-489209-t3",
    storageBucket: "agile-skyline-489209-t3.firebasestorage.app",
    messagingSenderId: "490119776359",
    appId: "1:490119776359:web:c940ba8ddb2cc2fd182cc2"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(async (payload) => {
    console.log('[Driver SW] Received background message:', payload);

    if (payload.notification) {
        console.log('[Driver SW] Chrome will render this — skipping manual showNotification');
        return;
    }

    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        return;
    }

    const isCall = payload.data && payload.data.incomingCall === "true";
    const orderId = payload.data?.orderId || null;

    const notificationTitle =
        payload.data?.title ||
        (isCall ? '📞 Incoming Call' : 'Bofelo Driver Update');

    const notificationOptions = {
        body: payload.data?.body ||
              (isCall ? 'Tap to answer.' : 'You have a new delivery update.'),
        icon: './logo-192.png',
        badge: './logo-192.png',
        vibrate: isCall ? [500, 1000, 500, 1000, 500, 1000, 500, 1000] : [100, 50, 100],
        requireInteraction: isCall,
        tag: isCall ? 'incoming-call' : 'default-update',
        renotify: isCall,
        data: {
            url: DRIVER_APP_URL,
            orderId,
            incomingCall: isCall
        }
    };

    await self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    const CURRENT_CACHES = [
        `${CACHE_PREFIX}-static-${SW_VERSION}`,
        `${CACHE_PREFIX}-images-${SW_VERSION}`,
        `${CACHE_PREFIX}-html-${SW_VERSION}`
    ];
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(name))
                    .map((name) => {
                        return caches.delete(name);
                    })
            );
        })
    );
});
