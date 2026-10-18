// presence.js
//
// Per-session presence heartbeat.
//
// Writes `lastSeen` to the user's own doc every 30 seconds so the peer
// app can tell whether this user is online. Peers treat `lastSeen` as
// fresh if it's < 45s old (heartbeat × 1.5), which absorbs one missed
// beat without flickering offline.
//
// 🟢 Design:
//
//   - The DEVICE owns its presence. Firestore is a passive mirror.
//   - Nobody ever writes "offline" — the timestamp just goes stale.
//     Time does the cleanup, which is why this survives crashes,
//     battery death, and force-quits without any beforeunload hook.
//   - Writes go to `drivers/{uid}.lastSeen` or `customers/{uid}.lastSeen`
//     depending on the `role` argument. One field, one writer.
//
// 🔒 Non-blocking:
//
//   Every write is fire-and-forget. A failed beat logs and moves on —
//   it never throws into the caller. This module is called from the
//   login pipeline, which must not stall on a bad Firestore connection.
//
// 🔒 Safe to call repeatedly:
//
//   startHeartbeat() calls stopHeartbeat() first. Calling it twice on
//   login (or after a re-login) will not stack intervals.
//
// 🔒 Visibility handling:
//
//   Background tabs are throttled by browsers to ~1 beat/minute. When
//   the tab returns to the foreground, we fire an immediate beat so the
//   timestamp is fresh within a tick — otherwise a peer checking
//   presence right then could see a 30s-old value and misclassify the
//   user as offline.
//
// ─────────────────────────────────────────────────────────────────────────────
// Usage:
//
//   import { startHeartbeat, stopHeartbeat } from "./presence.js";
//
//   // On login, after the user is authenticated:
//   startHeartbeat(db, 'driver', user.uid);
//
//   // On logout:
//   stopHeartbeat();
//
//   // Same module, same call, on the customer side:
//   startHeartbeat(db, 'customer', user.uid);
// ─────────────────────────────────────────────────────────────────────────────

import {
    doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// How often we write `lastSeen`. 30s is the sweet spot: cheap enough at
// scale, fast enough that a peer's 45s threshold catches a disconnect
// within ~75s worst case.
const HEARTBEAT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

let heartbeatTimer = null;      // setInterval handle
let currentDocRef  = null;      // Firestore doc ref for the current session
let visibilityBound = false;    // ensures the listener is attached once

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the presence heartbeat for the given user.
 *
 * Safe to call multiple times — a second call cleanly replaces the first.
 *
 * @param {object} db      Firestore instance
 * @param {'driver'|'customer'} role  Which collection to write to
 * @param {string} uid     The user's Firebase Auth UID
 */
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
        // Fire-and-forget. A failed beat is harmless — the next one will
        // succeed, and the peer's threshold tolerates one miss.
        setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
            .catch((e) => {
                console.warn("[Presence] heartbeat write failed:", e?.message || e);
            });
    };

    // Fire immediately on start — don't wait 30s for the first signal.
    beat();

    // Then on interval.
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);

    // Attach the visibility listener once per page session.
    // Every future startHeartbeat reuses the same listener — the
    // `currentDocRef` closure variable tells it which user to beat for.
    if (!visibilityBound) {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && currentDocRef) {
                // Resume with an immediate beat so the timestamp is fresh
                // the instant the user is back — no 30s stale window.
                setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
                    .catch((e) => {
                        console.warn("[Presence] resume beat failed:", e?.message || e);
                    });
            }
        });
        visibilityBound = true;

        // Also beat once when the page is about to be hidden. This
        // captures the "user just closed the tab" moment as accurately
        // as possible, so the peer sees a fresh timestamp right up to
        // the point the app goes away.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden" && currentDocRef) {
                setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true })
                    .catch(() => { /* best effort, page is going away */ });
            }
        });
    }

    console.log(`[Presence] Heartbeat started for ${collectionName}/${uid}`);
}

/**
 * Stops the presence heartbeat.
 *
 * Called on logout. Never deletes the `lastSeen` field — the peer's
 * freshness check handles the transition to offline on its own.
 */
export function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    currentDocRef = null;
}

/**
 * Reads a user's `lastSeen` value and returns whether they should be
 * considered online right now.
 *
 * The 45s window is 1.5× the heartbeat interval. It absorbs one missed
 * beat without producing a false "offline" flicker.
 *
 * @param {object} userDocData  The result of `docSnap.data()` for the user
 * @returns {boolean}
 */
export function isUserOnline(userDocData) {
    if (!userDocData || !userDocData.lastSeen) return false;

    const ts = userDocData.lastSeen;
    let lastSeenMs = 0;

    // Firestore Timestamp has .toMillis()
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
