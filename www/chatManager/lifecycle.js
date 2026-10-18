// chatManager/lifecycle.js
// Clean shutdown: unsubscribe, close socket, clear timers, reset state.

import { closeChatListener } from "./listener.js";
import { closeWebSocket } from "./websocket.js";
import { resetSessionState } from "./state.js";

export function stopChatListener() {
    closeChatListener();
    closeWebSocket();
    resetSessionState();
}
