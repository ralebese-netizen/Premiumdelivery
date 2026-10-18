// authManager/monitor.js
//
// Bridges Firebase's onAuthStateChanged to your own callbacks.
//
// The Firebase SDK fires once immediately on registration (with the
// current user, or null) and then again on every auth state change.
// This wrapper just cleans up the branching so callers write:
//
//     monitorAuthState(auth, onLogin, onLogout);
//
// instead of a raw `onAuthStateChanged(auth, (user) => { if (user) ... else ... })`
// every time.

import {
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

/**
 * Subscribes to Firebase auth state changes.
 *
 * @param {object} auth                  Firebase Auth instance
 * @param {(user: object) => void} onLogin   Called when a user is signed in
 * @param {() => void} onLogout              Called when there is no user
 * @returns {() => void}                     Unsubscribe function
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
