// driver/js/auth-flow.js
// Login, registration, and the Firebase Auth state listener.

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { db, auth, storage, messaging } from "./firebase-init.js";
import {
    monitorAuthState,
    loginUser,
    registerDriver,
    resetPassword,
} from "./authManager.js";
import { getDeviceToken, storeTokenInFirestore, setupForegroundListener } from "./notificationManager.js";
import { syncDriverToken, watchTokenRefresh, verifyTokenOnce } from "./tokenSync.js";
import { ProfileManager } from "./profileManager.js";
import { startTracking, stopTracking } from "./trackingManager.js";
import { initializeOrderSystem } from "./orderManager.js";
import { showToast, showScreen, hideScreen } from "./ui.js";
import { getFleetName } from "./branding.js";
import { startHeartbeat, stopHeartbeat } from "./presence.js";

let orderSystemInitialized = false;
const SERVER_SNAPSHOT_FALLBACK_MS = 3000;

export function initAuthFlow(onCallStateChange) {
    document.getElementById('login-btn').addEventListener('click', handleLoginClick);
    document.getElementById('register-btn').addEventListener('click', handleRegisterClick);

    const forgotBtn = document.getElementById('forgot-password-btn');
    if (forgotBtn) {
        forgotBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            if (!email) {
                return showToast("Enter your email first, then tap Forgot Password.");
            }
            await resetPassword(auth, email);
        });
    }

    document.getElementById('show-signup-btn').addEventListener('click', () => {
        hideScreen('login-screen');
        showScreen('signup-screen');
    });
    document.getElementById('show-login-btn').addEventListener('click', () => {
        hideScreen('signup-screen');
        showScreen('login-screen', 'flex');
    });

    document.getElementById('logout-pending-btn').addEventListener('click', logoutDriver);
    document.getElementById('logout-suspended-btn').addEventListener('click', logoutDriver);

    setupForegroundListener(messaging, 'order-ringtone');
    monitorAuthState(auth, (user) => handleLoggedIn(user, onCallStateChange), handleLoggedOut);
}

async function handleLoginClick() {
    const loginBtn = document.getElementById('login-btn');
    loginBtn.innerText = "Authenticating...";
    loginBtn.disabled = true;

    const result = await loginUser(
        auth,
        document.getElementById('email').value.trim(),
        document.getElementById('password').value
    );
    loginBtn.innerText = "Secure Login";
    loginBtn.disabled = false;
    if (!result.success) showToast("Login Failed: " + result.error);
}

async function handleRegisterClick() {
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;
    const idPhotoFile = document.getElementById('reg-id-photo').files[0];
    const selfieFile = document.getElementById('reg-selfie-photo').files[0];

    if (!email || !pass || !idPhotoFile || !selfieFile) {
        return showToast("Please fill all fields & upload photos.");
    }

    const driverData = {
        fullName: document.getElementById('reg-name').value.trim(),
        phoneNumber: document.getElementById('reg-phone').value.trim(),
        homeAddress: document.getElementById('reg-address').value.trim(),
        emergencyContact: {
            name: document.getElementById('reg-kin-name').value.trim(),
            phone: document.getElementById('reg-kin-phone').value.trim()
        },
        vehicle: {
            type: document.getElementById('reg-vehicle-type').value,
            plateNumber: document.getElementById('reg-plate').value.trim() || "N/A"
        },
        status: 'pending'
    };

    const result = await registerDriver(
        auth, db, storage, email, pass, driverData,
        idPhotoFile, selfieFile, document.getElementById('reg-status')
    );
    
    if (result.success) {
        hideScreen('signup-screen');
        showToast("Registration successful! Checking status...");
    } else {
        showToast("Registration Failed: " + result.error);
    }
}

function showSplash(message = 'Loading...') {
    const splash = document.getElementById('boot-splash');
    if (!splash) return;
    splash.style.display = 'flex';
    const msgEl = splash.querySelector('p');
    if (msgEl) msgEl.innerText = message;
}

function hideSplash() {
    const splash = document.getElementById('boot-splash');
    if (splash) splash.style.display = 'none';
}

