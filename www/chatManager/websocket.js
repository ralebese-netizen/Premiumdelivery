// chatManager/websocket.js
// WebSocket lifecycle: connect, dispatch, reconnect, and buffering.

import { WS_URL, WS_RECONNECT_DELAY_MS } from "./constants.js";
import { state, resetWebSocketState } from "./state.js";
import { deriveSortKey } from "./utils.js";
import { mirrorToFirestore } from "./firestoreMirror.js";
import { appendMessageToUI } from "./renderer.js";

export function connectWebSocket(orderId, role = 'driver', bot = 'Zap', db = null) {
    // Guard OPEN *and* CONNECTING; clear any pending reconnect
    if (state.wsSocket && (
        state.wsSocket.readyState === WebSocket.OPEN ||
        state.wsSocket.readyState === WebSocket.CONNECTING
    )) return;
    if (state.wsReconnectTimer) {
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = null;
    }

    state.currentBot = bot;
    const socket = new WebSocket(`${WS_URL}?orderId=${encodeURIComponent(orderId)}&bot=${encodeURIComponent(bot)}`);
    state.wsSocket = socket;

    // Reset buffer for each fresh connection
    state.historyReceived = false;
    state.pendingLive = [];

    socket.onopen = () => {
        if (state.wsSocket !== socket) return;
        console.log(`[WebSocket] Connected to order session: ${orderId} (Bot: ${bot})`);
        socket.send(JSON.stringify({
            action: "getHistory",
            orderId: orderId,
            limit: 50
        }));
    };

    socket.onmessage = (event) => {
        if (state.wsSocket !== socket) return;
        try {
            const payload = JSON.parse(event.data);

            if (payload.type === 'history' && Array.isArray(payload.messages)) {
                const sorted = [...payload.messages].sort((a, b) => deriveSortKey(a) - deriveSortKey(b));
                sorted.forEach(msg => {
                    mirrorToFirestore(db, orderId, msg, role);
                    appendMessageToUI(msg, role);
                });
                state.historyReceived = true;

                // Flush buffered live messages in sorted order
                const flush = [...state.pendingLive].sort((a, b) => deriveSortKey(a) - deriveSortKey(b));
                flush.forEach(msg => {
                    mirrorToFirestore(db, orderId, msg, role);
                    appendMessageToUI(msg, role);
                });
                state.pendingLive = [];

            } else if (payload.type === 'message' && payload.data) {
                if (!state.historyReceived) {
                    state.pendingLive.push(payload.data);   // buffer until history lands
                } else {
                    mirrorToFirestore(db, orderId, payload.data, role);
                    appendMessageToUI(payload.data, role);
                }
            }
        } catch (err) {
            console.error("[WebSocket] Payload Parse Error:", err);
        }
    };

    socket.onerror = (err) => {
        if (state.wsSocket !== socket) return;
        console.error("[WebSocket] Error:", err);
    };

    socket.onclose = () => {
        if (state.wsSocket !== socket) return; // a newer socket already took over
        console.warn("[WebSocket] Closed. Reconnecting in 3s...");
        state.wsReconnectTimer = setTimeout(() => {
            state.wsReconnectTimer = null;
            if (state.currentOrderId && state.wsSocket === socket) {
                connectWebSocket(state.currentOrderId, role, state.currentBot, db);
            }
        }, WS_RECONNECT_DELAY_MS);
    };
}

export function dispatchWebSocketMessage(action, payload) {
    if (state.wsSocket && state.wsSocket.readyState === WebSocket.OPEN) {
        state.wsSocket.send(JSON.stringify({
            action,
            orderId: state.currentOrderId,
            ...payload
        }));
        return true;
    }
    return false;
}

export function closeWebSocket() {
    if (state.wsReconnectTimer) {
        clearTimeout(state.wsReconnectTimer);
        state.wsReconnectTimer = null;
    }
    if (state.wsSocket) {
        state.wsSocket.onopen = null;
        state.wsSocket.onmessage = null;
        state.wsSocket.onerror = null;
        state.wsSocket.onclose = null;
        state.wsSocket.close();
    }
    resetWebSocketState();
}
