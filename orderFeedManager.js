/**
 * orderFeedManager.js
 * Manages the real-time Firebase listeners for Active and Pending orders.
 * Handles all UI rendering for the order feed.
 */
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getFleetTag } from './fleetManager.js';
import { updateQueue } from './orderManager.js';
import { startTracking } from './trackingManager.js';
import { endCall } from './callManager.js';

// --- EMPTY STATE HTML COMPONENTS ---
const emptyActiveHtml = `
    <div class="empty-placeholder">
        <svg width="40" height="40" fill="none" stroke="#9ca3af" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom: 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <p class="empty-placeholder-title">No Active Deliveries</p>
        <p class="empty-placeholder-sub">You are currently available for new requests.</p>
    </div>
`;

const emptyPendingHtml = `
    <div class="empty-placeholder">
        <svg width="40" height="40" fill="none" stroke="#9ca3af" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom: 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        <p class="empty-placeholder-title">Searching for requests...</p>
        <p class="empty-placeholder-sub">New delivery requests will appear here.</p>
    </div>
`;

let pendingUnsubscribe = null;
let activeUnsubscribe = null;
let isInitialLoad = true;

export function stopFeedListeners() {
    if (pendingUnsubscribe) { pendingUnsubscribe(); pendingUnsubscribe = null; }
    if (activeUnsubscribe) { activeUnsubscribe(); activeUnsubscribe = null; }
}

export function startPendingOrdersListener(db) {
    if (pendingUnsubscribe) pendingUnsubscribe();
    
    const q = query(collection(db, "orders"), where("status", "in", ["Paid", "Pending"]));
    pendingUnsubscribe = onSnapshot(q, (snap) => {
        
        snap.docChanges().forEach(async change => {
            if (change.type === "added" && !isInitialLoad && Notification.permission === 'granted') {
                let orderOrigin = change.doc.data().appOrigin || "General";
                const currentTag = getFleetTag(); 
                
                if (orderOrigin === currentTag) {
                    let iconUrl = "logo.png"; 
                    let titleText = "🔔 New Delivery Request!";

                    if (orderOrigin !== "General") {
                        try {
                            const tagDoc = await getDoc(doc(db, "tags", orderOrigin));
                            if (tagDoc.exists()) {
                                const tagData = tagDoc.data();
                                titleText = `New order from ${tagData.displayName}!`;
                                if (tagData.isPremium && tagData.logoUrl) iconUrl = tagData.logoUrl;
                            }
                        } catch(e) { console.warn("Could not fetch tag for notification", e); }
                    }

                    navigator.serviceWorker.ready.then(reg => {
                        reg.showNotification(titleText, { body: `Pickup: ${change.doc.data().pickup || 'Location'}`, icon: iconUrl, badge: iconUrl });
                    });
                }
            }
        });
        isInitialLoad = false;

        let incomingOrders = [];
        const currentTag = getFleetTag(); 
        
        snap.forEach(d => {
            let oData = d.data();
            let orderOrigin = oData.appOrigin || "General";
            
            // 🚨 ENGINE HANDLES THE TIME DELAY, SO WE PASS ALL ELIGIBLE ORDERS TO IT
            if (orderOrigin === currentTag || orderOrigin === "General") {
                let itemFunds = oData.itemFunds ? parseFloat(oData.itemFunds) : 0;
                let tip = oData.tipAmount ? parseFloat(oData.tipAmount) : 0;
                
                if (oData.baseDeliveryFee) {
                    let base = parseFloat(oData.baseDeliveryFee.replace(/[^\d.]/g, '')) || 0;
                    let adminCut = Math.ceil(base * 0.01);
                    let driverEarns = Math.floor(base * 0.95) + tip - adminCut;
                    
                    oData.fee = "M" + driverEarns + (itemFunds > 0 ? ` (+ M${itemFunds} for items)` : "");
                } else if (oData.fee) {
                    let rawFee = parseFloat(oData.fee.replace(/[^\d.]/g, '')) || 0;
                    oData.fee = "M" + Math.floor(rawFee * 0.94); 
                }
                incomingOrders.push({ id: d.id, ...oData });
            }
        });
        
        // 🚨 PUSH DATA TO MVC ENGINE
        updateQueue(incomingOrders); 

        if (incomingOrders.length === 0) {
            const pCont = document.getElementById('pending-container');
            if (pCont) pCont.innerHTML = emptyPendingHtml;
        }
    });
} 

