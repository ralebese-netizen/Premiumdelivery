import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { joinCallRoom, endCall, ringCustomerPhone } from "../../callManager.js";
import { showBanner, hideBanner } from "./ui.js";
export const CALL_STATES = { CUSTOMER_CALLING: 'CustomerCalling', DRIVER_CALLING: 'DriverCalling', CALL_ACCEPTED: 'CallAccepted', CALL_DECLINED: 'CallDeclined', CALL_ENDED: 'CallEnded' };
export const callState = { activeChatOrderId: null, incomingCallOrderId: null };
export function initCallHandlers() {
    document.getElementById('answer-call-btn').addEventListener('click', answerCall);
    document.getElementById('dismiss-call-btn').addEventListener('click', dismissCall);
    document.getElementById('end-call-btn').addEventListener('click', endCallHandler);
}
function cleanCallUrl() { try { if (!window.location.search.includes('incomingCall')) return; const params = new URLSearchParams(window.location.search); params.delete('incomingCall'); const qs = params.toString(); window.history.replaceState({}, document.title, window.location.pathname + (qs ? `?${qs}` : '')); } catch (e) {} }
function clearCallSession(orderId) { if (!orderId) return; updateDoc(doc(db, "orders", orderId), { activeCallSessionId: null }).catch(e => {}); }
export function handleIncomingCallState(callStateValue, orderId) {
    switch (callStateValue) {
        case CALL_STATES.CUSTOMER_CALLING: callState.incomingCallOrderId = orderId; showBanner('incoming-call-banner'); return;
        case CALL_STATES.DRIVER_CALLING: callState.incomingCallOrderId = orderId; return;
        case CALL_STATES.CALL_ACCEPTED: callState.incomingCallOrderId = orderId; hideBanner('incoming-call-banner'); return;
        case CALL_STATES.CALL_DECLINED: callState.incomingCallOrderId = null; hideBanner('incoming-call-banner'); cleanCallUrl(); clearCallSession(orderId); endCall(); return;
        case CALL_STATES.CALL_ENDED: callState.incomingCallOrderId = null; hideBanner('incoming-call-banner'); cleanCallUrl(); clearCallSession(orderId); endCall(); return;
        default: callState.incomingCallOrderId = null; hideBanner('incoming-call-banner'); return;
    }
}
async function answerCall() {
    hideBanner('incoming-call-banner');
    const orderId = callState.incomingCallOrderId;
    if (!orderId) return;
    try {
        let callSessionId = null;
        try { const snap = await getDoc(doc(db, "orders", orderId)); if (snap.exists()) callSessionId = snap.data().activeCallSessionId || null; } catch (e) {}
        await updateDoc(doc(db, "orders", orderId), { incomingCall: CALL_STATES.CALL_ACCEPTED });
        await joinCallRoom(orderId, window.currentDriverId, callSessionId);
    } catch (e) { if (typeof window.showToast === 'function') window.showToast(`Could not answer call: ${e.message}`); }
}
async function dismissCall() {
    hideBanner('incoming-call-banner'); cleanCallUrl();
    const orderId = callState.incomingCallOrderId; if (!orderId) return;
    try { await updateDoc(doc(db, "orders", orderId), { incomingCall: CALL_STATES.CALL_DECLINED, activeCallSessionId: null }); } catch (e) {}
    callState.incomingCallOrderId = null;
}
async function endCallHandler() {
    const id = callState.activeChatOrderId || callState.incomingCallOrderId;
    try { if (id) await updateDoc(doc(db, "orders", id), { incomingCall: CALL_STATES.CALL_ENDED, activeCallSessionId: null }); } catch (e) {}
    finally { cleanCallUrl(); endCall(); }
    callState.incomingCallOrderId = null;
}
export async function startOutboundCall() {
    if (!callState.activeChatOrderId) return alert("No active order.");
    const callSessionId = "call_" + Date.now();
    try {
        const snap = await getDoc(doc(db, "orders", callState.activeChatOrderId));
        if (snap.exists()) ringCustomerPhone(snap.data().fcmToken, callState.activeChatOrderId);
        await updateDoc(doc(db, "orders", callState.activeChatOrderId), { incomingCall: CALL_STATES.DRIVER_CALLING, activeCallSessionId: callSessionId });
        await joinCallRoom(callState.activeChatOrderId, window.currentDriverId, callSessionId);
    } catch (e) { alert(`Failed to start call: ${e.message}`); }
}
