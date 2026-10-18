// driver/js/chat-modal.js
// Chat modal: open, close, and wire up chat + PBX call buttons.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, storage } from "./firebase-init.js";
import { setupChatSystem, stopChatListener } from "./chatManager.js";
import { setupPBXButton } from "./pbxManager.js";
import { sendPush } from "./notificationManager.js";
import { callState, startOutboundCall } from "./call-handlers.js";
import { showScreen, hideScreen, showToast } from "./ui.js";

// 🟢 In-flight lock — prevents double-open race when user taps Contact twice fast
let openInFlight = false;

export function initChatModal() {
    const closeBtn = document.getElementById('close-chat-btn');
    const startCallBtn = document.getElementById('start-call-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeChatModal);
    if (startCallBtn) startCallBtn.addEventListener('click', startOutboundCall);
}

export async function openChatModal(orderId) {
    if (!orderId) {
        console.warn('[Chat] openChatModal called with no orderId');
        return;
    }

    // 🟢 Guard: refuse concurrent opens
    if (openInFlight) {
        console.warn('[Chat] Already opening a chat modal — ignoring duplicate call');
        return;
    }
    openInFlight = true;

    callState.activeChatOrderId = orderId;
    showScreen('chat-modal');

    const chatContainer = document.getElementById('chat-container-module');
    const pbxContainer = document.getElementById('pbx-call-container');
    if (!chatContainer || !pbxContainer) {
        console.error('[Chat] Missing chat modal containers in DOM');
        openInFlight = false;
        return;
    }

    // PBX button — non-critical, failure shouldn't blank the modal
    try {
        setupPBXButton('pbx-call-container', db, orderId, window.currentDriverId);
    } catch (e) {
        console.warn('[Chat] PBX button setup failed:', e);
    }

    // Fetch customer phone for WhatsApp-mode routing
    let customerPhone = "";
    try {
        const orderDoc = await getDoc(doc(db, "orders", orderId));
        if (orderDoc.exists()) {
            const oData = orderDoc.data();
            customerPhone = oData.whatsappPhone || oData.phone || "";
        }
    } catch (e) {
        console.warn('[Chat] Could not fetch customer phone:', e);
    }

    // 🟢 If the modal was closed while we were awaiting, bail out
    if (!document.getElementById('chat-container-module')) {
        console.warn('[Chat] Modal closed during open — aborting');
        openInFlight = false;
        return;
    }

    // Mount chat — critical path, guard with try/catch and show fallback UI
    try {
        setupChatSystem(
            db,
            storage,
            orderId,
            "Driver",
            "chat-container-module",
            customerPhone,
            async (text) => {
                try {
                    const orderDoc = await getDoc(doc(db, "orders", orderId));
                    if (orderDoc.exists() && orderDoc.data().fcmToken) {
                        await sendPush({
                            token: orderDoc.data().fcmToken,
                            title: "New Driver Message",
                            body: text,
                            orderId,
                            kind: 'chat',
                        });
                    }
                } catch (e) {
                    console.warn('[Chat] Notification dispatch failed:', e);
                }
            }
        );
    } catch (e) {
        console.error('[Chat] setupChatSystem failed:', e);
        chatContainer.innerHTML = `
            <div style="padding:40px 20px;text-align:center;color:#ef4444;font-family:Inter,sans-serif;">
                <p style="font-size:14px;font-weight:600;margin:0 0 8px 0;">Failed to load chat</p>
                <p style="font-size:12px;color:#6b7280;margin:0 0 16px 0;">${e.message || 'Unknown error'}</p>
                <button onclick="location.reload()" style="background:#e85d21;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;">Reload app</button>
            </div>
        `;
        showToast("Chat failed to load");
    } finally {
        openInFlight = false;
    }
}

export function closeChatModal() {
    hideScreen('chat-modal');
    try { stopChatListener(); } catch (e) { console.warn('[Chat] stopChatListener error:', e); }
    callState.activeChatOrderId = null;
    const chatContainer = document.getElementById('chat-container-module');
    const pbxContainer = document.getElementById('pbx-call-container');
    if (chatContainer) chatContainer.innerHTML = '';
    if (pbxContainer) pbxContainer.innerHTML = '';
    openInFlight = false;
}
