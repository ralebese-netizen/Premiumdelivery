// driver/js/app.js
// Bootstrap: wires all modules together on page load.

import { showToast, hideScreen } from "./ui.js";
import { initBranding } from "./branding.js";
import { initAuthFlow } from "./auth-flow.js";
import { initCallHandlers, handleIncomingCallState, callState } from "./call-handlers.js";
import { initChatModal, openChatModal, closeChatModal } from "./chat-modal.js";
import { initWithdrawal } from "./withdrawal.js";
import { initPWA } from "./pwa.js";
import { requestNotificationPermissionAndToken, storeTokenInFirestore } from "./notificationManager.js";

// --- Expose globals for external modules ---
window.showToast = showToast;
window.openChatModal = openChatModal;
window.closeChatModal = closeChatModal;

// --- Bootstrap ---
function bootstrap() {
    console.log('[Driver] Bootstrap running');

    hideScreen('login-screen');
    hideScreen('dashboard');
    hideScreen('pending-approval-screen');
    hideScreen('suspended-screen');
    
    const splash = document.getElementById('boot-splash');
    if (splash) splash.style.display = 'flex';

    initBranding();
    initCallHandlers();
    initChatModal();
    initWithdrawal();
    initPWA();

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
}

// 🟢 POST-LOGIN PERMISSIONS & HARDWARE PROMPTS
// Automatically triggers notification and location popups once the driver logs in
async function handlePostLoginPermissions(userId) {
    if (!userId) return;
    console.log('[Driver] Triggering post-login hardware permissions for user:', userId);

    // 1. Request Notification Permission & FCM Token
    try {
        const { messaging, db } = await import("./firebase-init.js");
        if (messaging) {
            const { token, error } = await requestNotificationPermissionAndToken(messaging);
            if (token) {
                console.log('[Driver] FCM Token acquired successfully on login');
                window.currentDriverToken = token;
                await storeTokenInFirestore(db, userId, token);
            } else {
                console.warn('[Driver] Notification permission not granted or failed:', error);
            }
        }
    } catch (e) {
        console.warn('[Driver] Notification permission flow error:', e.message);
    }

    // 2. Request Location Permission (triggers Android GPS prompt)
    try {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('[Driver] Location permission granted:', position.coords);
                },
                (error) => {
                    console.warn('[Driver] Location permission denied or error:', error.message);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
    } catch (e) {
        console.warn('[Driver] Geolocation request threw:', e.message);
    }
}

// Expose globally so auth-flow or dashboard loader can trigger it once `window.currentDriverId` is set
window.handlePostLoginPermissions = handlePostLoginPermissions;

// 🟢 LISTEN FOR THE NATIVE ANDROID TOKEN
window.receiveNativeFcmToken = async (token) => {
    console.log('Received Native FCM Token from Android:', token);
    window.nativeFcmToken = token; // Save it globally in case the driver ID isn't ready yet
    window.currentDriverToken = token;
    
    // Try to save it to Firestore immediately
    await syncNativeTokenToFirestore();
};

// 🟢 HELPER: Saves the token to the driver's document
window.syncNativeTokenToFirestore = async () => {
    if (!window.nativeFcmToken || !window.currentDriverId) return;
    
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
    const { db } = await import("./firebase-init.js");
    
    await setDoc(doc(db, "drivers", window.currentDriverId), { 
        fcmToken: window.nativeFcmToken 
    }, { merge: true });
    
    console.log('Native token synced to Firestore for driver:', window.currentDriverId);

    // Trigger post-login permission sequence once ID and token sync are active
    handlePostLoginPermissions(window.currentDriverId);
};

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Fix #24 — audio unlock helper.
// ─────────────────────────────────────────────────────────────────────────────
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
                p.then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                }).catch(() => {});
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Fix — service worker ringtone listener.
// ─────────────────────────────────────────────────────────────────────────────
function setupServiceWorkerListener() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== 'play-ringtone') return;

        console.log('[Driver] SW requested ringtone play', { orderId: data.orderId });

        const ringtone =
            document.getElementById('order-ringtone') ||
            document.getElementById('notification-chime');

        if (!ringtone) {
            console.warn('[Driver] No ringtone element found');
            return;
        }

        try {
            ringtone.currentTime = 0;
            const p = ringtone.play();
            if (p && typeof p.then === 'function') {
                p.catch((e) => {
                    console.warn('[Driver] Ringtone play blocked:', e.message);
                });
            }
        } catch (e) {
            console.warn('[Driver] Ringtone play threw:', e.message);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 Fix — ring + show banner when the SW opened this page for a call.
// ─────────────────────────────────────────────────────────────────────────────
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

        if (!ringtone) {
            console.warn('[Driver] No ringtone element for URL-driven ring');
            return;
        }

        const tryPlay = () => {
            try {
                ringtone.currentTime = 0;
                const p = ringtone.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        console.log('[Driver] URL-driven ringtone playing');
                    }).catch((e) => {
                        console.warn('[Driver] URL-driven ringtone blocked:', e.message);
                    });
                }
            } catch (e) {
                console.warn('[Driver] URL-driven ringtone threw:', e.message);
            }
        };

        tryPlay();

        const arm = () => {
            const onFirstGesture = () => {
                document.removeEventListener('click', onFirstGesture);
                document.removeEventListener('touchstart', onFirstGesture);
                document.removeEventListener('keydown', onFirstGesture);
                tryPlay();
            };
            document.addEventListener('click', onFirstGesture, { once: false });
            document.addEventListener('touchstart', onFirstGesture, { once: false });
            document.addEventListener('keydown', onFirstGesture, { once: false });
        };

        setTimeout(() => {
            if (ringtone.paused || ringtone.currentTime === 0) {
                arm();
            }
        }, 100);
    } catch (e) {
        console.warn('[Driver] handleIncomingCallFromUrl failed:', e.message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
