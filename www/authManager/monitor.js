// authManager/monitor.js
//
// Bridges Firebase's onAuthStateChanged to your own callbacks.

import {
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

/**
 * Subscribes to Firebase auth state changes.
 */
export function monitorAuthState(auth, onLogin, onLogout) {
    return onAuthStateChanged(auth, (user) => {
        if (user) {
            onLogin(user);
        } else {
            onLogout();
        }
    });
}
