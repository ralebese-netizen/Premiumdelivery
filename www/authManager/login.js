// authManager/login.js
//
// Email/password login.
//
// Shows a status overlay while the Firebase SDK processes the sign-in,
// then swaps the overlay to a success or error state based on the result.
//
// The overlay is owned by overlay.js — this file never touches the DOM
// directly.

import {
    signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { showOverlay, hideOverlayAfter } from './overlay.js';

const SUCCESS_VISIBLE_MS = 1500;
const ERROR_VISIBLE_MS   = 3500;

/**
 * Signs in an existing user with email + password.
 *
 * @param {object} auth      Firebase Auth instance
 * @param {string} email     The user's email
 * @param {string} password  The user's password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function loginUser(auth, email, password) {
    showOverlay("Authenticating...", 'neutral');

    try {
        const credential = await signInWithEmailAndPassword(auth, email, password);

        showOverlay("Login Successful!", 'success');
        hideOverlayAfter(SUCCESS_VISIBLE_MS);

        return { success: true, user: credential.user };

    } catch (error) {
        console.error("Login failed:", error);

        showOverlay("Login failed: " + error.message, 'error');
        hideOverlayAfter(ERROR_VISIBLE_MS);

        return { success: false, error: error.message };
    }
}
