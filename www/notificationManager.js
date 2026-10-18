// notificationManager.js
// Unified Firebase Cloud Messaging & AWS Notification helper

import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

//  Replace with your actual Firebase VAPID key from Project Settings > Cloud Messaging
const VAPID_KEY = 'BJjRi0UCeIH3J2CYmiti-zMtJK4vicKrD1CHzVWke9uMNJKzNyK3bMrYN_Lxy8-g0yR47Ta4rXUT6xXUV9k95Yc';

/**
 * Request notification permission and retrieve the device FCM token.
 * @param {Object} messaging - Firebase Messaging instance
 * @returns {Promise<string>} FCM token or empty string on failure
 */
export async function getDeviceToken(messaging) {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const token = await getToken(messaging, { vapidKey: VAPID_KEY });
            console.log("FCM Token retrieved:", token);
            return token;
        } else {
            console.warn("Notification permission denied.");
            return "";
        }
    } catch (error) {
        console.error("FCM Token error:", error);
        return "";
    }
}

/**
 * Store the FCM token in Firestore under a driver's document.
 * @param {Object} db - Firestore instance
 * @param {string} userId - Driver UID
 * @param {string} token - FCM token
 */
export async function storeTokenInFirestore(db, userId, token) {
    if (!db || !userId || !token) return;
    try {
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        await setDoc(doc(db, "drivers", userId), { fcmToken: token, lastOnline: new Date() }, { merge: true });
        console.log("Token stored in Firestore");
    } catch (error) {
        console.error("Failed to store token in Firestore:", error);
    }
}

/**
 * Listen for foreground notifications (when the app is open).
 * Optionally play a ringtone when a notification arrives.
 * @param {Object} messaging - Firebase Messaging instance
 * @param {string|null} ringtoneElementId - ID of an <audio> element to play
 */
export function setupForegroundListener(messaging, ringtoneElementId = null) {
    onMessage(messaging, (payload) => {
        console.log('Foreground notification received:', payload);

        if (Notification.permission === 'granted') {
            // Show a browser notification
            new Notification(payload.notification.title, {
                body: payload.notification.body,
                icon: payload.notification.icon || "logo.png"
            });

            // Play ringtone if element exists
            if (ringtoneElementId) {
                const ringtone = document.getElementById(ringtoneElementId);
                if (ringtone) {
                    ringtone.play().catch(e => console.log("Audio autoplay blocked:", e));
                }
            }
        }
    });
}

/**
 * --- NEW: AWS PUSH NOTIFICATION TRIGGER ---
 * Triggers your AWS Lambda function to send a push notification.
 * @param {string} targetToken - The FCM token of the person receiving the notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body/message
 * @param {string} orderId - The active order ID
 */
export async function sendAWSNotification(targetToken, title, body, orderId) {
    if (!targetToken) {
        console.warn("Cannot send notification: Missing target FCM token.");
        return null;
    }

    // 🔥 YOUR AWS API GATEWAY URL IS INJECTED HERE 🔥
    const awsApiUrl = "https://hem2omj47a.execute-api.eu-north-1.amazonaws.com/default/driver-call-notification"; 

    // This matches the exact variables your Lambda script expects (fcnToken, title, body, orderId)
    const payload = {
        fcnToken: targetToken, 
        title: title,
        body: body,
        orderId: orderId || "unknown"
    };

    try {
        const response = await fetch(awsApiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        console.log("AWS Notification Sent:", result);
        return result;
    } catch (error) {
        console.error("AWS failed to send notification:", error);
        return null;
    }
}
