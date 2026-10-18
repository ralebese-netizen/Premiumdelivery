// chatManager/setup.js
// The main orchestrator: wires DOM events, listeners, and WebSocket.

import { DOM_IDS, CHAT_MODES } from "./constants.js";
import { state } from "./state.js";
import { buildChatUI } from "./renderer.js";
import { startChatListener } from "./listener.js";
import { connectWebSocket } from "./websocket.js";
import {
    sendTextMessage,
    sendImageMessage,
    sendDocumentMessage,
    sendLocationMessage,
    toggleVoiceNote
} from "./senders.js";

export function setupChatSystem(
    db, storage, orderId, role, containerId,
    customerPhone = "", bot = "Zap", onMessageSentCallback = null
) {
    let botName = bot;
    let callback = onMessageSentCallback;

    // Flexible positional args (legacy compatibility)
    if (typeof customerPhone === 'function') {
        callback = customerPhone;
        customerPhone = "";
        botName = "Zap";
    } else if (typeof bot === 'function') {
        callback = bot;
        botName = "Zap";
    }

    // Sync state — senders.js reads from `state`, not from arguments
    state.currentOrderId = orderId;
    state.currentCustomerPhone = customerPhone;
    state.currentUserRole = role;
    state.currentBot = botName;

    // 1. Inject UI (idempotent — safe to call on every open)
    const uiInjected = buildChatUI(containerId, customerPhone);
    if (!uiInjected) return;

    // 2. Start Firestore + WebSocket engines
    startChatListener(db, orderId, role);
    connectWebSocket(orderId, role, botName, db);

    // 3. Grab DOM references
    const modeAppBtn = document.getElementById(DOM_IDS.MODE_APP_BTN);
    const modeWaBtn = document.getElementById(DOM_IDS.MODE_WA_BTN);
    const attachBtn = document.getElementById(DOM_IDS.ATTACH_BTN);
    const attachMenu = document.getElementById(DOM_IDS.ATTACH_MENU);
    const photoBtn = document.getElementById(DOM_IDS.PHOTO_BTN);
    const docBtn = document.getElementById(DOM_IDS.DOC_BTN);
    const locationBtn = document.getElementById(DOM_IDS.LOCATION_BTN);
    const imageInput = document.getElementById(DOM_IDS.IMAGE_INPUT);
    const fileInput = document.getElementById(DOM_IDS.FILE_INPUT);
    const sendBtn = document.getElementById(DOM_IDS.SEND_BTN);
    const inputEl = document.getElementById(DOM_IDS.INPUT);
    const micBtn = document.getElementById(DOM_IDS.MIC_BTN);
    const statusEl = document.getElementById(DOM_IDS.UPLOAD_STATUS);

    // 4. Re-entry guard: if the DOM events are already bound, only refresh
    //    the Firestore listener. Rebinding here would duplicate handlers on
    //    the mode switcher and accumulate listener closures across reopens.
    if (attachBtn.dataset.chatBound) {
        startChatListener(db, orderId, role);
        return;
    }

    // 5. Mode switcher (bound once, first time only)
    modeAppBtn.addEventListener('click', () => {
        state.activeChatMode = CHAT_MODES.APP;
        modeAppBtn.className = "mode-toggle-btn chat-mode-app-active";
        modeWaBtn.className = "mode-toggle-btn";
        sendBtn.style.background = '#e85d21';
        inputEl.placeholder = "Message via App...";
    });

    modeWaBtn.addEventListener('click', () => {
        state.activeChatMode = CHAT_MODES.WHATSAPP;
        modeWaBtn.className = "mode-toggle-btn chat-mode-wa-active";
        modeAppBtn.className = "mode-toggle-btn";
        sendBtn.style.background = '#25D366';
        inputEl.placeholder = "Type message (Delivering via WhatsApp)...";
    });

    // 6. Attach menu toggle
    attachBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        attachMenu.style.display =
            (attachMenu.style.display === 'none' || attachMenu.style.display === '')
                ? 'block'
                : 'none';
    });

    // Outside-click closes the attach menu
    document.addEventListener('click', (e) => {
        if (
            attachMenu.style.display === 'block' &&
            !attachMenu.contains(e.target) &&
            !attachBtn.contains(e.target)
        ) {
            attachMenu.style.display = 'none';
        }
    });

    // 7. Photo picker
    photoBtn.addEventListener('click', () => {
        imageInput.click();
        attachMenu.style.display = 'none';
    });
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        await sendImageMessage(db, storage, orderId, role, file, statusEl);
        e.target.value = '';
    });

    // 8. Document picker
    docBtn.addEventListener('click', () => {
        fileInput.click();
        attachMenu.style.display = 'none';
    });
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        await sendDocumentMessage(db, storage, orderId, role, file, statusEl);
        e.target.value = '';
    });

    // 9. Location
    locationBtn.addEventListener('click', async () => {
        attachMenu.style.display = 'none';
        await sendLocationMessage(db, orderId, role, statusEl);
    });

    // 10. Voice note (uses `this` to reference the mic button)
    micBtn.addEventListener('click', async function () {
        await toggleVoiceNote(db, storage, orderId, role, statusEl, this);
    });

    // 11. Text send (Enter key + send button share this handler)
    const handleSend = async () => {
        const text = inputEl.value;
        if (!text.trim() || !orderId) return;
        inputEl.value = '';
        const success = await sendTextMessage(db, orderId, role, text);
        if (success && callback) callback(text);
    };

    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    // 12. Mark DOM as bound so re-entry skips rebinding
    attachBtn.dataset.chatBound = "true";
}
