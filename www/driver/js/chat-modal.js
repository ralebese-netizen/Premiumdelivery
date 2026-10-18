import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, storage } from "./firebase-init.js";
import { setupChatSystem, stopChatListener } from "../../chatManager.js";
import { setupPBXButton } from "../../pbxManager.js";
import { sendPush } from "../../notificationManager.js";
import { callState, startOutboundCall } from "./call-handlers.js";
import { showScreen, hideScreen, showToast } from "./ui.js";
let openInFlight = false;
export function initChatModal() {
    const closeBtn = document.getElementById('close-chat-btn');
    const startCallBtn = document.getElementById('start-call-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeChatModal);
    if (startCallBtn) startCallBtn.addEventListener('click', startOutboundCall);
}
export async function openChatModal(orderId) {
    if (!orderId || openInFlight) return;
    openInFlight = true;
    callState.activeChatOrderId = orderId;
    showScreen('chat-modal');
    const chatContainer = document.getElementById('chat-container-module');
    const pbxContainer = document.getElementById('pbx-call-container');
    if (!chatContainer || !pbxContainer) { openInFlight = false; return; }
    try { setupPBXButton('pbx-call-container', db, orderId, window.currentDriverId); } catch (e) {}
    let customerPhone = "";
    try { const orderDoc = await getDoc(doc(db, "orders", orderId)); if (orderDoc.exists()) customerPhone = orderDoc.data().whatsappPhone || orderDoc.data().phone || ""; } catch (e) {}
    if (!document.getElementById('chat-container-module')) { openInFlight = false; return; }
    try {
        setupChatSystem(db, storage, orderId, "Driver", "chat-container-module", customerPhone, async (text) => {
            try {
                const orderDoc = await getDoc(doc(db, "orders", orderId));
                if (orderDoc.exists() && orderDoc.data().fcmToken) await sendPush({ token: orderDoc.data().fcmToken, title: "New Driver Message", body: text, orderId, kind: 'chat' });
            } catch (e) {}
        });
    } catch (e) {
        chatContainer.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#ef4444;font-family:Inter,sans-serif;"><p style="font-size:14px;font-weight:600;margin:0 0 8px 0;">Failed to load chat</p><p style="font-size:12px;color:#6b7280;margin:0 0 16px 0;">${e.message || 'Unknown error'}</p><button onclick="location.reload()" style="background:#e85d21;color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;">Reload app</button></div>`;
        showToast("Chat failed to load");
    } finally { openInFlight = false; }
}
export function closeChatModal() {
    hideScreen('chat-modal');
    try { stopChatListener(); } catch (e) {}
    callState.activeChatOrderId = null;
    const chatContainer = document.getElementById('chat-container-module');
    const pbxContainer = document.getElementById('pbx-call-container');
    if (chatContainer) chatContainer.innerHTML = '';
    if (pbxContainer) pbxContainer.innerHTML = '';
    openInFlight = false;
}
