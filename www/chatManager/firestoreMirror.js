// chatManager/firestoreMirror.js
// Persists incoming WebSocket messages to Firestore so they survive reloads.

import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { deriveSortKey } from "./utils.js";

export async function mirrorToFirestore(db, orderId, msg, myRole) {
    if (!db || !msg || !msg.messageId) return;
    if (msg.sender === myRole) return; // own messages already written by senders.js

    const docRef = doc(db, "orders", orderId, "chat", msg.messageId);

    try {
        // 🟢 CRITICAL: only write if the doc doesn't already exist.
        // Without this guard, every WebSocket getHistory replay overwrites
        // clientTime with a fresh Date.now(), making customer messages show
        // the current time on every modal reopen.
        const existing = await getDoc(docRef);
        if (existing.exists()) return;

        const sortKey = deriveSortKey(msg) || Date.now();

        await setDoc(docRef, {
            messageId: msg.messageId,
            orderId: orderId,
            sender: msg.sender || 'customer',
            type: msg.type || 'text',
            text: msg.text || '',
            mediaUrl: msg.mediaUrl || '',
            fileName: msg.fileName || '',
            channel: msg.channel || 'whatsapp',
            customerPhone: msg.customerPhone || '',
            clientTime: sortKey,           // sort key — set once, never rewritten
            timestamp: serverTimestamp()   // audit only
        });
    } catch (e) {
        console.warn('[chatManager] Firestore mirror failed:', e);
    }
}
