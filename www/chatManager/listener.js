// chatManager/listener.js
// Firestore realtime listener with retry-until-DOM-exists logic.

import { collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { DOM_IDS, ATTACH_MAX_ATTEMPTS, ATTACH_RETRY_DELAY_MS } from "./constants.js";
import { state } from "./state.js";
import { appendMessageToUI } from "./renderer.js";

export function startChatListener(db, orderId, currentUserRole) {
    if (state.chatUnsubscribe) state.chatUnsubscribe();

    // Sort by clientTime — always present on every write
    const q = query(
        collection(db, "orders", orderId, "chat"),
        orderBy("clientTime", "asc")
    );

    const attach = (attempt = 0) => {
        const chatBox = document.getElementById(DOM_IDS.CHAT_BOX);
        if (!chatBox) {
            if (attempt < ATTACH_MAX_ATTEMPTS) {
                state.chatAttachTimer = setTimeout(() => attach(attempt + 1), ATTACH_RETRY_DELAY_MS);
            } else {
                console.warn("[ChatManager] #chat-box never appeared; giving up.");
            }
            return;
        }

        state.chatUnsubscribe = onSnapshot(q, (snapshot) => {
            const liveBox = document.getElementById(DOM_IDS.CHAT_BOX);
            if (!liveBox) return;

            snapshot.forEach((docSnap) => {
                const msg = docSnap.data();
                if (!msg.messageId) msg.messageId = docSnap.id;
                appendMessageToUI(msg, currentUserRole);
            });
        }, (err) => {
            console.error("[ChatManager] onSnapshot error:", err);
        });
    };

    attach();
}

export function closeChatListener() {
    if (state.chatUnsubscribe) {
        state.chatUnsubscribe();
        state.chatUnsubscribe = null;
    }
    if (state.chatAttachTimer) {
        clearTimeout(state.chatAttachTimer);
        state.chatAttachTimer = null;
    }
}
