import { setEnv, state } from "./state.js";
import { startActiveOrderListener, startPendingOrdersListener } from "./listeners.js";
import { acceptOrder, declineOrder, completeDelivery } from "./actions.js";
export function initializeOrderSystem(config) { setEnv(config); window._orderSys = { accept: acceptOrder, decline: declineOrder, complete: completeDelivery, openChat: config.onOpenChat }; startActiveOrderListener(); startPendingOrdersListener(); setTimeout(() => { state.isInitialLoad = false; }, 2500); }
export { acceptOrder, declineOrder, completeDelivery } from "./actions.js";
export { env, state, resetState } from "./state.js";
export { mergeAndProcessQueue } from "./queue.js";
export { stopAllListeners } from "./listeners.js";
