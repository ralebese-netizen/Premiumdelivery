// driver/js/app.js
import { showToast, hideScreen } from "./ui.js";
import { initBranding } from "./branding.js";
import { initAuthFlow } from "./auth-flow.js";
import { initCallHandlers, handleIncomingCallState, callState } from "./call-handlers.js";
import { initChatModal, openChatModal, closeChatModal } from "./chat-modal.js";
import { initWithdrawal } from "./withdrawal.js";
import { initPWA } from "./pwa.js";
import { env } from "../../orderManager/state.js";

window.showToast = showToast;
window.openChatModal = openChatModal;
window.closeChatModal = closeChatModal;

function bootstrap() {
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
    handleIncomingCallFromUrl();
}

window.receiveNativeFcmToken = async (token) => {
    window.nativeFcmToken = token; 
    window.currentDriverToken = token;
    env.nativeToken = token;
    await syncNativeTokenToFirestore();
};

window.syncNativeTokenToFirestore = async () => {
    if (!window.nativeFcmToken || !window.currentDriverId) return;
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
    const { db } = await import("./firebase-init.js");
    await setDoc(doc(db, "drivers", window.currentDriverId), { fcmToken: window.nativeFcmToken }, { merge: true });
};

function setupAudioUnlock() {
    const unlock = () => {
        const elements = [document.getElementById('order-ringtone'), document.getElementById('meeting-audio')];
        for (const audio of elements) {
            if (!audio) continue;
            const p = audio.play();
            if (p && typeof p.then === 'function') p.then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
        }
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    document.addEventListener('keydown', unlock);
}

function handleIncomingCallFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('incomingCall') !== 'true') return;
        const orderId = params.get('orderId') || null;
        const banner = document.getElementById('incoming-call-banner');
        if (banner) banner.style.display = 'block';
        if (orderId) {
            window.currentOrderId = orderId;
            callState.incomingCallOrderId = orderId;
            window.dispatchEvent(new CustomEvent('bofeloOrderActive', { detail: orderId }));
        }
        const ringtone = document.getElementById('order-ringtone') || document.getElementById('notification-chime');
        if (!ringtone) return;
        const tryPlay = () => { try { ringtone.currentTime = 0; ringtone.play().catch(() => {}); } catch (e) {} };
        tryPlay();
    } catch (e) {}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else bootstrap();
