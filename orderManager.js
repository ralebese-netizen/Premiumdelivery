/**
 * orderManager.js
 * Enterprise Order Queue & Dispatch Module
 * Architecture: State Encapsulation, Pure Queue Engine, UI Controller Isolation
 */

import { doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { stopTracking } from './trackingManager.js';

// ==========================================
// 1. MODULE CONFIGURATION & STATE
// ==========================================
const CONFIG = {
    VIP_DELAY_MS: 10 * 1000, // 10 seconds for non-VIPs
    POLL_RATE_MS: 1000       // Engine tick rate
};

const OrderState = {
    rawOrders: [],
    processedQueue: [],
    declinedIds: new Set(),
    isBusy: false,
    engineTimer: null
};

const getOrderTime = (order) => {
    if (order.timestamp && typeof order.timestamp.toMillis === 'function') return order.timestamp.toMillis();
    if (order.orderTimestamp) return order.orderTimestamp;
    return Date.now();
};

// ==========================================
// 2. UI CONTROLLER (DOM Abstraction)
// ==========================================
const OrderUI = {
    getContainer: () => document.getElementById('pending-container'),
    
    isAppBusy: () => {
        const activeCont = document.getElementById('active-container');
        return OrderState.isBusy || (activeCont && activeCont.innerHTML.trim() !== '');
    },

    renderEmpty: () => {
        const container = OrderUI.getContainer();
        if (!container) return;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; display: flex; flex-direction: column; align-items: center;">
                <svg style="width: 80px; height: 80px; stroke: #cbd5e1; fill: none; margin-bottom: 16px;" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="12" y2="12"></line></svg>
                <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0;">No New Requests</h3>
                <p style="color: #6b7280; font-size: 15px; margin: 0;">Finding deliveries nearby...</p>
            </div>`;
    },

    renderBusy: () => {
        const container = OrderUI.getContainer();
        if (!container) return;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; display: flex; flex-direction: column; align-items: center;">
                <svg style="width: 80px; height: 80px; stroke: #cbd5e1; fill: none; margin-bottom: 16px;" viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="12" y2="12"></line></svg>
                <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0;">Delivery in Progress</h3>
                <p style="color: #6b7280; font-size: 15px; margin: 0;">Complete your current order to see new requests.</p>
            </div>`;
    },

    renderOrder: (order, isVIP, isPriorityAged) => {
        const container = OrderUI.getContainer();
        if (!container) return;

        const badgeHtml = (isVIP && !isPriorityAged) 
            ? '<div class="status-pill status-vip">⭐ PRIORITY</div>' 
            : '<div class="status-pill status-new">NEW</div>';

        const extraInfo = (order.desc && order.desc.trim() !== "") 
            ? `<div class="info-row"><svg class="svg-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> <span>${order.desc}</span></div>` 
            : '';
            
        const infoBoxHtml = extraInfo ? `<div class="info-box" style="margin-top: 15px;">${extraInfo}</div>` : '';

        container.innerHTML = `
            <div class="order-card">
                <div class="card-top">
                    <div class="price">${order.fee || 'M0'}</div>
                    ${badgeHtml}
                </div>
                <div class="timeline">
                    <div class="t-line"></div>
                    <div class="step">
                        <div class="marker-pickup"></div>
                        <div class="label">PICKUP</div>
                        <div class="val">${order.pickup || 'N/A'}</div>
                    </div>
                    <div class="step">
                        <div class="marker-dropoff"></div>
                        <div class="label">DROPOFF</div>
                        <div class="val">${order.dropoff || 'Location in Map Pin'}</div>
                    </div>
                </div>
                ${infoBoxHtml}
                <div class="btn-row" style="margin-top: 15px;">
                    <button class="btn-outline" onclick="window.declineOrder('${order.id}')" style="background:#fef3c7; border-color:#f59e0b; color:#d97706; flex: 1; transition: 0.2s;"> Decline</button>
                    <button class="btn-complete btn-accept" onclick="window.acceptOrder('${order.id}')" style="flex: 1; margin: 0; transition: 0.2s;"> Accept</button>
                </div>
            </div>
        `;
    }
};

// ==========================================
// 3. CORE QUEUE ENGINE
// ==========================================
function processQueueEngine() {
    const now = Date.now();
    const isDriverVIP = window.isDriverVIP === true;

    OrderState.processedQueue = OrderState.rawOrders
        .filter(order => !OrderState.declinedIds.has(order.id))
        .filter(order => {
            const ageMs = now - getOrderTime(order);
            return isDriverVIP || ageMs >= CONFIG.VIP_DELAY_MS;
        })
        .sort((a, b) => getOrderTime(a) - getOrderTime(b));

    renderCurrentState();
}

function renderCurrentState() {
    if (OrderUI.isAppBusy()) {
        OrderUI.renderBusy();
        return;
    }

    if (OrderState.processedQueue.length === 0) {
        OrderUI.renderEmpty();
        return;
    }

    const topOrder = OrderState.processedQueue[0];
    const ageMs = Date.now() - getOrderTime(topOrder);
    const isPriorityAged = ageMs >= CONFIG.VIP_DELAY_MS;

    OrderUI.renderOrder(topOrder, window.isDriverVIP, isPriorityAged);
}

function startEngine() {
    if (OrderState.engineTimer) clearInterval(OrderState.engineTimer);
    OrderState.engineTimer = setInterval(() => {
        if (!OrderUI.isAppBusy() && OrderState.rawOrders.length > 0) {
            processQueueEngine();
        }
    }, CONFIG.POLL_RATE_MS);
}

// ==========================================
// 4. EXPORTED API CONTROLLERS
// ==========================================
export function updateQueue(firebaseOrders) {
    OrderState.rawOrders = firebaseOrders;
    processQueueEngine();
    
    if (!OrderState.engineTimer) startEngine();
}

export async function acceptOrder(db, orderId, driverId, driverFcmToken) {
    if (OrderState.isBusy) return; 

    OrderState.isBusy = true;
    renderCurrentState(); // Optimistic UI update

    try {
        let updateData = { status: 'Accepted', driverId: driverId };
        if (driverFcmToken) updateData.driverFcmToken = driverFcmToken;
        
        await updateDoc(doc(db, "orders", orderId), updateData);
    } catch (err) { 
        console.error("Failed to attach token/accept order:", err); 
        OrderState.isBusy = false;
        renderCurrentState();
    }
}

export function declineOrder(orderId) {
    if (OrderState.isBusy) return; 

    OrderState.declinedIds.add(orderId);
    processQueueEngine();
}

export async function verifyPinAndComplete(db, orderId, driverId) {
    const enteredPin = prompt("Please enter the 4-digit PIN provided by the customer:");
    if (!enteredPin) return; 

    try {
        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (orderSnap.exists()) {
            const orderData = orderSnap.data();
            if (!orderData.deliveryPin || orderData.deliveryPin === enteredPin) {
                if (window.showToast) window.showToast("PIN Verified! Processing completion...");
                await completeDelivery(db, orderId, driverId);
            } else {
                if (window.showToast) window.showToast("Incorrect PIN. Please ask the customer.");
            }
        }
    } catch (error) {
        console.error("Error verifying PIN:", error);
        if (window.showToast) window.showToast("Network error verifying PIN. Try again.");
    }
}

async function completeDelivery(db, orderId, driverId) {
    stopTracking(); 
    
    try {
        await updateDoc(doc(db, "orders", orderId), { status: 'Completed' });

        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (orderSnap.exists()) {
            const oData = orderSnap.data();
            
            let base = oData.baseDeliveryFee ? parseFloat(oData.baseDeliveryFee.replace(/[^\d.]/g, '')) : 0;
            if (!base && oData.fee) base = parseFloat(oData.fee.replace(/[^\d.]/g, '')) || 0;
            
            let tip = oData.tipAmount ? parseFloat(oData.tipAmount) : 0;
            let itemFunds = oData.itemFunds ? parseFloat(oData.itemFunds) : 0;
            
            let adminCommission = Math.ceil(base * 0.01);
            if (base === 0) adminCommission = 0; 
            
            let driverEarnings = Math.floor(base * 0.95) + tip; 
            let totalToAdd = driverEarnings + itemFunds - adminCommission;

            if (totalToAdd > 0 && driverId) {
                await updateDoc(doc(db, "drivers", driverId), {
                    walletBalance: increment(totalToAdd),
                    deliveriesCount: increment(1)
                });
                
                await updateDoc(doc(db, "orders", orderId), {
                    adminCommissionDeducted: adminCommission,
                    driverPayoutAmount: totalToAdd
                });
                
                if (window.showToast) window.showToast(`Delivery Complete! M${totalToAdd} added to Wallet (1% Admin Fee Deducted).`);
            } else if (driverId) {
                await updateDoc(doc(db, "drivers", driverId), { deliveriesCount: increment(1) });
                if (window.showToast) window.showToast(`Delivery Complete!`);
            }
        }
    } catch (error) { 
        console.error("Failed to update wallet balance:", error); 
    } finally {
        OrderState.isBusy = false;
        processQueueEngine();
    }
}

