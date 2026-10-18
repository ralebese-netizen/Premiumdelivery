import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { showOverlay, hideOverlayAfter } from './overlay.js';
const SUCCESS_VISIBLE_MS = 1500; const ERROR_VISIBLE_MS = 3500;
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
