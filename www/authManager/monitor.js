import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
export function monitorAuthState(auth, onLogin, onLogout) {
    return onAuthStateChanged(auth, (user) => { if (user) onLogin(user); else onLogout(); });
}
