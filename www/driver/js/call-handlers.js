// driver/js/call-handlers.js
// WebRTC call orchestration: start, answer, dismiss, end.
//
// 🔒 Fix — answerCall awaits joinCallRoom and surfaces errors.
//
// 🔒 Fix — unified call-state vocabulary.
//
//     'CustomerCalling'  — customer initiated; waiting for driver
//     'DriverCalling'    — driver initiated; waiting for customer
//     'CallAccepted'     — other party accepted; Chime connecting
//     'CallDeclined'     — other party declined
//     'CallEnded'        — either party ended, or the call dropped
//     null               — no call in progress
//
// 🔒 Fix — stale ?incomingCall URL param causes banner flash on refresh.
//    cleanCallUrl() runs on every terminal transition.
//
// 🔒 Fix — timer starting before the driver answers (Chime meeting reuse).
//
//    The backend Lambda used `orderId` as the Chime ClientRequestToken,
//    which Chime treats as a 24-hour idempotency key. Every call for the
//    same order returned the SAME meeting — including stale attendees
//    from a previous call. When the customer joined, Chime reported
//    those old attendees as "present" and the timer started before the
//    driver answered.
//
//    Fix: the customer's app now generates a unique `callSessionId` per
//    call and writes it to orders/{orderId}.activeCallSessionId. This
//    file reads that value and passes it to joinCallRoom, so the driver
//    joins the SAME fresh meeting as the customer. Backend uses it as
//    the ClientRequestToken.
//
//    When the driver initiates the call, this file generates the
//    sessionId instead. Either direction, the pattern is symmetric.

import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { joinCallRoom, endCall, ringCustomerPhone } from "../../callManager.js";
import { showBanner, hideBanner } from "./ui.js";

// ─────────────────────────────────────────────────────────────────────────────
// Call-state vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export const CALL_STATES = {
    CUSTOMER_CALLING: 'CustomerCalling',
    DRIVER_CALLING:   'DriverCalling',
    CALL_ACCEPTED:    'CallAccepted',
    CALL_DECLINED:    'CallDeclined',
    CALL_ENDED:       'CallEnded',
};

// Shared mutable state — exposed so other modules can read/write
export const callState = {
    activeChatOrderId: null,
    incomingCallOrderId: null
};

export function initCallHandlers() {
    document.getElementById('answer-call-btn').addEventListener('click', answerCall);
    document.getElementById('dismiss-call-btn').addEventListener('click', dismissCall);
    document.getElementById('end-call-btn').addEventListener('click', endCallHandler);
}

// ─────────────────────────────────────────────────────────────────────────────
// 🔒 URL cleanup — remove ?incomingCall so a refresh doesn't re-trigger
//    the banner from a stale URL param.
// ─────────────────────────────────────────────────────────────────────────────

