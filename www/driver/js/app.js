// driver/js/app.js
// Bootstrap: wires all modules together on page load.

import { showToast, hideScreen } from "./ui.js";
import { initBranding } from "./branding.js";
import { initAuthFlow } from "./auth-flow.js";
import { initCallHandlers, handleIncomingCallState, callState } from "./call-handlers.js";
import { initChatModal, openChatModal, closeChatModal } from "./chat-modal.js";
import { initWithdrawal } from "./withdrawal.js";
import { initPWA } from "./pwa.js";

// --- Expose globals for external modules ---
window.showToast = showToast;
window.openChatModal = openChatModal;
window.closeChatModal = closeChatModal;

// --- Capacitor plugins ---
let PushNotifications = null;
let Geolocation = null;
let LocalNotifications = null;
const isNative =
    typeof window !== 'undefined' &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform();

async function loadCapacitorPlugins() {
    if (!isNative) {
        console.log('[Driver] Browser mode — skipping native plugins');
        return;
    }
    try {
        ({ PushNotifications } = await import('@capacitor/push-notifications'));
        ({ Geolocation } = await import('@capacitor/geolocation'));
        ({ LocalNotifications } = await import('@capacitor/local-notifications'));
        console.log('[Driver] Capacitor plugins loaded');
    } catch (e) {
        console.warn('[Driver] Capacitor plugin load failed:', e.message);
    }
}

// --- Fail-safe ---
function showBootFailure(err) {
    console.error('[Driver] Boot failure:', err);
    try {
        const splash = document.getElementById('boot-splash');
        if (splash) splash.style.display = 'none';
        if (!document.getElementById('boot-unlock-style')) {
            const unlock = document.createElement('style');
            unlock.id = 'boot-unlock-style';
            unlock.textContent = '#login-screen { display: block !important; }';
            document.head.appendChild(unlock);
        }
        if (window.showToast) window.showToast('Something went wrong. Please reload.');
    } catch (e) {
        console.error('[Driver] Even fail-safe failed:', e);
    }
}

// --- Bootstrap ---
async function bootstrap() {
    console.log('[Driver] Bootstrap running');
    try {
        await loadCapacitorPlugins();

        requestNativePermissionsAtBoot().catch(e =>
            console.warn('[Driver] Permission request error:', e)
        );

        const safe = (name, fn) => {
            try { fn(); } catch (e) {
                console.error(`[Driver] ${name} failed:`, e);
            }
        };

        safe('initBranding', initBranding);
        safe('initCallHandlers', initCallHandlers);
        safe('initChatModal', initChatModal);
        safe('initWithdrawal', initWithdrawal);
        safe('initPWA', initPWA);

        const openBtn = document.getElementById('open-profile-btn');
        const closeBtn = document.getElementById('close-profile-btn');
        if (openBtn) openBtn.addEventListener('click', () => {
            document.getElementById('profile-modal').style.display = 'block';
        });
        if (closeBtn) closeBtn.addEventListener('click', () => {
            document.getElementById('profile-modal').style.display = 'none';
        });

        initAuthFlow(handleIncomingCallState);

        setupAudioUnlock();
        setupServiceWorkerListener();
        handleIncomingCallFromUrl();
        wireNativePushListeners();

        console.log('[Driver] Bootstrap complete');
    } catch (err) {
        showBootFailure(err);
    }
}

// --- Native permissions & Call Channel Setup ---
async function requestNativePermissionsAtBoot() {
    if (!isNative) return;
    try {
        // 1. Request Push Notifications
        if (PushNotifications) {
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') {
                perm = await PushNotifications.requestPermissions();
            }
            if (perm.receive === 'granted') {
                await PushNotifications.register();
            }
        }

        // 2. Create the high-priority Call Channel
        if (LocalNotifications) {
            try {
                // Delete first to ensure vibration settings update
                await LocalNotifications.deleteChannel({ id: 'bofelo_calls' });
            } catch (e) {}

            await LocalNotifications.createChannel({
                id: 'bofelo_calls',
                name: 'Incoming Calls',
                description: 'Ringing for customer calls',
                importance: 5, // High importance
                visibility: 1, // Public (shows on lock screen)
                sound: 'ringtone',
                vibration: true,
                vibrationPattern: [500, 1000, 500, 1000, 500, 1000]
            });
            console.log('[Native Boot] ✅ Call notification channel created');
        }

        // 3. Request Location
        if (Geolocation) {
            const loc = await Geolocation.checkPermissions();
            if (loc.location === 'prompt') {
                await Geolocation.requestPermissions();
            }
        }
    } catch (e) {
        console.warn('[Native Boot] Permission error:', e);
    }
}

