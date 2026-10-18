import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { env, state } from "./state.js";
import { mergeAndProcessQueue } from "./queue.js";
import { renderActiveOrder, renderPendingQueue, getEmptyActiveHtml } from "./render.js";
export function startActiveOrderListener() {
    if (state.activeUnsubscribe) state.activeUnsubscribe();
    const q = query(collection(env.db, "orders"), where("status", "==", "Accepted"), where("driverId", "==", env.driverId));
    state.activeUnsubscribe = onSnapshot(q, (snap) => {
        const activeOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.hasActiveOrder = activeOrders.length > 0;
        if (state.hasActiveOrder) { const order = activeOrders[0]; state.activeOrderId = order.id; env.onStartTracking(order.id); env.onCallStateChange(order.incomingCall || false, order.id); renderActiveOrder(order); renderPendingQueue([]); }
        else { state.activeOrderId = null; env.onStopTracking(); env.onCallStateChange(false, null); const container = document.getElementById('active-container'); if (container) container.innerHTML = getEmptyActiveHtml(); mergeAndProcessQueue(); }
    });
}
export function startPendingOrdersListener() {
    if (state.pendingOwnUnsubscribe) state.pendingOwnUnsubscribe(); if (state.pendingOtherUnsubscribe) state.pendingOtherUnsubscribe();
    const ownQuery = query(collection(env.db, "orders"), where("status", "in", ["Paid", "Pending"]), where("appOrigin", "==", env.fleetName));
    state.pendingOwnUnsubscribe = onSnapshot(ownQuery, (snap) => { state.rawOwnOrders = snap.docs.map(d => ({ id: d.id, ...d.data() })); mergeAndProcessQueue(); });
    const otherQuery = query(collection(env.db, "orders"), where("status", "in", ["Paid", "Pending"]), where("appOrigin", "!=", env.fleetName));
    state.pendingOtherUnsubscribe = onSnapshot(otherQuery, (snap) => { state.rawOtherOrders = snap.docs.map(d => ({ id: d.id, ...d.data() })); mergeAndProcessQueue(); });
}
export function stopAllListeners() { if (state.activeUnsubscribe) { state.activeUnsubscribe(); state.activeUnsubscribe = null; } if (state.pendingOwnUnsubscribe) { state.pendingOwnUnsubscribe(); state.pendingOwnUnsubscribe = null; } if (state.pendingOtherUnsubscribe) { state.pendingOtherUnsubscribe(); state.pendingOtherUnsubscribe = null; } }
