import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
let gpsWatchId = null;
export function startTracking(orderId, db) { if (gpsWatchId) return; if (!navigator.geolocation) return; gpsWatchId = navigator.geolocation.watchPosition((position) => { setDoc(doc(db, "orders", orderId, "tracking", "live_location"), { lat: position.coords.latitude, lng: position.coords.longitude, timestamp: serverTimestamp() }, { merge: true }).catch(e => console.error(e)); }, (error) => console.warn(error), { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }); }
export function stopTracking() { if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; } }
