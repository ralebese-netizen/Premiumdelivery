// notificationManager.js
// Transport layer for push notifications.

import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

const VAPID_KEY = 'BJjRi0UCeIH3J2CYmiti-zMtJK4vicKrD1CHzVWke9uMNJKzNyK3bMrYN_Lxy8-g0yR47Ta4rXUT6xXUV9k95Yc';
const LAMBDA_URL = "https://hem2omj47a.execute-api.eu-north-1.amazonaws.com/default/driver-call-notification";

/**
 * 🟢 Helper to wait for the existing sw.js to be ready.
 * We do NOT register a new /firebase-messaging-sw.js because your
 * app already registers './sw.js' in pwa.js.
 */
async function getExistingSWRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        // navigator.serviceWorker.ready resolves when the SW is active
        // and controlling the current page.
        return await navigator.serviceWorker.ready;
    } catch (error) {
        console.error("[NotificationManager] Service worker not ready:", error);
        return null;
    }
}

/**
 * 🟢 PERMISSION & TOKEN FETCH FUNCTION
 * 
 * Triggers the browser notification prompt and safely fetches the FCM token.
 * Must be called from a direct user click event.
 */
export async function requestNotificationPermissionAndToken(messaging) {
    if (!messaging) return { token: "", error: "Messaging not initialized" };

    if (!('Notification' in window) || typeof window.Notification === 'undefined') {
        return { token: "", error: "unsupported" };
    }

    try {
        // 1. Trigger the prompt (If already granted, this resolves instantly)
        const permission = await window.Notification.requestPermission();
        
        if (permission !== 'granted') {
            return { token: "", error: "denied" };
        }

        // 2. Ensure the existing sw.js is active
        const swRegistration = await getExistingSWRegistration();
        if (!swRegistration) {
            return { token: "", error: "service_worker_failed" };
        }

        // 3. Fetch the token with a short retry loop
        let token = "";
        for (let i = 0; i < 3; i++) {
            try {
                token = await getToken(messaging, { 
                    vapidKey: VAPID_KEY, 
                    serviceWorkerRegistration: swRegistration 
                });
                if (token) break;
            } catch (err) {
                console.warn(`[NotificationManager] Token attempt ${i + 1} failed:`, err);
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
 * Retrieves this device's FCM token silently (without prompting).
 * Used during login to check if we already have permission.
 */
export async function getDeviceToken(messaging) {
    if (!messaging) return "";
    
    if (!('Notification' in window) || typeof window.Notification === 'undefined') return "";
    if (window.Notification.permission !== 'granted') return "";

    try {
        const swRegistration = await getExistingSWRegistration();
        if (!swRegistration) return "";

        return await getToken(messaging, { 
            vapidKey: VAPID_KEY, 
            serviceWorkerRegistration: swRegistration 
        });
    } catch (error) {
        console.warn("[NotificationManager] Silent token fetch failed:", error);
        return "";
    }
}

export async function storeTokenInFirestore(db, userId, token) {
    if (!db || !userId || !token) return;
    try {
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        await setDoc(doc(db, "drivers", userId), { fcmToken: token }, { merge: true });
    } catch (error) {
        console.error("[NotificationManager] Failed to store token:", error);
    }
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
