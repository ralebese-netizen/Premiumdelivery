// orderManager/index.js
// Public API for the order management module.
//
// This file replaces the old root-level orderManager.js. Existing callers
// (auth-flow.js) import { initializeOrderSystem } from "../../orderManager.js"
// which now resolves to the barrel that re-exports from here.

import { setEnv, state } from "./state.js";
import { startActiveOrderListener, startPendingOrdersListener } from "./listeners.js";
import { acceptOrder, declineOrder, completeDelivery } from "./actions.js";

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

/**
 * Wires up the driver's order feed. Called once on login (from auth-flow.js).
 *
 * @param {object} config
 * @param {object}   config.db                    Firestore instance
 * @param {string}   config.driverId              Driver's Firebase Auth UID
 * @param {string}   config.driverToken           FCM token for this device
 * @param {string}   config.fleetName             Assigned fleet (defaults to "General")
 * @param {boolean}  config.isVIP                 Priority driver flag
 * @param {Function} config.onToast               (msg) => void
 * @param {Function} config.onOpenChat            (orderId) => void
 * @param {Function} config.onStartTracking       (orderId) => void
 * @param {Function} config.onStopTracking        () => void
 * @param {Function} config.onCallStateChange     (inCall, orderId) => void
 * @param {Function} config.onNewOrderNotification (orderData) => void
 */
export function initializeOrderSystem(config) {
    setEnv(config);

    // Expose order actions to inline onclick handlers used inside render.js.
    // Using `config` directly (not `env`) so the callback is guaranteed to be
    // present at the moment this object is built.
    window._orderSys = {
        accept: acceptOrder,
        decline: declineOrder,
        complete: completeDelivery,
        openChat: config.onOpenChat
    };

    startActiveOrderListener();
    startPendingOrdersListener();

    // Give the initial snapshot time to populate before firing "new order"
    // notifications, so a page reload doesn't spam the driver with toasts.
    setTimeout(() => {
        state.isInitialLoad = false;
    }, 2500);
}

// -----------------------------------------------------------------------------
// Re-exports
// -----------------------------------------------------------------------------

// Actions (exposed for programmatic calls and tests)
export { acceptOrder, declineOrder, completeDelivery } from "./actions.js";

// State access (useful for debugging and for tests)
export { env, state, resetState } from "./state.js";

// Queue processing (exposed so callers can force-refresh if needed)
export { mergeAndProcessQueue } from "./queue.js";

// Listener lifecycle (exposed so a logout handler can tear down cleanly)
export { stopAllListeners } from "./listeners.js";
