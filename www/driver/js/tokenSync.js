// driver/js/tokenSync.js
//
// Single source of truth for keeping the driver's FCM token in sync
// across `drivers/{uid}` and every active order for that driver.
//
// Design:
//   - The DEVICE owns its token. Firestore is a passive mirror.
//   - Writes happen when the device's token changes, never in response
//     to reading Firestore (no onSnapshot — that creates write loops).
//   - Called from: login, onTokenRefresh, app visibility resume.

import {
    collection, query, where, getDocs, doc, updateDoc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDeviceToken, storeTokenInFirestore } from "../../notificationManager.js";

const ACTIVE_ORDER_STATUSES = [
    "Accepted",
    "Picked Up",
    "In Transit",
    "Dispatched",
    "Pending",
];

/**
 * Gets the current device token, writes it to the driver profile,
 * and updates every active order for that driver.
 *
 * Safe to call multiple times — writes are idempotent.
 *
 * @param {object} db        Firestore instance
 * @param {object} messaging Firebase Messaging instance
 * @param {string} driverId  Driver UID
 * @returns {Promise<{ token: string, driverUpdated: boolean, ordersUpdated: number }>}
 */
export async function syncDriverToken(db, messaging, driverId) {
    const result = { token: "", driverUpdated: false, ordersUpdated: 0 };

    if (!db || !driverId) return result;

    // 1. Get the device's current token
    const token = await getDeviceToken(messaging);
    if (!token) {
        console.warn("[TokenSync] No device token available — nothing to sync");
        return result;
    }
    result.token = token;

    // 2. Update the driver profile (only if it differs)
    try {
        const driverRef = doc(db, "drivers", driverId);
        const driverSnap = await getDoc(driverRef);
        const storedToken = driverSnap.exists() ? driverSnap.data().fcmToken : null;

        if (storedToken !== token) {
            await storeTokenInFirestore(db, driverId, token);
            result.driverUpdated = true;
            console.log("[TokenSync] Driver profile token updated");
        }
    } catch (e) {
        console.warn("[TokenSync] Driver profile update failed:", e);
    }

    // 3. Update every active order for this driver
    try {
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "in", ACTIVE_ORDER_STATUSES)
        );
        const snap = await getDocs(q);

        for (const orderDoc of snap.docs) {
            const current = orderDoc.data().driverFcmToken;
            if (current === token) continue;   // already correct

            await updateDoc(doc(db, "orders", orderDoc.id), {
                driverFcmToken: token,
                driverFcmTokenUpdatedAt: new Date().toISOString(),
            });
            result.ordersUpdated++;
        }

        console.log(
            `[TokenSync] Order sync complete: ${result.ordersUpdated} of ${snap.size} active orders updated`
        );
    } catch (e) {
        console.warn("[TokenSync] Order sync failed:", e);
    }

    return result;
}

/**
 * One-shot verification — reads the driver profile and compares against
 * the device token. Writes only if they differ. No listeners. No loops.
 */
export async function verifyTokenOnce(db, messaging, driverId) {
    if (!db || !driverId) return;

    try {
        const deviceToken = await getDeviceToken(messaging);
        if (!deviceToken) return;

        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;

        const stored = snap.data().fcmToken;
        if (stored !== deviceToken) {
            console.log("[TokenSync] Verify: mismatch — resyncing");
            await syncDriverToken(db, messaging, driverId);
        }
    } catch (e) {
        console.warn("[TokenSync] Verify failed:", e);
    }
}

/**
 * Attaches a one-shot listener to `onTokenRefresh`. When Firebase rotates
 * the token, everything gets resynced automatically.
 *
 * Returns the unsubscribe function.
 */
export async function watchTokenRefresh(db, messaging, driverId) {
    if (!db || !driverId) return () => {};

    const { onTokenRefresh } = await import(
        "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js"
    );

    return onTokenRefresh(messaging, async (newToken) => {
        console.log("[TokenSync] Firebase rotated the token — resyncing everywhere");
        await syncDriverToken(db, messaging, driverId);
    });
}