export function startActiveOrdersListener(db, driverId) {
    if (!driverId) return;
    if (activeUnsubscribe) activeUnsubscribe();
    
    const q = query(collection(db, "orders"), where("status", "==", "Accepted"), where("driverId", "==", driverId));
    activeUnsubscribe = onSnapshot(q, (snap) => {
        const cont = document.getElementById('active-container');
        if (!cont) return;

        let isAnyoneCalling = false;
        let callingOrderId = null;
        let newHtml = '';
        let hasActiveOrders = false;

        snap.forEach(d => {
            hasActiveOrders = true;
            const o = d.data();
            
            startTracking(d.id, db); 
            
            if (o.incomingCall === 'CallEnded') endCall(); 

            if (o.incomingCall === 'CustomerCalling') {
                isAnyoneCalling = true;
                callingOrderId = d.id;
            }

            let itemFunds = o.itemFunds ? parseFloat(o.itemFunds) : 0;
            let tipAmount = o.tipAmount ? parseFloat(o.tipAmount) : 0;
            let displayFee = o.fee || 'M0';

            if (o.baseDeliveryFee) {
                let base = parseFloat(o.baseDeliveryFee.replace(/[^\d.]/g, '')) || 0;
                let adminCut = Math.ceil(base * 0.01);
                let driverEarns = Math.floor(base * 0.95) + tipAmount - adminCut;
                displayFee = "M" + driverEarns + ` <span style="font-size: 13px; color: #8c929c; font-weight: 600;">Earned</span>`;
            } else if (o.fee) {
                let rawFee = parseFloat(o.fee.replace(/[^\d.]/g, '')) || 0;
                displayFee = "M" + Math.floor(rawFee * 0.94);
            }

            let fundsWarningHtml = '';
            if (itemFunds > 0) {
                fundsWarningHtml = `
                <div style="background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; padding: 12px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                        FUNDS FOR ITEMS
                    </div>
                    <span style="font-size: 18px;">M${itemFunds}</span>
                </div>`;
            }

            let mapLink = 'javascript:void(0)';
            if (o.mapPin) mapLink = o.mapPin;
            else if (o.dropoff) mapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.dropoff)}`;

            let extraInfo = `<span style="background: #e85d21; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; display: inline-block; margin-bottom: 8px;">${o.vehicle || 'Bike'}</span>`;

            if (o.items && o.items.length > 0) {
                let itemsText = o.items.map(item => `1x ${item.name}`).join(' • ');
                extraInfo += `<div class="info-row"><svg class="svg-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg> <span><strong style="color: #111827;">Order:</strong> ${itemsText}</span></div>`;
            }

            if (o.desc && o.desc.trim() !== "") {
                extraInfo += `<div class="info-row"><svg class="svg-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> <span>${o.desc}</span></div>`;
            }
            if (o.voiceNote && o.voiceNote !== "") {
                extraInfo += `
                <div class="info-row" style="margin-top: 15px; flex-direction: column; align-items: flex-start; gap: 8px;">
                    <div style="font-size: 11px; font-weight: 700; color: #51b882; display: flex; align-items: center; gap: 6px;">
                        <svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                        CUSTOMER VOICE NOTE
                    </div>
                    <audio controls src="${o.voiceNote}" type="audio/webm" preload="auto" style="width: 100%; height: 45px; z-index: 10; position: relative;"></audio>
                </div>`;
            }
            const infoBoxHtml = extraInfo ? `<div class="info-box" style="margin-top: 15px;">${extraInfo}</div>` : '';

            newHtml += `
            <div class="order-card">
                <div class="card-top">
                    <div class="price">${displayFee}</div>
                    <div class="status-pill status-active">IN PROGRESS</div>
                </div>
                ${fundsWarningHtml}
                <div class="timeline">
                    <div class="t-line"></div>
                    <div class="step"><div class="marker-pickup"></div><div class="label">PICKUP</div><div class="val">${o.pickup || 'N/A'}</div></div>
                    <div class="step"><div class="marker-dropoff"></div><div class="label">DROPOFF</div><div class="val">${o.dropoff || 'Location in Map Pin'}</div></div>
                </div>
                ${infoBoxHtml}
                <div class="btn-row" style="margin-top: 15px;">
                    <a href="${mapLink}" target="_blank" class="btn-outline"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg> Navigate</a>
                    <button class="btn-outline" onclick="openChatModal('${d.id}')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> Chat & Call</button>
                </div>
                <button class="btn-complete" onclick="verifyPinAndComplete('${d.id}')">Complete Delivery (Requires PIN)</button>
            </div>`;
        });

        if (!hasActiveOrders) cont.innerHTML = emptyActiveHtml;
        else if (cont.innerHTML !== newHtml) cont.innerHTML = newHtml;

        const incomingBanner = document.getElementById('incoming-call-banner');
        if (incomingBanner) {
            if (isAnyoneCalling) {
                window.incomingCallOrderId = callingOrderId;
                incomingBanner.style.display = 'block';
            } else {
                window.incomingCallOrderId = null;
                incomingBanner.style.display = 'none';
            }
        }
    });
}
