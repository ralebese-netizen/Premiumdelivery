import { collection, query, where, getDocs, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getDeviceToken, storeTokenInFirestore } from "../../notificationManager.js";
const ACTIVE_ORDER_STATUSES = ["Accepted", "Picked Up", "In Transit", "Dispatched", "Pending"];
export async function syncDriverToken(db, messaging, driverId) {
    const result = { token: "", driverUpdated: false, ordersUpdated: 0 };
    if (!db || !driverId) return result;
    const token = await getDeviceToken(messaging);
    if (!token) return result;
    result.token = token;
    try {
        const driverRef = doc(db, "drivers", driverId);
        const driverSnap = await getDoc(driverRef);
        const storedToken = driverSnap.exists() ? driverSnap.data().fcmToken : null;
        if (storedToken !== token) { await storeTokenInFirestore(db, driverId, token); result.driverUpdated = true; }
    } catch (e) { console.warn("[TokenSync] Driver profile update failed:", e); }
    try {
        const q = query(collection(db, "orders"), where("driverId", "==", driverId), where("status", "in", ACTIVE_ORDER_STATUSES));
        const snap = await getDocs(q);
        for (const orderDoc of snap.docs) {
            const current = orderDoc.data().driverFcmToken;
            if (current === token) continue;
            await updateDoc(doc(db, "orders", orderDoc.id), { driverFcmToken: token, driverFcmTokenUpdatedAt: new Date().toISOString() });
            result.ordersUpdated++;
        }
    } catch (e) { console.warn("[TokenSync] Order sync failed:", e); }
    return result;
}
export async function verifyTokenOnce(db, messaging, driverId) {
    if (!db || !driverId) return;
    try {
        const deviceToken = await getDeviceToken(messaging);
        if (!deviceToken) return;
        const snap = await getDoc(doc(db, "drivers", driverId));
        if (!snap.exists()) return;
        const stored = snap.data().fcmToken;
        if (stored !== deviceToken) await syncDriverToken(db, messaging, driverId);
    } catch (e) { console.warn("[TokenSync] Verify failed:", e); }
}
export async function watchTokenRefresh(db, messaging, driverId) {
    if (!db || !driverId) return () => {};
    const { onTokenRefresh } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js");
    return onTokenRefresh(messaging, async (newToken) => { await syncDriverToken(db, messaging, driverId); });
}
