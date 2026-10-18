// authManager/logout.js
//
// Sign-out wrapper.
//
// Firebase's signOut() throws on rare network failures, but callers of
// this function only care about success/failure — never an exception.
// This module swallows the exception and returns a result object.

import {
    signOut,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

/**
 * Signs the current user out.
 *
 * @param {object} auth  Firebase Auth instance
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function logoutUser(auth) {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        console.error("Logout failed:", error);
        return { success: false, error: error.message };
    }
}
