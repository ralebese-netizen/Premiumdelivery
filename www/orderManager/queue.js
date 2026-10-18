// orderManager/queue.js
// Merges pending orders from both listeners, applies timing gates,
// and triggers rendering.

import { env, state } from "./state.js";
import { renderPendingQueue } from "./render.js";
import { computeDriverPayout, orderTimeMs } from "./helpers.js";

const EXTERNAL_STORE_GATE_SECONDS = 300;  // 5 minutes
const VIP_GATE_SECONDS = 10;              // 10 seconds for non-VIP

export function mergeAndProcessQueue() {
    if (state.hasActiveOrder) return;

    const now = Date.now();
    const allOrders = [...state.rawOwnOrders, ...state.rawOtherOrders];
    const visibleOrders = [];
    let hasDelayedOrders = false;

    allOrders.forEach(oData => {
        if (state.declinedIds.has(oData.id)) return;
        if (oData.driverId && oData.driverId !== "") return;

        const isOwnStore = (oData.appOrigin === env.fleetName);
        const orderTime = orderTimeMs(oData, now);
        const ageSeconds = (now - orderTime) / 1000;

        // Gate 1: external stores held for 5 minutes
        if (!isOwnStore && ageSeconds < EXTERNAL_STORE_GATE_SECONDS) {
            hasDelayedOrders = true;
            return;
        }

        // Gate 2: non-VIP drivers wait 10 seconds
        if (!env.isVIP && ageSeconds < VIP_GATE_SECONDS) {
            hasDelayedOrders = true;
            return;
        }

        // Compute displayed payout
        const { totalToAdd, tip, itemFunds, logisticsCost } = computeDriverPayout(oData);
        const adminCut = Math.ceil(logisticsCost * 0.01);
        const driverEarns = Math.floor(logisticsCost * 0.95) + tip - adminCut;

        oData.displayFee = "M" + driverEarns;
        visibleOrders.push(oData);

        if (!state.notifiedIds.has(oData.id)) {
            state.notifiedIds.add(oData.id);
            if (!state.isInitialLoad) {
                env.onNewOrderNotification(oData);
            }
        }
    });

    // Sort oldest first
    visibleOrders.sort((a, b) => orderTimeMs(a, now) - orderTimeMs(b, now));

    renderPendingQueue(visibleOrders);

    // Keep polling while any order is still waiting out its gate
    if (hasDelayedOrders && !state.refreshInterval) {
        state.refreshInterval = setInterval(mergeAndProcessQueue, 2000);
    } else if (!hasDelayedOrders && state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
}
