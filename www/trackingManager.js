// trackingManager.js
// Manages the device's GPS sensor and updates Firestore with the live location.

import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let gpsWatchId = null;

// 1. Turn on the GPS and start sending data to Firebase
export function startTracking(orderId, db) {
    // If we are already tracking, don't start a second timer!
    if (gpsWatchId) return; 

    if (!navigator.geolocation) {
        console.error("Geolocation is not supported by this browser.");
        return;
    }

    console.log("📍 Starting GPS tracking for order:", orderId);

    // Watch the phone's location continuously
    gpsWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            // Send the new coordinates to the Firebase tracking subcollection
            setDoc(doc(db, "orders", orderId, "tracking", "live_location"), {
                lat: lat,
                lng: lng,
                timestamp: serverTimestamp()
            }, { merge: true }).catch(e => console.error("GPS Firebase error:", e));
        },
        (error) => {
            console.warn("GPS tracking error:", error.message);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

// 2. Turn off the GPS to save battery
export function stopTracking() {
    if (gpsWatchId) {
        console.log("🛑 Stopping GPS tracking.");
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}
