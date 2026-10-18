// orderManager/actions.js
// Order lifecycle actions: accept, decline, complete.

import { doc, updateDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { env, state } from "./state.js";
import { mergeAndProcessQueue } from "./queue.js";
import { computeDriverPayout } from "./helpers.js";
import { creditStoreForOrder } from "../driver/js/store-credit.js";
import { getDeviceToken } from "../notificationManager.js";
import { messaging } from "../driver/js/firebase-init.js";

// -----------------------------------------------------------------------------
// Accept
// -----------------------------------------------------------------------------

export async function acceptOrder(orderId) {
    if (state.hasActiveOrder) return;
    state.hasActiveOrder = true;

    try {
        // 🟢 Read the LIVE device token right now. `env.driverToken` was
        //    captured at login and may be stale if Firebase rotated it
        //    since. Writing a fresh token guarantees the customer's ring
        //    goes to a valid FCM endpoint.
        let freshToken = "";
        try {
            freshToken = await getDeviceToken(messaging) || "";
        } catch (e) {
            console.warn("[OrderManager] Token refresh failed:", e);
        }

        const tokenToUse = freshToken || env.driverToken || "";

        await updateDoc(doc(env.db, "orders", orderId), {
            status: 'Accepted',
            driverId: env.driverId,
            driverFcmToken: tokenToUse,
            driverFcmTokenUpdatedAt: new Date().toISOString(),
        });

        // Keep the in-memory copy fresh too, so future accepts don't
        // re-read a stale value from env.
        if (freshToken) env.driverToken = freshToken;

    } catch (err) {
        console.error("Failed to accept order:", err);
        state.hasActiveOrder = false;
    }
}

// -----------------------------------------------------------------------------
// Decline
// -----------------------------------------------------------------------------

export function declineOrder(orderId) {
    state.declinedIds.add(orderId);
    mergeAndProcessQueue();
}

// -----------------------------------------------------------------------------
// Complete
// -----------------------------------------------------------------------------

export async function completeDelivery(orderId) {
    const enteredPin = prompt("Enter the 4-digit PIN provided by the customer:");
    if (!enteredPin) return;

    try {
        const orderSnap = await getDoc(doc(env.db, "orders", orderId));
        if (!orderSnap.exists()) return env.onToast("Order not found.");

        const oData = orderSnap.data();
        if (oData.deliveryPin && oData.deliveryPin !== enteredPin) {
            return env.onToast("Incorrect PIN. Please ask the customer.");
        }

        env.onToast("PIN Verified! Processing completion...");

        const payout = computeDriverPayout(oData);

        // --- 1. Credit driver wallet (Firestore) ---
        await creditDriverWallet(payout.totalToAdd);

        // --- 2. Mark order Completed (must happen BEFORE the Lambda call) ---
        await updateDoc(doc(env.db, "orders", orderId), {
            status: 'Completed',
            completedAt: new Date().toISOString(),
            adminCommissionDeducted: payout.adminCommission,
            driverPayoutAmount: payout.totalToAdd
        });

        // --- 3. Credit store wallet (DynamoDB via Lambda) ---
        env.onToast("Crediting store...");
        const creditResult = await creditStoreForOrder(orderId);

        // --- 4. Final toast ---
        const driverMsg = payout.totalToAdd > 0
            ? `Delivery Complete! M${payout.totalToAdd} added to Wallet.`
            : "Delivery Complete!";

        if (creditResult.ok) {
            env.onToast(driverMsg);
        } else {
            env.onToast(`${driverMsg} (Store credit pending)`);
            console.warn("[OrderManager] Store credit pending:", orderId, creditResult.reason);
        }
    } catch (error) {
        console.error("Error completing delivery:", error);
        env.onToast("Network error verifying PIN. Try again.");
    }
}

async function creditDriverWallet(totalToAdd) {
    const ref = doc(env.db, "drivers", env.driverId);
    if (totalToAdd > 0) {
        await updateDoc(ref, {
            walletBalance: increment(totalToAdd),
            deliveriesCount: increment(1)
        });
    } else {
        await updateDoc(ref, {
            deliveriesCount: increment(1)
        });
    }
}
