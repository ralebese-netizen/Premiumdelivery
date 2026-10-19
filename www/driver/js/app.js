// driver/js/app.js
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

// --- Capacitor plugins (safe dynamic import) ---
let PushNotifications = null;
let Geolocation = null;
const isNative = typeof window !== 'undefined'
    && window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();

async function loadCapacitorPlugins() {
    if (!isNative) {
        console.log('[Driver] Browser mode — skipping native plugins');
        return;
    }
    try {
        ({ PushNotifications } = await import('@capacitor/push-notifications'));
        ({ Geolocation } = await import('@capacitor/geolocation'));
        console.log('[Driver] Capacitor plugins loaded');
    } catch (e) {
        console.warn('[Driver] Capacitor plugin load failed:', e.message);
    }
}

// --- Fail-safe: always unblock UI on any boot error ---
function showBootFailure(err) {
    console.error('[Driver] Boot failure:', err);
    try {
        const splash = document.getElementById('boot-splash');
        if (splash) splash.style.display = 'none';

        // Override the global !important lock for the login screen
        if (!document.getElementById('boot-unlock-style')) {
            const unlock = document.createElement('style');
            unlock.id = 'boot-unlock-style';
            unlock.textContent = '#login-screen { display: block !important; }';
            document.head.appendChild(unlock);
        }
        if (window.showToast) {
            window.showToast('Something went wrong. Please reload.');
        }
    } catch (e) {
        console.error('[Driver] Even fail-safe failed:', e);
    }
}

// --- Bootstrap ---
async function bootstrap() {
    console.log('[Driver] Bootstrap running');
    try {
        // Load Capacitor plugins first (non-fatal if unavailable)
        await loadCapacitorPlugins();

        // Request native permissions (non-blocking)
        requestNativePermissionsAtBoot().catch(e =>
            console.warn('[Driver] Permission request error:', e)
        );

        // Each init wrapped individually — a broken module shouldn't kill the rest
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

        // Profile modal wiring
        const openBtn = document.getElementById('open-profile-btn');
        const closeBtn = document.getElementById('close-profile-btn');
        if (openBtn) openBtn.addEventListener('click', () => {
            document.getElementById('profile-modal').style.display = 'block';
        });
        if (closeBtn) closeBtn.addEventListener('click', () => {
            document.getElementById('profile-modal').style.display = 'none';
        });

        // Auth flow is the one that hides the splash
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

// --- Native permissions ---
async function requestNativePermissionsAtBoot() {
    if (!isNative) return;
    try {
        if (PushNotifications) {
            let perm = await PushNotifications.checkPermissions();
            if (perm.receive === 'prompt') {
                perm = await PushNotifications.requestPermissions();
            }
            if (perm.receive === 'granted') {
                await PushNotifications.register();
            }
        }
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

// --- Native push registration listener ---
function wireNativePushListeners() {
    if (!isNative || !PushNotifications) return;
    PushNotifications.addListener('registration', async (token) => {
        console.log('Native Push Token:', token.value);
        if (window.receiveNativeFcmToken) {
            window.receiveNativeFcmToken(token.value);
        }
    });
    PushNotifications.addListener('registrationError', (err) => {
        console.error('[Native Push] Registration error:', err);
    });
}

// --- Token syncing to Firestore ---
window.receiveNativeFcmToken = async (token) => {
    console.log('Received Native FCM Token:', token);
    window.nativeFcmToken = token;
    window.currentDriverToken = token;
    await window.syncNativeTokenToFirestore();
};

window.syncNativeTokenToFirestore = async () => {
    if (!window.nativeFcmToken || !window.currentDriverId) {
        console.log('[Token sync] Deferred — waiting for driver ID');
        return;
    }
    try {
        const { doc, setDoc } = await import(
            "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js"
        );
        const { db } = await import("./firebase-init.js");
        await setDoc(
            doc(db, "drivers", window.currentDriverId),
            { fcmToken: window.nativeFcmToken },
            { merge: true }
        );
        console.log('[Token sync] Saved for driver:', window.currentDriverId);
    } catch (e) {
        console.warn('[Token sync] Failed:', e.message);
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
        console.log('[Driver] SW requested ringtone', { orderId: data.orderId });
        const ringtone =
            document.getElementById('order-ringtone') ||
            document.getElementById('notification-chime');
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

        const ringtone =
            document.getElementById('order-ringtone') ||
            document.getElementById('notification-chime');
        if (!ringtone) return;

        const tryPlay = () => {
            try {
                ringtone.currentTime = 0;
                const p = ringtone.play();
                if (p && typeof p.then === 'function') {
                    p.catch((e) => console.warn('[Driver] URL ringtone blocked:', e.message));
                }
            } catch (e) {
                console.warn('[Driver] URL ringtone threw:', e.message);
            }
        };

        tryPlay();
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