async function handleLoggedIn(user, onCallStateChange) {
    hideScreen('login-screen');
    hideScreen('dashboard');
    hideScreen('pending-approval-screen');
    hideScreen('suspended-screen');
    
    showSplash('Signing you in...');

    window.currentDriverId = user.uid;
    
    if (window.syncNativeTokenToFirestore) {
        window.syncNativeTokenToFirestore();
    }

    ProfileManager.init(db, user.uid, "driver");
    ProfileManager.logoutHook = async () => {
        if (confirm("Are you sure you want to log out?")) logoutDriver();
    };

    startHeartbeat(db, 'driver', user.uid);

    const token = await getDeviceToken(messaging);
    window.currentDriverToken = token || "";

    const notifBanner = document.getElementById('notif-banner');

    if (token) {
        if (notifBanner) notifBanner.style.display = 'none';

        syncDriverToken(db, messaging, user.uid).catch((e) =>
            console.warn("[Auth] Initial token sync failed:", e)
        );
        watchTokenRefresh(db, messaging, user.uid).catch((e) =>
            console.warn("[Auth] Token refresh listener failed:", e)
        );
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                verifyTokenOnce(db, messaging, user.uid).catch((e) =>
                    console.warn("[Auth] Foreground verify failed:", e)
                );
            }
        });
    } else {
        if (notifBanner) notifBanner.style.display = 'flex';
    }

    let firstServerSnapshot = false;

    const slowServerFallback = setTimeout(() => {
        if (!firstServerSnapshot) {
            console.warn('[Auth] Server snapshot slow — proceeding with cache data');
            firstServerSnapshot = true;
            hideSplash(); 
        }
    }, SERVER_SNAPSHOT_FALLBACK_MS);

    onSnapshot(doc(db, "drivers", user.uid), { includeMetadataChanges: true }, (docSnap) => {
        if (!firstServerSnapshot) {
            if (docSnap.metadata.fromCache) return; 
            firstServerSnapshot = true;
            clearTimeout(slowServerFallback);
            hideSplash();
        }

        if (docSnap.metadata.fromCache) {
            return; 
        }

        if (!docSnap.exists()) {
            return;
        }

        const data = docSnap.data();
        const status = data.status || 'pending';

        if (status === 'pending' || status === 'suspended') {
            hideScreen('dashboard');
            showScreen('pending-approval-screen', status === 'pending' ? 'block' : 'none');
            showScreen('suspended-screen', status === 'suspended' ? 'block' : 'none');
            stopTracking();
            return;
        }

        hideScreen('pending-approval-screen');
        hideScreen('suspended-screen');
        showScreen('dashboard');

        const balanceEl = document.getElementById('wallet-balance-display');
        if (balanceEl) balanceEl.innerText = 'M ' + parseFloat(data.walletBalance || 0).toFixed(2);

        if (!orderSystemInitialized) {
            initializeOrderSystem({
                db: db,
                driverId: user.uid,
                driverToken: token || "",
                fleetName: getFleetName(),
                isVIP: data.isPriority === true,

                onToast: showToast,
                onOpenChat: (orderId) => window.openChatModal(orderId),
                onStartTracking: (orderId) => startTracking(orderId, db),
                onStopTracking: () => stopTracking(),

                onNewOrderNotification: async (oData) => {
                    if ('Notification' in window && typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
                        const iconUrl = "logo.png";
                        navigator.serviceWorker.ready.then(reg => {
                            reg.showNotification("New Delivery Request!", {
                                body: `Pickup: ${oData.pickup || 'Location'}`,
                                icon: iconUrl,
                                badge: iconUrl
                            });
                        });
                    }
                },

                onCallStateChange: onCallStateChange
            });
            orderSystemInitialized = true;
        }
    });
}

function handleLoggedOut() {
    stopHeartbeat();
    hideSplash();
    hideScreen('dashboard');
    showScreen('login-screen', 'flex');
    window.currentDriverId = null;
    window.currentDriverToken = null;
    orderSystemInitialized = false; 
}

export async function logoutDriver() {
    stopHeartbeat();
    stopTracking();
    await signOut(auth);
    localStorage.removeItem('user_profile');
    window.location.reload();
}

window.enableNotifications = async () => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const banner = document.getElementById('notif-banner');
        if (banner) banner.style.display = 'none';
        showToast("Native notifications are active.");
        return;
    }

    if (!('Notification' in window) || typeof window.Notification === 'undefined') {
        return showToast("⚠️ Notifications are not supported in this browser. Try opening in Chrome.");
    }

    try {
        const permission = await window.Notification.requestPermission();
        
        if (permission === 'granted') {
            const banner = document.getElementById('notif-banner');
            if (banner) banner.style.display = 'none';
            
            showToast("Fetching notification token...");
            
            const token = await getDeviceToken(messaging);
            window.currentDriverToken = token;
            
            if (token && window.currentDriverId) {
                await syncDriverToken(db, messaging, window.currentDriverId);
                showToast("✅ Notifications enabled! Calls will now connect.");
            } else {
                showToast("⚠️ Failed to generate token. Please try again.");
            }
        } else {
            showToast("⚠️ Notifications blocked. Please check browser settings.");
        }
    } catch (error) {
        console.error("[Auth] Error enabling notifications:", error);
        showToast("⚠️ Error requesting permission.");
    }
};
