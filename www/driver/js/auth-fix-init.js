// Ensure Firebase Auth uses local persistence for Capacitor WebView
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
// If your app initializes auth, ensure it relies on browserLocalPersistence or indexedDBLocalPersistence
