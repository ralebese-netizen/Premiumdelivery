// chatManager/state.js
// Single source of truth for mutable module state.
// Import the `state` object and mutate its fields — never reassign the whole object.

export const state = {
    // WebSocket lifecycle
    wsSocket: null,
    wsReconnectTimer: null,
    historyReceived: false,
    pendingLive: [],

    // Firestore listener
    chatUnsubscribe: null,
    chatAttachTimer: null,

    // Media recording
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,

    // Session context
    activeChatMode: 'app',
    currentOrderId: null,
    currentCustomerPhone: "",
    currentUserRole: "driver",
    currentBot: "Zap"
};

export function resetWebSocketState() {
    state.wsSocket = null;
    state.wsReconnectTimer = null;
    state.historyReceived = false;
    state.pendingLive = [];
}

export function resetSessionState() {
    state.currentOrderId = null;
    state.currentCustomerPhone = "";
}