// --- Wire native push listeners ---
function wireNativePushListeners() {
    if (!isNative || !PushNotifications) return;

    PushNotifications.addListener('registration', async (token) => {
        console.log('[FCM/native] Token received:', token.value.slice(0, 20) + '...');
        if (window.receiveNativeFcmToken) {
            await window.receiveNativeFcmToken(token.value);
        }
    });

    PushNotifications.addListener('registrationError', (err) => {
        console.error('[FCM/native] Registration error:', err);
    });

    // 🟢 HANDLE PUSH WHEN APP IS OPEN (FOREGROUND)
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
        console.log('[FCM/native] Push received in foreground:', notification);
        
        if (notification.data && notification.data.type === 'incoming_call') {
            window.currentOrderId = notification.data.orderId;
            
            const banner = document.getElementById('incoming-call-banner');
            if (banner) banner.style.display = 'block';
            
            const ringtone = document.getElementById('order-ringtone');
            if (ringtone) {
                ringtone.play().catch(e => console.warn("Audio blocked:", e));
            }

            // 🟢 NATIVE VIBRATION FALLBACK
            if (LocalNotifications) {
                try {
                    await LocalNotifications.schedule({
                        notifications: [{
                            title: "Incoming Call",
                            body: "Vibrating...",
                            id: Math.floor(Date.now() / 1000),
                            channelId: 'bofelo_calls',
                            sound: null, 
                            attachments: null,
                            actionTypeId: '',
                            extra: null
                        }]
                    });
                    console.log('[Native] Vibration triggered via LocalNotifications');
                } catch (err) {
                    console.warn('[Native] Vibration failed:', err);
                    if (navigator.vibrate) navigator.vibrate([500, 1000, 500, 1000]);
                }
            } else if (navigator.vibrate) {
                navigator.vibrate([500, 1000, 500, 1000, 500, 1000]);
            }
        }
    });

    // 🟢 HANDLE PUSH WHEN USER TAPS IT (BACKGROUND/CLOSED)
    PushNotifications.addListener('pushNotificationActionPerformed', async (action) => {
        console.log('[FCM/native] Push tapped:', action);
        
        if (action.notification.data && action.notification.data.type === 'incoming_call') {
            window.currentOrderId = action.notification.data.orderId;
            
            const banner = document.getElementById('incoming-call-banner');
            if (banner) banner.style.display = 'block';

            const ringtone = document.getElementById('order-ringtone');
            if (ringtone) {
                ringtone.play().catch(e => console.warn("Audio blocked:", e));
            }

            // 🟢 VIBRATE WHEN TAPPED
            if (navigator.vibrate) {
                navigator.vibrate([500, 1000, 500, 1000, 500, 1000]);
            }
        }
    });
}

// --- Token syncing to Firestore ---
window.receiveNativeFcmToken = async (token) => {
    if (!token) return;
    window.nativeFcmToken = token;
    window.currentDriverToken = token;
    await window.syncNativeTokenToFirestore();
};

window.syncNativeTokenToFirestore = async () => {
    if (!window.nativeFcmToken) return { ok: false, reason: 'no-token' };
    if (!window.currentDriverId) return { ok: false, reason: 'no-driver' };

    try {
        const { doc, setDoc, serverTimestamp } = await import(
            "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js"
        );
        const { db } = await import("./firebase-init.js");

        await setDoc(doc(db, "drivers", window.currentDriverId), {
            fcmToken: window.nativeFcmToken,
            fcmPlatform: 'android',
            fcmTokenUpdatedAt: serverTimestamp(),
        }, { merge: true });

        console.log('[FCM/native] ✅ Token synced to Firestore for driver:', window.currentDriverId);
        return { ok: true };
    } catch (e) {
        console.error('[FCM/native] ❌ Token sync failed:', e.code || e.message, e);
        return { ok: false, reason: 'firestore-error', error: e };
    }
};

// --- Audio unlock ---
function setupAudioUnlock() {
    const unlock = () => {
        const elements = [
            document.getElementById('order-ringtone'),
            document.getElementById('meeting-audio'),
        ];
        for (const audio of elements) {
            if (!audio) continue;
            const p = audio.play();
            if (p && typeof p.then === 'function') {
                p.then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
            }
        }
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('keydown', unlock);
}

// --- SW ringtone listener ---
function setupServiceWorkerListener() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== 'play-ringtone') return;
        const ringtone = document.getElementById('order-ringtone') || document.getElementById('notification-chime');
        if (!ringtone) return;
        try {
            ringtone.currentTime = 0;
            const p = ringtone.play();
            if (p && typeof p.then === 'function') {
                p.catch((e) => console.warn('[Driver] Ringtone blocked:', e.message));
            }
        } catch (e) {
            console.warn('[Driver] Ringtone threw:', e.message);
        }
    });
}

// --- URL-driven incoming call ---
function handleIncomingCallFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('incomingCall') !== 'true') return;

        const orderId = params.get('orderId') || null;
        console.log('[Driver] Opened via incoming-call URL', { orderId });

        const banner = document.getElementById('incoming-call-banner');
        if (banner) banner.style.display = 'block';

        if (orderId) {
            window.currentOrderId = orderId;
            callState.incomingCallOrderId = orderId;
            window.dispatchEvent(new CustomEvent('bofeloOrderActive', { detail: orderId }));
        }

        const ringtone = document.getElementById('order-ringtone') || document.getElementById('notification-chime');
        if (!ringtone) return;

        try {
            ringtone.currentTime = 0;
            const p = ringtone.play();
            if (p && typeof p.then === 'function') {
                p.catch((e) => console.warn('[Driver] URL ringtone blocked:', e.message));
            }
        } catch (e) {
            console.warn('[Driver] URL ringtone threw:', e.message);
        }
    } catch (e) {
        console.warn('[Driver] handleIncomingCallFromUrl failed:', e.message);
    }
}

// --- Kick off ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
