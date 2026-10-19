// driver/js/tokenSync.js
//
// Single source of truth for keeping the driver's FCM token in sync
// across `drivers/{uid}` and every active order for that driver.

import {
    collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDeviceToken } from "../../notificationManager.js";

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
 * Idempotent — safe to call multiple times.
 */
export async function syncDriverToken(db, messaging, driverId) {
    const result = { token: "", driverUpdated: false, ordersUpdated: 0, ok: false };

    if (!db || !driverId) {
        console.warn("[TokenSync] Missing db or driverId — aborting");
        return result;
    }

    // 1. Get device token
    let token = null;
    try {
        token = await getDeviceToken(messaging);
    } catch (e) {
        console.error("[TokenSync] getDeviceToken threw:", e.message);
        return result;
    }

    if (!token) {
        console.warn("[TokenSync] No device token — check VAPID key & service worker");
        return result;
    }
    result.token = token;

    // 2. Update driver profile — write the field explicitly (no helper ambiguity)
    try {
        const driverRef = doc(db, "drivers", driverId);
        const driverSnap = await getDoc(driverRef);
        const storedToken = driverSnap.exists() ? driverSnap.data().fcmToken : null;

        if (storedToken !== token) {
            await setDoc(driverRef, {
                fcmToken: token,
                fcmTokenUpdatedAt: serverTimestamp(),
                fcmPlatform: "web",
            }, { merge: true });

            result.driverUpdated = true;
            console.log("[TokenSync] ✅ Driver profile fcmToken updated");
        } else {
            console.log("[TokenSync] Driver token already current — no write");
        }
        result.ok = true;
    } catch (e) {
        console.error("[TokenSync] ❌ Driver profile update failed:", e.code || e.message, e);
        // Don't proceed to order update if the driver doc failed — rules issue likely
        return result;
    }

    // 3. Update every active order (best-effort — failures here don't break the driver token)
    try {
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "in", ACTIVE_ORDER_STATUSES)
        );
        const snap = await getDocs(q);

        for (const orderDoc of snap.docs) {
            try {
                const current = orderDoc.data().driverFcmToken;
                if (current === token) continue;

                await updateDoc(doc(db, "orders", orderDoc.id), {
                    driverFcmToken: token,
                    driverFcmTokenUpdatedAt: serverTimestamp(),
                });
                result.ordersUpdated++;
            } catch (orderErr) {
                console.warn(
                    `[TokenSync] Order ${orderDoc.id} update failed:`,
                    orderErr.code || orderErr.message
                );
            }
        }

        console.log(
            `[TokenSync] Order sync: ${result.ordersUpdated} of ${snap.size} updated`
        );
    } catch (e) {
        console.warn("[TokenSync] Order query failed:", e.code || e.message);
    }

    return result;
}

/**
 * One-shot verification — compares driver doc against device token.
 * Writes only if they differ. No listeners. No loops.
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
        console.warn("[TokenSync] Verify failed:", e.code || e.message);
    }
}

/**
 * Attaches a one-shot listener to `onTokenRefresh`.
 * Stores unsubscribe on window so logout can clean up.
 */
export function watchTokenRefresh(db, messaging, driverId) {
    if (!db || !driverId) return Promise.resolve(() => {});

    return import(
        "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js"
    ).then(({ onTokenRefresh }) => {
        const unsubscribe = onTokenRefresh(messaging, async (newToken) => {
            console.log("[TokenSync] Token rotated — resyncing everywhere");
            try {
                await syncDriverToken(db, messaging, driverId);
            } catch (e) {
                console.warn("[TokenSync] Refresh sync failed:", e.code || e.message);
            }
        });

        // Prevent listener stacking across logins
        if (typeof window !== "undefined") {
            window.__unsubscribeTokenRefresh?.();
            window.__unsubscribeTokenRefresh = unsubscribe;
        }

        return unsubscribe;
    });
}
