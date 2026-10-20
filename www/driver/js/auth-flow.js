// driver/js/auth-flow.js
// Login, registration, and the Firebase Auth state listener.

import { doc, onSnapshot, collection, query, where, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { db, auth, storage } from "./firebase-init.js";
import {
    monitorAuthState,
    loginUser,
    registerDriver,
    resetPassword,
} from "../../authManager.js";
import { ProfileManager } from "../../profileManager.js";
import { startTracking, stopTracking } from "../../trackingManager.js";
import { initializeOrderSystem } from "../../orderManager.js";
import { showToast, showScreen, hideScreen } from "./ui.js";
import { getFleetName } from "./branding.js";
import { startHeartbeat, stopHeartbeat } from "../../presence.js";

// 🟢 IMPORT THE CAPACITOR TOKEN SYNC
import { syncDriverToken, watchTokenRefresh } from "./tokenSync.js";

let orderSystemInitialized = false;
const SERVER_SNAPSHOT_FALLBACK_MS = 3000;

// 🟢 Background timers
let orderTokenSyncInterval = null;

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

// 🟢 AUTO-SYNC TOKEN TO ACCEPTED ORDERS (Runs every 30s)
function startActiveOrderTokenSync(userId) {
    if (orderTokenSyncInterval) clearInterval(orderTokenSyncInterval);

    orderTokenSyncInterval = setInterval(async () => {
        if (!window.currentDriverId || !window.currentDriverToken) return;

        try {
            const q = query(
                collection(db, "orders"),
                where("driverId", "==", userId),
                where("status", "in", ["Accepted", "Picked Up", "In Transit"])
            );
            const snap = await getDocs(q);
            
            for (const orderDoc of snap.docs) {
                if (orderDoc.data().driverFcmToken !== window.currentDriverToken) {
                    console.log(`[Auto-Sync] Updating FCM token on accepted order ${orderDoc.id}`);
                    await updateDoc(doc(db, "orders", orderDoc.id), {
                        driverFcmToken: window.currentDriverToken
                    });
                }
            }
        } catch (e) {
            console.warn("[Auto-Sync] Failed:", e);
        }
    }, 30000); 
}

async function handleLoggedIn(user, onCallStateChange) {
    hideScreen('login-screen');
    hideScreen('dashboard');
    hideScreen('pending-approval-screen');
    hideScreen('suspended-screen');

    showSplash('Signing you in...');

    window.currentDriverId = user.uid;

    // 🟢 1. SETUP NATIVE CALL CHANNEL & FCM
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const { PushNotifications, LocalNotifications } = window.Capacitor.Plugins || {};
            
            if (LocalNotifications) {
                // A. Create the high-priority Call Notification Channel
                try {
                    await LocalNotifications.deleteChannel({ id: 'bofelo_calls' });
                } catch (e) {}
                
                await LocalNotifications.createChannel({
                    id: 'bofelo_calls',
                    name: 'Incoming Calls',
                    description: 'Ringing for customer calls',
                    importance: 5, // High importance (makes sound)
                    visibility: 1, // Public (shows on lock screen)
                    sound: 'ringtone', // Uses the phone's default ringtone
                    vibration: true,   
                    lights: true,      
                    vibrationPattern: [500, 1000, 500, 1000, 500, 1000] 
                });
                console.log("[Auth] ✅ Call notification channel created");

                // B. Create the Message Notification Channel
                try {
                    await LocalNotifications.deleteChannel({ id: 'bofelo_messages' });
                } catch (e) {}
                
                await LocalNotifications.createChannel({
                    id: 'bofelo_messages',
                    name: 'Messages & Updates',
                    description: 'Chats and order updates',
                    importance: 4, // High importance
                    visibility: 1, 
                    sound: 'default',
                    vibration: true,
                    vibrationPattern: [200, 100, 200] // Short double buzz
                });
                console.log("[Auth] ✅ Message notification channel created");
            }

            // C. Force FCM Registration
            if (PushNotifications) {
                console.log("[Auth] Forcing native FCM registration on login...");
                PushNotifications.removeAllListeners();
                
                PushNotifications.addListener('registration', async (token) => {
                    console.log('[FCM/native] Token received:', token.value.slice(0, 20) + '...');
                    window.nativeFcmToken = token.value;
                    window.currentDriverToken = token.value;
                    
                    // Sync it immediately using the new module
                    await syncDriverToken(db, user.uid);
                });

                await PushNotifications.register();
            }
        } catch (err) {
            console.warn('[Auth] Failed to force FCM registration:', err);
        }
    }

    // 🟢 2. START TOKEN REFRESH LISTENER
    watchTokenRefresh(db, user.uid);

    // 🟢 3. START THE 30-SECOND ACCEPTED-ORDER SYNC LOOP
    startActiveOrderTokenSync(user.uid);

    ProfileManager.init(db, user.uid, "driver");
    ProfileManager.logoutHook = async () => {
        if (confirm("Are you sure you want to log out?")) logoutDriver();
    };

    startHeartbeat(db, 'driver', user.uid);

    const token = window.nativeFcmToken || "";
    window.currentDriverToken = token;

    const notifBanner = document.getElementById('notif-banner');
    if (notifBanner) notifBanner.style.display = token ? 'none' : 'flex';

    let firstServerSnapshot = false;

    const slowServerFallback = setTimeout(() => {
        if (!firstServerSnapshot) {
            console.warn('[Auth] Server snapshot slow — proceeding');
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

        if (docSnap.metadata.fromCache) return;
        if (!docSnap.exists()) return;

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
    // 🟢 CLEAR THE AUTO-SYNC TIMER
    if (orderTokenSyncInterval) {
        clearInterval(orderTokenSyncInterval);
        orderTokenSyncInterval = null;
    }

    stopHeartbeat();
    hideSplash();
    hideScreen('dashboard');
    showScreen('login-screen', 'flex');
    window.currentDriverId = null;
    window.currentDriverToken = null;
    window.nativeFcmToken = null;
    orderSystemInitialized = false;
}

export async function logoutDriver() {
    // 🟢 CLEAR THE AUTO-SYNC TIMER
    if (orderTokenSyncInterval) {
        clearInterval(orderTokenSyncInterval);
        orderTokenSyncInterval = null;
    }

    stopHeartbeat();
    stopTracking();
    await signOut(auth);
    localStorage.removeItem('user_profile');
    window.location.reload();
}

// Native banner dismiss + retry trigger (called from HTML onclick)
window.enableNotifications = async () => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const banner = document.getElementById('notif-banner');
        if (banner) banner.style.display = 'none';

        try {
            const { PushNotifications } = window.Capacitor.Plugins || {};
            if (PushNotifications) {
                let perm = await PushNotifications.checkPermissions();
                if (perm.receive !== 'granted') {
                    perm = await PushNotifications.requestPermissions();
                }
                if (perm.receive === 'granted') {
                    await PushNotifications.register();
                    showToast("Native notifications active.");

                    if (window.currentDriverId) {
                        await syncDriverToken(db, window.currentDriverId);
                    }
                } else {
                    showToast("⚠️ Permission denied in device settings.");
                }
            }
        } catch (e) {
            console.warn('[Auth] Native enableNotifications failed:', e);
        }
        return;
    }

    showToast("Open this app on the device to enable notifications.");
};
