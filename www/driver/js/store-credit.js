// driver/js/store-credit.js
//
// Credits a store's DynamoDB wallet when a driver completes a delivery.
//
// The driver app can only write to Firestore directly. The store wallet
// lives in DynamoDB and is only reachable through the main Bofelo Lambda.
// This module is the bridge.
//
// Two entry points:
//   creditStoreForOrder(orderId)      — call once on delivery completion
//   retryPendingStoreCredits(driverId) — call on app open to retry failures
//
// Both are non-throwing. A failure here means "store credit pending", not
// "delivery failed". The order is already Completed in Firestore by the
// time this runs.

import {
    collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

// Same Lambda URL the QR scanner and chat use.
const STORE_CREDIT_LAMBDA =
    "https://rrbqtjg4n5.execute-api.eu-north-1.amazonaws.com/default/Zap";

// Prevent multiple parallel credit calls for the same order within a page session.
const inFlightCredits = new Set();

// -----------------------------------------------------------------------------
// Direct credit — called from completeDelivery()
// -----------------------------------------------------------------------------

/**
 * Credits the store's DynamoDB wallet for a completed order.
 *
 * @param {string} orderId
 * @returns {Promise<{ ok: boolean, data?: object, reason?: string }>}
 *
 * Response shapes from the Lambda:
 *   { success: true, storeId, credited, source }
 *   { success: true, alreadyCredited: true, amount }
 *   { success: true, credited: 0, reason: 'unregistered-store' | 'no-store' | 'no-amount' }
 *   { error: '...' }   with a 4xx/5xx status
 */
export async function creditStoreForOrder(orderId) {
    if (!orderId) return { ok: false, reason: "missing-orderId" };

    // Guard: don't fire two credits for the same order concurrently
    if (inFlightCredits.has(orderId)) {
        console.log(`[StoreCredit] Already in flight for ${orderId}`);
        return { ok: false, reason: "in-flight" };
    }
    inFlightCredits.add(orderId);

    try {
        const res = await fetch(STORE_CREDIT_LAMBDA, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.warn(`[StoreCredit] HTTP ${res.status} for ${orderId}:`, data);
            return { ok: false, reason: data?.error || `HTTP ${res.status}` };
        }

        // Log the outcome so ops can see it in CloudWatch / browser console
        if (data.alreadyCredited) {
            console.log(`[StoreCredit] Already credited: ${orderId} (L${data.amount || 0})`);
        } else if (data.credited > 0) {
            console.log(`[StoreCredit] Credited ${data.storeId} L${data.credited} for ${orderId}`);
        } else {
            console.log(`[StoreCredit] Skipped ${orderId}: ${data.reason}`);
        }

        return { ok: true, data };
    } catch (err) {
        console.warn(`[StoreCredit] Network error for ${orderId}:`, err.message);
        return { ok: false, reason: err.message };
    } finally {
        inFlightCredits.delete(orderId);
    }
}

// -----------------------------------------------------------------------------
// Retry queue — called on app open (login or resume)
// -----------------------------------------------------------------------------

/**
 * Scans Firestore for this driver's completed orders that were never
 * marked as credited (either because the network failed, or the app was
 * closed before the Lambda call returned).
 *
 * Fire-and-forget. Never throws.
 *
 * @param {string} driverId
 * @param {object} [opts]
 * @param {number} [opts.maxOrders=20]  — cap how many to retry per run
 * @param {number} [opts.staleMinutes=1] — skip orders younger than N minutes
 *   (they may still be mid-flight from the current session)
 */
export async function retryPendingStoreCredits(driverId, opts = {}) {
    if (!driverId) return;

    const maxOrders = opts.maxOrders ?? 20;
    const staleMinutes = opts.staleMinutes ?? 1;
    const cutoffMs = Date.now() - staleMinutes * 60 * 1000;

    try {
        // Firestore can't do a simple `!= true` filter combined with a range
        // on another field. We query for Completed orders and filter locally.
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "==", "Completed")
        );
        const snap = await getDocs(q);

        const pending = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.storeCredited === true) return;

            // Skip very recent orders — could still be in-flight in this session
            const completedAt = data.completedAt ? new Date(data.completedAt).getTime() : 0;
            if (completedAt && completedAt > cutoffMs) return;

            pending.push({ id: docSnap.id, data });
        });

        if (pending.length === 0) {
            console.log("[StoreCredit] No pending credits to retry");
            return;
        }

        console.log(`[StoreCredit] Retrying ${pending.length} pending credit(s)`);

        // Sequential to avoid hammering the Lambda on first open
        for (const order of pending.slice(0, maxOrders)) {
            const result = await creditStoreForOrder(order.id);
            if (result.ok) {
                console.log(`[StoreCredit] Retry succeeded for ${order.id}`);
            } else {
                console.warn(`[StoreCredit] Retry failed for ${order.id}: ${result.reason}`);
            }
        }
    } catch (e) {
        console.warn("[StoreCredit] Retry scan failed:", e.message);
    }
}
