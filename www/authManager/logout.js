import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
export async function logoutUser(auth) {
    try { await signOut(auth); return { success: true }; } catch (error) { console.error("Logout failed:", error); return { success: false, error: error.message }; }
}
