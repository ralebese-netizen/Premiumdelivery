/**
 * app.js (Driver Portal)
 * Pure Orchestrator for the Bofelo Driver Application
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, doc, updateDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-check.js";

// --- MODULE IMPORTS ---
import { acceptOrder, declineOrder, verifyPinAndComplete } from './orderManager.js';
import { joinCallRoom, endCall, setupWebCallButton } from './callManager.js';
import { stopTracking } from './trackingManager.js';
import { setupChatSystem, stopChatListener } from './chatManager.js';
import { setupAuthUI, monitorAuthState, logoutDriver } from './authManager.js';
import { setupForegroundListener, getDeviceToken } from './notificationManager.js';
import { ProfileManager } from './profileManager.js';
import { setupPBXButton } from './pbxManager.js';
import { setupFleetManager } from './fleetManager.js'; 
import { requestWithdrawal } from './walletManager.js'; 
import { setupPWAInstaller } from './pwaManager.js'; 
import { startPendingOrdersListener, startActiveOrdersListener, stopFeedListeners } from './orderFeedManager.js'; // 🚨 IMPORTED

window.showToast = function(message) {
    let toast = document.getElementById("custom-toast");
    if (toast) {
        toast.innerText = message; 
        toast.classList.add("show");
        setTimeout(() => { toast.classList.remove("show"); }, 3000);
    }
};

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyDEWFybj_bQMCn8QNvc5uSeriwmen-ZfWQ",
    authDomain: "agile-skyline-489209-t3.firebaseapp.com",
    projectId: "agile-skyline-489209-t3",
    storageBucket: "agile-skyline-489209-t3.firebasestorage.app",
    messagingSenderId: "490119776359",
    appId: "1:490119776359:web:c940ba8ddb2cc2fd182cc2"
};

const app = initializeApp(firebaseConfig);

try {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider('6Leg2NksAAAAAJICVaO6ehdDp1HKLmIg3QMF2_3U'), 
        isTokenAutoRefreshEnabled: true
    });
} catch (e) { console.warn("App check failed to initialize:", e); }

const db = getFirestore(app);
const auth = getAuth(app);
const messaging = getMessaging(app);
const storage = getStorage(app);

// --- GLOBALS & BRIDGES ---
window.currentDriverToken = null;
window.activeChatOrderId = null;
window.currentDriverId = null;
window.isDriverVIP = false;
window.incomingCallOrderId = null;
const MY_ROLE = "Driver"; 

// 🚨 BIND MODULE FUNCTIONS TO WINDOW FOR HTML EVENTS
window.requestWithdrawal = () => requestWithdrawal(window.currentDriverId);
window.declineOrder = declineOrder;
window.acceptOrder = (orderId) => acceptOrder(db, orderId, window.currentDriverId, window.currentDriverToken);
window.verifyPinAndComplete = (orderId) => verifyPinAndComplete(db, orderId, window.currentDriverId);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registered:', reg.scope))
        .catch(err => console.error('Service Worker registration failed:', err));
}

// --- INITIALIZE UI MODULES ---
setupFleetManager(db);
setupAuthUI(auth, db, storage); 
setupPWAInstaller(); 

// --- AUTHENTICATION & LOGIN ---
window.logoutFromPending = async () => {
    if (window.stopTracking) window.stopTracking(); 
    stopFeedListeners();
    await logoutDriver(auth);
};

monitorAuthState(auth, async (user) => {
    window.currentDriverId = user.uid;
    document.getElementById('login-screen').style.display = 'none';
    
    ProfileManager.init(db, user.uid, "driver");
    ProfileManager.logoutHook = async () => {
        if (confirm("Are you sure you want to log out?")) window.logoutFromPending();
    };

    try {
        const token = await getDeviceToken(messaging);
        if (token) {
            await setDoc(doc(db, "drivers", user.uid), { fcmToken: token }, { merge: true });
            window.currentDriverToken = token;
        }
    } catch (e) { console.warn(e); }

    onSnapshot(doc(db, "drivers", user.uid), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const status = data.status || 'pending';

            if (status === 'pending') {
                document.getElementById('dashboard').style.display = 'none';
                if(document.getElementById('suspended-screen')) document.getElementById('suspended-screen').style.display = 'none';
                if(document.getElementById('pending-approval-screen')) document.getElementById('pending-approval-screen').style.display = 'block';
                if (window.stopTracking) window.stopTracking();
                stopFeedListeners();
                return; 
            }
            
            if (status === 'suspended') {
                document.getElementById('dashboard').style.display = 'none';
                if(document.getElementById('pending-approval-screen')) document.getElementById('pending-approval-screen').style.display = 'none';
                if(document.getElementById('suspended-screen')) document.getElementById('suspended-screen').style.display = 'block';
                if (window.stopTracking) window.stopTracking();
                stopFeedListeners();
                return; 
            }

            if(document.getElementById('pending-approval-screen')) document.getElementById('pending-approval-screen').style.display = 'none';
            if(document.getElementById('suspended-screen')) document.getElementById('suspended-screen').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';

            window.isDriverVIP = data.isPriority === true;
            
            const balance = data.walletBalance || 0;
            const balanceEl = document.getElementById('wallet-balance-display');
            if(balanceEl) balanceEl.innerText = 'M ' + parseFloat(balance).toFixed(2);

            // 🚨 START MODULAR FEED LISTENERS
            startPendingOrdersListener(db);
            startActiveOrdersListener(db, window.currentDriverId);

        } else {
            document.getElementById('dashboard').style.display = 'none';
            if(document.getElementById('suspended-screen')) document.getElementById('suspended-screen').style.display = 'none';
            if(document.getElementById('pending-approval-screen')) document.getElementById('pending-approval-screen').style.display = 'block';
        }
    }, (error) => {
        console.error(error);
        window.showToast("Database error or App Check blocked access.");
    });
    
}, () => {
    document.getElementById('dashboard').style.display = 'none';
    if(document.getElementById('pending-approval-screen')) document.getElementById('pending-approval-screen').style.display = 'none';
    if(document.getElementById('suspended-screen')) document.getElementById('suspended-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    window.currentDriverId = null;
    window.currentDriverToken = null;
    stopFeedListeners();
});

if (typeof setupForegroundListener === 'function') {
    setupForegroundListener(messaging, 'order-ringtone');
}

// --- CALL & CHAT WRAPPERS ---
window.answerCall = () => {
    document.getElementById('incoming-call-banner').style.display = 'none';
    const orderId = window.incomingCallOrderId;
    if (!orderId) return;
    
    const activeBanner = document.getElementById('active-call-banner');
    if (activeBanner) activeBanner.style.display = 'flex';
    
    updateDoc(doc(db, "orders", orderId), { incomingCall: 'CallActive' }).catch(e => console.error("Failed to update call status:", e));
    joinCallRoom(orderId, window.currentDriverId);
};

window.dismissCall = () => {
    document.getElementById('incoming-call-banner').style.display = 'none';
    const orderId = window.incomingCallOrderId;
    if (orderId) updateDoc(doc(db, "orders", orderId), { incomingCall: false });
};

window.endCall = async () => {
    const orderId = window.activeChatOrderId || window.incomingCallOrderId;
    if (orderId) await updateDoc(doc(db, "orders", orderId), { incomingCall: 'CallEnded' });
    endCall();
};

window.openChatModal = (orderId) => {
    window.activeChatOrderId = orderId;
    document.getElementById('chat-modal').style.display = 'block';
    
    if (typeof setupWebCallButton === 'function') setupWebCallButton('dynamic-webcall-container', db, orderId, window.currentDriverId);
    if (typeof setupPBXButton === 'function') setupPBXButton('dynamic-pbx-container', db, orderId, window.currentDriverId);
    
    setupChatSystem(db, storage, orderId, MY_ROLE, "chat-container-module");
};

window.closeChatModal = () => {
    document.getElementById('chat-modal').style.display = 'none';
    if (typeof stopChatListener === 'function') stopChatListener();
    window.activeChatOrderId = null;
    const chatMod = document.getElementById('chat-container-module');
    if (chatMod) chatMod.innerHTML = '';
};

