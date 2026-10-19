// driver/js/tokenSync.js
// Capacitor Native Android Token Sync
// Keeps the driver's native FCM token in sync across the profile and ACCEPTED orders.

import {
    collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🟢 ONLY sync to orders the driver has actually accepted
const ACCEPTED_ORDER_STATUSES = [
    "Accepted",
    "Picked Up",
    "In Transit"
];

/**
 * Gets the native Capacitor token, writes it to the driver profile,
 * and updates every ACCEPTED order for that driver.
 *
 * Idempotent — safe to call multiple times.
 */
export async function syncDriverToken(db, driverId) {
    const result = { token: "", driverUpdated: false, ordersUpdated: 0, ok: false };

    if (!db || !driverId) {
        console.warn("[TokenSync] Missing db or driverId — aborting");
        return result;
    }

    // 1. Get native device token from Capacitor memory
    const token = window.nativeFcmToken || window.currentDriverToken;

    if (!token) {
        console.warn("[TokenSync] No native FCM token found in memory.");
        return result;
    }
    result.token = token;

    // 2. Update driver profile
    try {
        const driverRef = doc(db, "drivers", driverId);
        const driverSnap = await getDoc(driverRef);
        const storedToken = driverSnap.exists() ? driverSnap.data().fcmToken : null;

        if (storedToken !== token) {
            await setDoc(driverRef, {
                fcmToken: token,
                fcmTokenUpdatedAt: serverTimestamp(),
                fcmPlatform: "android",
            }, { merge: true });

            result.driverUpdated = true;
            console.log("[TokenSync] ✅ Driver profile fcmToken updated");
        } else {
            console.log("[TokenSync] Driver token already current — no write");
        }
        result.ok = true;
    } catch (e) {
        console.error("[TokenSync] ❌ Driver profile update failed:", e.code || e.message, e);
        return result;
    }

    // 3. Update every ACCEPTED order
    try {
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "in", ACCEPTED_ORDER_STATUSES)
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
            `[TokenSync] Accepted Order sync: ${result.ordersUpdated} of ${snap.size} updated`
        );
    } catch (e) {
        console.warn("[TokenSync] Order query failed:", e.code || e.message);
    }

    return result;
}

/**
 * One-shot verification — compares driver doc against native token.
 * Writes only if they differ. No listeners. No loops.
 */
export async function verifyTokenOnce(db, driverId) {
    if (!db || !driverId) return;

    try {
        const deviceToken = window.nativeFcmToken || window.currentDriverToken;
        if (!deviceToken) return;

        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;

        const stored = snap.data().fcmToken;
        if (stored !== deviceToken) {
            console.log("[TokenSync] Verify: mismatch — resyncing");
            await syncDriverToken(db, driverId);
        }
    } catch (e) {
        console.warn("[TokenSync] Verify failed:", e.code || e.message);
    }
}

/**
 * Attaches a listener to Capacitor's token registration event.
 * If Android rotates the token, this will catch it and resync.
 */
export function watchTokenRefresh(db, driverId) {
    if (!db || !driverId) return;

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { PushNotifications } = window.Capacitor.Plugins || {};
        if (PushNotifications) {
            // Remove existing listener to prevent duplicates
            PushNotifications.removeAllListeners();
            
            PushNotifications.addListener('registration', async (token) => {
                console.log("[TokenSync] Native token rotated — resyncing everywhere");
                window.nativeFcmToken = token.value;
                try {
                    await syncDriverToken(db, driverId);
                } catch (e) {
                    console.warn("[TokenSync] Refresh sync failed:", e.code || e.message);
                }
            });
        }
    }
}
