import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
const STORE_CREDIT_LAMBDA = "https://rrbqtjg4n5.execute-api.eu-north-1.amazonaws.com/default/Zap";
const inFlightCredits = new Set();
export async function creditStoreForOrder(orderId) {
    if (!orderId) return { ok: false, reason: "missing-orderId" };
    if (inFlightCredits.has(orderId)) return { ok: false, reason: "in-flight" };
    inFlightCredits.add(orderId);
    try {
        const res = await fetch(STORE_CREDIT_LAMBDA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, reason: data?.error || `HTTP ${res.status}` };
        return { ok: true, data };
    } catch (err) { return { ok: false, reason: err.message }; }
    finally { inFlightCredits.delete(orderId); }
}
export async function retryPendingStoreCredits(driverId, opts = {}) {
    if (!driverId) return;
    const maxOrders = opts.maxOrders ?? 20;
    const staleMinutes = opts.staleMinutes ?? 1;
    const cutoffMs = Date.now() - staleMinutes * 60 * 1000;
    try {
        const q = query(collection(db, "orders"), where("driverId", "==", driverId), where("status", "==", "Completed"));
        const snap = await getDocs(q);
        const pending = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.storeCredited === true) return;
            const completedAt = data.completedAt ? new Date(data.completedAt).getTime() : 0;
            if (completedAt && completedAt > cutoffMs) return;
            pending.push({ id: docSnap.id, data });
        });
        for (const order of pending.slice(0, maxOrders)) { await creditStoreForOrder(order.id); }
    } catch (e) {}
}
