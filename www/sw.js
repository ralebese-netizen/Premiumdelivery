/* =========================================================================
   Bofelo SAAS Driver Service Worker
   ========================================================================= */

// 🔥 1. REGISTER notificationclick FIRST — before any importScripts that
//       might fail. This guarantees the tap handler is always available.
//
// 🔒 Fix — single window operation per click.
//
//   Chrome only permits ONE of clients.openWindow() or client.focus() per
//   notificationclick handler, and only within ~10s of the click. The
//   previous version could call both (focus on a match, then openWindow on
//   a fallback), and it called focus() inside a loop — which can silently
//   fail and disqualify the subsequent openWindow.
//
//   Corrected: find() first (no side effects), then exactly one of focus
//   or openWindow.
//
// 🔒 Fix — navigate the existing window to the target URL.
//
//   When the app was already open, the old handler just called focus() on
//   the matching window. But that window's URL was whatever it had been —
//   typically pbx.html with no query string. So app.js's
//   handleIncomingCallFromUrl() saw no ?incomingCall=true, and the driver
//   got a ring but no banner and no Answer button.
//
//   Now we call client.navigate(targetHref) which loads the full URL
//   (with ?incomingCall=true&orderId=...) INSIDE the existing tab. The
//   page reloads, app.js runs handleIncomingCallFromUrl(), and the banner
//   appears. Falls back to focus() if navigate() isn't available.
//
// 🟢 NOTE — this handler is now dormant for call/order notifications.
//
//   The Lambda sends a `webpush.notification` block with
//   `webpush.fcm_options.link`, so Chrome renders the notification
//   natively and opens the link on tap. Chrome doesn't fire
//   `notificationclick` for those. The handler below remains as a
//   fallback for any data-only notification that might still arrive.
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

            // 🔒 RULE 1: Look for an existing window FIRST (no side effects).
            const matchingClient = windowClients.find(client => {
                try {
                    const clientUrl = new URL(client.url);
                    return clientUrl.origin === targetUrl.origin &&
                           clientUrl.pathname === targetUrl.pathname;
                } catch { return false; }
            });

            console.log('[Driver SW] matchingClient found:', !!matchingClient);

            // 🔒 RULE 2: If a matching window exists, navigate it to the
            //    full target URL and focus. This is what makes the banner
            //    show up when the app was already open.
            if (matchingClient && 'focus' in matchingClient) {
                // Also postMessage the ringtone — the page might already be
                // loaded and the navigate might be slow. Belt and braces.
                if (isCall && 'postMessage' in matchingClient) {
                    try {
                        matchingClient.postMessage({ type: 'play-ringtone', orderId });
                    } catch (e) {
                        console.warn('[Driver SW] postMessage failed:', e);
                    }
                }

                if (typeof matchingClient.navigate === 'function') {
                    console.log('[Driver SW] Navigating existing client to target');
                    return matchingClient.navigate(targetHref)
                        .then((client) => {
                            if (client && 'focus' in client) return client.focus();
                            return client;
                        })
                        .catch((err) => {
                            console.warn('[Driver SW] navigate failed, falling back to focus:', err);
                            return matchingClient.focus();
                        });
                }

                console.log('[Driver SW] navigate unavailable — focusing only');
                return matchingClient.focus();
            }

            // 🔒 RULE 3: No match → open a new window ONCE.
            console.log('[Driver SW] No matching client — opening new window');
            if (clients.openWindow) {
                return clients.openWindow(targetHref).catch(err => {
                    console.error('[Driver SW] openWindow FAILED:', err);
                });
            }
            console.error('[Driver SW] clients.openWindow is unavailable');
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

// 🔒 Fix — no duplicate notifications.
//
//   The Lambda now sends a `webpush.notification` block with
//   `webpush.fcm_options.link`. Chrome renders that notification natively
//   and handles the tap by opening the link — no service worker
//   involvement required. That's the notification the driver sees and
//   taps successfully.
//
//   Previously, this handler ALSO called showNotification(), producing a
//   SECOND notification whose tap went through the SW's notificationclick
//   path — which Chrome restricts heavily and which failed in practice.
//   The result was two notifications: the Chrome one (worked) and the SW
//   one (didn't).
//
//   Detection: when `payload.notification` is present, Chrome is already
//   rendering the notification. Skip. When it's absent (legacy data-only
//   messages from an older caller), fall through to the manual render so
//   those paths still work.
messaging.onBackgroundMessage(async (payload) => {
    console.log('[Driver SW] Received background message:', payload);

    // 🟢 Chrome auto-renders when a `notification` block is present.
    //    Do not duplicate it.
    if (payload.notification) {
        console.log('[Driver SW] Chrome will render this — skipping manual showNotification');
        return;
    }

    // Legacy data-only path — render manually.
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        console.warn('[Driver SW] Permission not granted — skipping');
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
        icon: '/sadriver/logo-192.png',
        badge: '/sadriver/logo-192.png',
        vibrate: isCall
            ? [500, 1000, 500, 1000, 500, 1000, 500, 1000]
            : [100, 50, 100],
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
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
});
