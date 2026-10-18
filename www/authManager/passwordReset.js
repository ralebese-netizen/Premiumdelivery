import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { showOverlay, hideOverlayAfter } from './overlay.js';
const SUCCESS_VISIBLE_MS = 5000; const ERROR_VISIBLE_MS = 4000;
function humanizeError(error) { switch (error?.code) { case 'auth/user-not-found': return "No account found with that email."; case 'auth/invalid-email': return "That email address is invalid."; case 'auth/too-many-requests': return "Too many attempts. Please try again later."; case 'auth/network-request-failed': return "Network error. Check your connection."; case 'auth/missing-email': return "Please enter your email address."; default: return error?.message || "Could not send reset email."; } }
export async function resetPassword(auth, email) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) { showOverlay("Please enter your email address.", 'error'); hideOverlayAfter(3000); return { success: false, error: 'missing-email' }; }
    showOverlay("Sending reset link...", 'neutral');
    try { await sendPasswordResetEmail(auth, cleanEmail); showOverlay(`✅ Reset link sent to ${cleanEmail}. Check your inbox.`, 'success'); hideOverlayAfter(SUCCESS_VISIBLE_MS); return { success: true }; }
    catch (error) { showOverlay(humanizeError(error), 'error'); hideOverlayAfter(ERROR_VISIBLE_MS); return { success: false, error: error.message }; }
}
