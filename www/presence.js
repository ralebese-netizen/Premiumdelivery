// presence.js
// Per-session presence heartbeat.

import {
    doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const HEARTBEAT_MS = 30_000;

let heartbeatTimer = null;
let currentDocRef  = null;
let visibilityBound = false;

export function startHeartbeat(db, role, uid) {
    if (!db || !uid) {
        console.warn("[Presence] startHeartbeat called without db/uid — skipping");
        return;
    }

    // Never stack — replace any prior interval.
    stopHeartbeat();

    const collectionName = role === "customer" ? "customers" : "drivers";
    currentDocRef = doc(db, collectionName, uid);

    const beat = () => {
        if (!currentDocRef) return;
        setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
            .catch((e) => {
                console.warn("[Presence] heartbeat write failed:", e?.message || e);
            });
    };

    // Fire immediately on start.
    beat();

    // Then on interval.
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

    // Attach the visibility listener once.
    if (!visibilityBound) {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && currentDocRef) {
                setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
                    .catch((e) => {
                        console.warn("[Presence] resume beat failed:", e?.message || e);
                    });
            }
        });
        visibilityBound = true;

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden" && currentDocRef) {
                setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
                    .catch(() => { /* best effort, page is going away */ });
            }
        });
    }

    console.log(`[Presence] Heartbeat started for ${collectionName}/${uid}`);
}

export function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    currentDocRef = null;
}

export function isUserOnline(userDocData) {
    if (!userDocData || !userDocData.lastSeen) return false;

    const ts = userDocData.lastSeen;
    let lastSeenMs = 0;

    if (typeof ts.toMillis === "function") {
        lastSeenMs = ts.toMillis();
    } else if (typeof ts === "number") {
        lastSeenMs = ts;
    } else if (typeof ts === "string" && !isNaN(Number(ts))) {
        lastSeenMs = Number(ts);
    } else {
        return false;
    }

    const ageMs = Date.now() - lastSeenMs;
    return ageMs < 45_000;
}
