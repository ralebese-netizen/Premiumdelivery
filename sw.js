/* =========================================================================
   Bofelo SAAS Driver Service Worker (Workbox + Firebase)
   Enterprise Upgrade: Offline Sync & Call State Persistence
   ========================================================================= */

// 1. Import Workbox and Firebase (Using CDNs)
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

if (workbox) {
    console.log(`[Driver SW] Workbox Loaded. Initializing isolated driver scope.`);
    
    // Ensure the new service worker takes over immediately
    workbox.core.skipWaiting();
    workbox.core.clientsClaim();

    /* ----------------------------------------------------------------------
       2. ISOLATED CACHING STRATEGIES (Unique to Driver App)
       ---------------------------------------------------------------------- */
    
    // A. Static Assets (CSS, JS) -> Stale-While-Revalidate
    workbox.routing.registerRoute(
        ({request}) => request.destination === 'script' || request.destination === 'style',
        new workbox.strategies.StaleWhileRevalidate({
            cacheName: 'bofelo-driver-static-v2', // UNIQUE NAME
            plugins: [
                new workbox.expiration.ExpirationPlugin({ maxEntries: 50 })
            ]
        })
    );

    // B. Driver Specific Images -> Cache First (Saves data on the road)
    workbox.routing.registerRoute(
        ({request}) => request.destination === 'image',
        new workbox.strategies.CacheFirst({
            cacheName: 'bofelo-driver-images-v2', // UNIQUE NAME
            plugins: [
                new workbox.expiration.ExpirationPlugin({ 
                    maxEntries: 50, 
                    maxAgeSeconds: 30 * 24 * 60 * 60 
                })
            ]
        })
    );

    // C. Main Driver HTML File -> Network First
    workbox.routing.registerRoute(
        ({request}) => request.mode === 'navigate',
        new workbox.strategies.NetworkFirst({
            cacheName: 'bofelo-driver-html-v2', // UNIQUE NAME
            networkTimeoutSeconds: 3
        })
    );

    /* ----------------------------------------------------------------------
       3. OFFLINE BACKGROUND SYNC (Crucial for Field Drivers)
       ---------------------------------------------------------------------- */
    const driverSyncPlugin = new workbox.backgroundSync.BackgroundSyncPlugin('driver-api-queue', {
        maxRetentionTime: 24 * 60 // Syncs order completions even 24 hours later if signal returns
    });

    workbox.routing.registerRoute(
        ({url}) => url.pathname.startsWith('/api/'), 
        new workbox.strategies.NetworkOnly({ plugins: [driverSyncPlugin] }),
        'POST'
    );
}

/* ----------------------------------------------------------------------
   4. FIREBASE INITIALIZATION
   ---------------------------------------------------------------------- */
firebase.initializeApp({
    apiKey: "AIzaSyDEWFybj_bQMCn8QNvc5uSeriwmen-ZfWQ",
    authDomain: "agile-skyline-489209-t3.firebaseapp.com",
    projectId: "agile-skyline-489209-t3",
    storageBucket: "agile-skyline-489209-t3.firebasestorage.app",
    messagingSenderId: "490119776359",
    appId: "1:490119776359:web:c940ba8ddb2cc2fd182cc2"
});

const messaging = firebase.messaging();

/* ----------------------------------------------------------------------
   5. BACKGROUND PUSH NOTIFICATIONS & CALL ROUTING
   ---------------------------------------------------------------------- */
messaging.onBackgroundMessage((payload) => {
    console.log('[Driver SW] Received background message: ', payload);
    
    // Check if this payload is flagged as an actual WebRTC phone call
    const isCall = payload.data && payload.data.incomingCall === "true";
    
    const notificationTitle = payload.notification?.title || payload.data?.title || 'Bofelo Driver Update';
    
    const notificationOptions = {
        body: payload.notification?.body || payload.data?.body || 'You have a new delivery update.',
        icon: 'logo.png',
        badge: 'logo.png',
        
        // 🌟 ENTERPRISE FIX: If it's a call, do a heavy, continuous vibration pattern to wake the driver
        vibrate: isCall ? [500, 1000, 500, 1000, 500, 1000, 500, 1000] : [100, 50, 100],
        
        // 🌟 ENTERPRISE FIX: Force the notification to stay on screen until answered/dismissed
        requireInteraction: isCall,
        tag: isCall ? 'incoming-call' : 'default-update',
        renotify: isCall,
        
        data: { 
            // Opens the main Driver app interface where the WebRTC banner lives
            url: './index.html' 
        }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

/* ----------------------------------------------------------------------
   6. SMART CLICK ROUTING (Forces focus on App instead of opening new tabs)
   ---------------------------------------------------------------------- */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // Read the URL from the notification data, fallback to index.html
    const urlToOpen = (event.notification.data && event.notification.data.url) 
        ? event.notification.data.url 
        : './index.html';
        
    const targetUrl = new URL(urlToOpen, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // If the app is already open in the background, bring it to the front
            for (let client of windowClients) {
                if (client.url === targetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            // If the app is fully closed, open a new window
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});

