// notificationManager.js
// Transport layer for push notifications.

import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

const VAPID_KEY = 'BJjRi0UCeIH3J2CYmiti-zMtJK4vicKrD1CHzVWke9uMNJKzNyK3bMrYN_Lxy8-g0yR47Ta4rXUT6xXUV9k95Yc';
const LAMBDA_URL = "https://hem2omj47a.execute-api.eu-north-1.amazonaws.com/default/driver-call-notification";

/**
 * 🟢 Get the SW registration, using the cached promise from pwa.js
 * when available. Falls back to navigator.serviceWorker.ready with
 * a hard timeout so login never hangs if the SW fails to register.
 */
async function getExistingSWRegistration() {
    if (!('serviceWorker' in navigator)) {
        console.error('[NotificationManager] SW not supported');
        return null;
    }

    try {
        // 1. Fastest path — pwa.js already registered and cached the promise
        if (window.__swRegistrationPromise) {
            const reg = await window.__swRegistrationPromise;
            if (reg?.active) {
                console.log('[NotificationManager] Using cached SW:', reg.active.scriptURL);
                return reg;
            }
        }

        // 2. Fallback with a hard timeout so we never hang
        const timeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error('SW ready timeout (8s)')), 8000)
        );

        const reg = await Promise.race([
            navigator.serviceWorker.ready,
            timeout
        ]);

        console.log('[NotificationManager] SW ready:', {
            scope: reg.scope,
            url: reg.active?.scriptURL,
            state: reg.active?.state,
        });
        return reg;

    } catch (err) {
        console.error('[NotificationManager] SW ready FAILED:', err.message);
        return null;
    }
}

/**
 * 🟢 Request permission + fetch token (must be called from a user click).
 * Uses the FCM-ready sw.js which is already registered by pwa.js.
 */
export async function requestNotificationPermissionAndToken(messaging) {
    if (!messaging) return { token: "", error: "Messaging not initialized" };

    if (!('Notification' in window) || typeof window.Notification === 'undefined') {
        return { token: "", error: "unsupported" };
    }

    try {
        // 1. Prompt for permission (no-op if already granted)
        const permission = await window.Notification.requestPermission();
        if (permission !== 'granted') {
            return { token: "", error: "denied" };
        }

        // 2. Get the registered sw.js
        const swRegistration = await getExistingSWRegistration();
        if (!swRegistration) {
            return { token: "", error: "service_worker_failed" };
        }

        // 3. Fetch token with retry (SW may still be activating)
        let token = "";
        for (let i = 0; i < 3; i++) {
            try {
                token = await getToken(messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: swRegistration,
                });
                if (token) {
                    console.log('[NotificationManager] ✅ Token fetched on attempt', i + 1);
                    break;
                }
            } catch (err) {
                console.warn(`[NotificationManager] Token attempt ${i + 1} failed:`, err.code || err.message);
            }
            await new Promise(r => setTimeout(r, 1500));
        }

        if (!token) {
            return { token: "", error: "failed_to_generate" };
        }

        return { token, error: null };

    } catch (error) {
        console.error("[NotificationManager] Error in request flow:", error);
        return { token: "", error: "exception" };
    }
}

/**
 * Silent token retrieval — only returns a token if permission is already granted.
 */
export async function getDeviceToken(messaging) {
    if (!messaging) return "";

    if (!('Notification' in window) || typeof window.Notification === 'undefined') return "";
    if (window.Notification.permission !== 'granted') return "";

    try {
        const swRegistration = await getExistingSWRegistration();
        if (!swRegistration) return "";

        const token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swRegistration,
        });
        return token || "";
    } catch (error) {
        console.warn("[NotificationManager] Silent token fetch failed:", error.code || error.message);
        return "";
    }
}

/**
 * Writes `fcmToken` to Firestore. Throws on failure so callers know.
 */
export async function storeTokenInFirestore(db, userId, token) {
    if (!db || !userId || !token) {
        throw new Error('[NotificationManager] Missing arg to storeTokenInFirestore');
    }
    const { doc, setDoc, serverTimestamp } = await import(
        "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js"
    );
    await setDoc(
        doc(db, "drivers", userId),
        {
            fcmToken: token,
            fcmTokenUpdatedAt: serverTimestamp(),
            fcmPlatform: 'web',
        },
        { merge: true }
    );
}

export function setupForegroundListener(messaging, ringtoneElementId = null) {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
        if (ringtoneElementId && typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
            const ringtone = document.getElementById(ringtoneElementId);
            if (ringtone) ringtone.play().catch(e => console.log("Audio blocked:", e));
        }
    });
}

export async function sendPush({ token, title, body, orderId, kind = 'order' } = {}) {
    if (!token) return null;
    const payload = { fcmToken: token, title, body, orderId, kind };
    try {
        const response = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        return await response.json();
    } catch (error) {
        console.error("[NotificationManager] Push failed:", error);
        return null;
    }
}