function cleanCallUrl() {
    try {
        if (!window.location.search.includes('incomingCall')) return;
        const params = new URLSearchParams(window.location.search);
        params.delete('incomingCall');
        const qs = params.toString();
        const cleanUrl = window.location.pathname + (qs ? `?${qs}` : '');
        window.history.replaceState({}, document.title, cleanUrl);
        console.log('[Call] URL cleaned of incomingCall param');
    } catch (e) {
        console.warn('[Call] cleanCallUrl failed:', e.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🟢 Clear activeCallSessionId on the order so the next call doesn't
//    accidentally reuse the token from a completed one. Fire-and-forget.
// ─────────────────────────────────────────────────────────────────────────────
function clearCallSession(orderId) {
    if (!orderId) return;
    updateDoc(doc(db, "orders", orderId), { activeCallSessionId: null })
        .catch((e) => console.warn("[Call] clearCallSession failed:", e.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Incoming state dispatch
// ─────────────────────────────────────────────────────────────────────────────

export function handleIncomingCallState(callStateValue, orderId) {
    switch (callStateValue) {

        // ── Inbound call from the customer ──
        case CALL_STATES.CUSTOMER_CALLING:
            callState.incomingCallOrderId = orderId;
            showBanner('incoming-call-banner');
            return;

        // ── Outbound call from the driver ──
        case CALL_STATES.DRIVER_CALLING:
            callState.incomingCallOrderId = orderId;
            return;

        // ── Other party accepted ──
        case CALL_STATES.CALL_ACCEPTED:
            callState.incomingCallOrderId = orderId;
            hideBanner('incoming-call-banner');
            return;

        // ── Other party declined ──
        case CALL_STATES.CALL_DECLINED:
            callState.incomingCallOrderId = null;
            hideBanner('incoming-call-banner');
            cleanCallUrl();
            // 🟢 Clear the session so the next call starts fresh.
            clearCallSession(orderId);
            endCall();
            return;

        // ── Call is over ──
        case CALL_STATES.CALL_ENDED:
            callState.incomingCallOrderId = null;
            hideBanner('incoming-call-banner');
            cleanCallUrl();
            // 🟢 Clear the session so the next call starts fresh.
            clearCallSession(orderId);
            endCall();
            return;

        // ── No call ──
        case null:
        case undefined:
            callState.incomingCallOrderId = null;
            hideBanner('incoming-call-banner');
            return;

        // ── Unknown value ──
        default:
            console.warn(`[Call] Unknown incomingCall value: ${JSON.stringify(callStateValue)}`);
            return;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handlers
// ─────────────────────────────────────────────────────────────────────────────

async function answerCall() {
    hideBanner('incoming-call-banner');

    const orderId = callState.incomingCallOrderId;
    if (!orderId) {
        console.warn("[Call] answerCall: no incomingCallOrderId set");
        return;
    }

    try {
        // 🟢 Read the session ID the customer wrote so we join the SAME
        //    Chime meeting. Without it, the driver joins a different room.
        let callSessionId = null;
        try {
            const snap = await getDoc(doc(db, "orders", orderId));
            if (snap.exists()) {
                callSessionId = snap.data().activeCallSessionId || null;
            }
            console.log("[Call] answerCall read session", {
                orderId,
                callSessionId,
                found: !!callSessionId,
            });
        } catch (e) {
            console.warn("[Call] Could not read activeCallSessionId:", e.message);
        }

        // 🔒 Write the accept state — distinct from "declined".
        await updateDoc(doc(db, "orders", orderId), {
            incomingCall: CALL_STATES.CALL_ACCEPTED,
        });

        // 🔒 Await the join so errors bubble up here instead of being
        //    silently lost as an unhandled promise rejection.
        await joinCallRoom(orderId, window.currentDriverId, callSessionId);
    } catch (e) {
        console.error("[Call] Failed to answer:", e);
        if (typeof window.showToast === 'function') {
            window.showToast(`Could not answer call: ${e.message}`);
        }
    }
}

async function dismissCall() {
    hideBanner('incoming-call-banner');
    cleanCallUrl();

    const orderId = callState.incomingCallOrderId;
    if (!orderId) return;

    try {
        await updateDoc(doc(db, "orders", orderId), {
            incomingCall: CALL_STATES.CALL_DECLINED,
            activeCallSessionId: null,   // 🟢 clear session on decline
        });
    } catch (e) {
        console.error("[Call] Failed to dismiss:", e);
    }

    callState.incomingCallOrderId = null;
}

async function endCallHandler() {
    const id = callState.activeChatOrderId || callState.incomingCallOrderId;

    try {
        if (id) {
            await updateDoc(doc(db, "orders", id), {
                incomingCall: CALL_STATES.CALL_ENDED,
                activeCallSessionId: null,   // 🟢 clear session on end
            });
        }
    } catch (e) {
        console.error("[Call] Failed to write CallEnded:", e);
    } finally {
        cleanCallUrl();
        endCall();
    }

    callState.incomingCallOrderId = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound call initiation
// ─────────────────────────────────────────────────────────────────────────────

export async function startOutboundCall() {
    if (!callState.activeChatOrderId) return alert("No active order.");

    // 🟢 Generate a unique session ID for THIS call. The backend uses it
    //    as the Chime ClientRequestToken, so a repeat call for the same
    //    order can't reuse a stale meeting.
    const callSessionId = "call_" + Date.now();

    try {
        const snap = await getDoc(doc(db, "orders", callState.activeChatOrderId));

        if (snap.exists()) {
            ringCustomerPhone(snap.data().fcmToken, callState.activeChatOrderId);
        }

        await updateDoc(doc(db, "orders", callState.activeChatOrderId), {
            incomingCall: CALL_STATES.DRIVER_CALLING,
            activeCallSessionId: callSessionId,   // 🟢 record for the answer path
        });

        // 🔒 Await — consistent with answerCall. Errors bubble up here.
        await joinCallRoom(callState.activeChatOrderId, window.currentDriverId, callSessionId);
    } catch (e) {
        console.error("[Call] Failed to start:", e);
        alert(`Failed to start call: ${e.message}`);
    }
}
