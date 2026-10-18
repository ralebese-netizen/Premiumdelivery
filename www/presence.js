import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
const HEARTBEAT_MS = 30_000;
let heartbeatTimer = null; let currentDocRef = null; let visibilityBound = false;
export function startHeartbeat(db, role, uid) {
    if (!db || !uid) return;
    stopHeartbeat();
    const collectionName = role === "customer" ? "customers" : "drivers";
    currentDocRef = doc(db, collectionName, uid);
    const beat = () => { if (!currentDocRef) return; setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true }).catch(e => console.warn(e)); };
    beat();
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
    if (!visibilityBound) {
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && currentDocRef) setDoc(currentDocRef, { lastSeen: serverTimestamp() }, { merge: true }).catch(e => console.warn(e)); });
        visibilityBound = true;
    }
}
export function stopHeartbeat() { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } currentDocRef = null; }
export function isUserOnline(userDocData) { if (!userDocData || !userDocData.lastSeen) return false; const ts = userDocData.lastSeen; let lastSeenMs = 0; if (typeof ts.toMillis === "function") lastSeenMs = ts.toMillis(); else if (typeof ts === "number") lastSeenMs = ts; else if (typeof ts === "string" && !isNaN(Number(ts))) lastSeenMs = Number(ts); else return false; return (Date.now() - lastSeenMs) < 45_000; }
