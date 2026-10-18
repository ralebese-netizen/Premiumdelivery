// orderManager/render.js
// All HTML string building for the order cards.

import { env, state } from "./state.js";
import { getVehicleName } from "./helpers.js";

// -----------------------------------------------------------------------------
// Pending queue
// -----------------------------------------------------------------------------

export function renderPendingQueue(orders) {
    const container = document.getElementById('pending-container');
    if (!container) return;

    if (state.hasActiveOrder) {
        container.innerHTML = getActiveInProgressHtml();
        return;
    }

    if (orders.length === 0) {
        container.innerHTML = getNoOrdersHtml();
        return;
    }

    const order = orders[0];
    container.innerHTML = getPendingCardHtml(order);
}

function getActiveInProgressHtml() {
    return `
        <div style="text-align: center; padding: 60px 20px; display: flex; flex-direction: column; align-items: center;">
            <svg style="width: 80px; height: 80px; stroke: #cbd5e1; fill: none; margin-bottom: 16px;" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="12" y2="12"></line></svg>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0;">Delivery in Progress</h3>
            <p style="color: #6b7280; font-size: 15px; margin: 0;">Complete your current order to see new requests.</p>
        </div>`;
}

function formatItemForDriver(item) {
    if ((item.pricingType || '').toUpperCase() === 'WEIGHT') {
        const qty = item.displayQty || item.qty || '';
        return `${qty} ${item.name}`.trim();
    }
    const qty = Number(item.qty ?? item.quantity ?? 1);
    return `${qty}x ${item.name}`;
}

function buildMapLink(order) {
    if (order.mapPin) return order.mapPin;

    if (order.dropoffCoords?.lat && order.dropoffCoords?.lng) {
        return `https://www.google.com/maps/search/?api=1&query=${order.dropoffCoords.lat},${order.dropoffCoords.lng}`;
    }

    const fallbackQuery = order.dropoff && order.dropoff !== 'Location in Map Pin'
        ? order.dropoff
        : 'Maseru';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery)}`;
}

function formatDropoffDisplay(order) {
    const hasAddress = order.dropoff && order.dropoff !== 'Location in Map Pin';
    const addressLine = hasAddress ? order.dropoff : 'Pin on Map';

    const coordsLine = order.dropoffCoords?.lat && order.dropoffCoords?.lng
        ? `<br><span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">📍 ${Number(order.dropoffCoords.lat).toFixed(4)}, ${Number(order.dropoffCoords.lng).toFixed(4)}</span>`
        : '';

    return `${addressLine}${coordsLine}`;
}

function getNoOrdersHtml() {
    return `
        <div style="text-align: center; padding: 60px 20px; display: flex; flex-direction: column; align-items: center;">
            <svg style="width: 80px; height: 80px; stroke: #cbd5e1; fill: none; margin-bottom: 16px;" viewBox="0 0 24 24" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="12" y2="12"></line></svg>
            <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0;">No New Requests</h3>
            <p style="color: #6b7280; font-size: 15px; margin: 0;">Finding deliveries nearby...</p>
        </div>`;
}

function getPendingCardHtml(order) {
    const itemFunds = order.itemFunds ? parseFloat(order.itemFunds) : 0;

    const fundsHtml = itemFunds > 0 ? `
        <div style="background: #fffbeb; color: #d97706; border: 1px solid #fcd34d; padding: 12px; border-radius: 12px; font-size: 13px; font-weight: 700; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                FUNDS FOR ITEMS
            </div>
            <span style="font-size: 18px;">M${itemFunds}</span>
        </div>` : '';

    const vehicleName = getVehicleName(order.vehicleType || order.vehicle);
    let extraInfo = `<div class="vehicle-badge" style="display: inline-block; background: #f3f4f6; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: #1f2937; margin-bottom: 12px;">${vehicleName}</div>`;

    if (order.desc && order.desc.trim() !== "") {
        extraInfo += `<div class="info-row" style="display: flex; gap: 8px; font-size: 13px;"><svg style="flex-shrink:0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> <span>${order.desc}</span></div>`;
    }

    return `
        <div class="order-card card">
            <div class="card-top">
                <div class="price">${order.displayFee}</div>
                <div class="status-pill ${env.isVIP ? 'status-vip' : 'status-new'}">${env.isVIP ? '⭐ PRIORITY' : 'NEW'}</div>
            </div>
            ${fundsHtml}
            <div class="timeline">
                <div class="t-line"></div>
                <div class="step"><div class="marker-pickup"></div><div class="label">PICKUP</div><div class="val">${order.storeName || order.pickup || 'N/A'}${order.storeLocation ? `<br><span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${order.storeLocation}</span>` : ''}</div></div>
                <div class="step"><div class="marker-dropoff"></div><div class="label">DROPOFF</div><div class="val">${formatDropoffDisplay(order)}</div></div>
            </div>
            <div class="info-box" style="background: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; margin-top: 15px;">${extraInfo}</div>
            <div class="btn-row" style="margin-top: 15px;">
                <button class="btn-outline" onclick="window._orderSys.decline('${order.id}')" style="background:#fef3c7; border-color:#f59e0b; color:#d97706; flex: 1;">Decline</button>
                <button class="btn-complete" onclick="window._orderSys.accept('${order.id}')" style="flex: 1; margin: 0;">Accept</button>
            </div>
        </div>
    `;
}

// -----------------------------------------------------------------------------
// Active card
// -----------------------------------------------------------------------------

export function renderActiveOrder(order) {
    const container = document.getElementById('active-container');
    if (!container) return;

    const logisticsCost = extractCost(order);
    const tip = order.tipAmount ? parseFloat(order.tipAmount) : 0;
    const adminCut = Math.ceil(logisticsCost * 0.01);
    const displayFee = "M" + (Math.floor(logisticsCost * 0.95) + tip - adminCut) + ` <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Earned</span>`;

    let dynamicStatusPill = `<div class="status-pill status-active">IN PROGRESS</div>`;
    if (order.status === "Paid" && order.kitchenDone) {
        dynamicStatusPill = `<div class="status-pill" style="background: var(--success); color: white;">FOOD READY FOR PICKUP</div>`;
    }

    const itemFunds = order.itemFunds ? parseFloat(order.itemFunds) : 0;
    const fundsHtml = itemFunds > 0 ? `
        <div style="background: var(--primary-light); color: var(--primary-hover); border: 1px solid rgba(232, 93, 33, 0.3); padding: 12px; border-radius: 8px; font-size: 13px; font-weight: 700; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
                FUNDS FOR ITEMS
            </div>
            <span style="font-size: 16px;">M${itemFunds}</span>
        </div>` : '';

    const vehicleName = getVehicleName(order.vehicleType || order.vehicle);
    let extraInfo = `<span style="background: var(--dark); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; display: inline-block; margin-bottom: 12px;">${vehicleName}</span>`;

    if (order.items && order.items.length > 0) {
        const itemsText = order.items.map(formatItemForDriver).join(' • ');
        extraInfo += `<div class="info-row"><svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path></svg> <span><strong style="color: var(--dark);">Order:</strong> ${itemsText}</span></div>`;
    }
    if (order.desc && order.desc.trim() !== "") {
        extraInfo += `<div class="info-row"><svg class="svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> <span>${order.desc}</span></div>`;
    }

    if (order.voiceNote && order.voiceNote !== "") {
        extraInfo += `
        <div class="info-row" style="margin-top: 15px; flex-direction: column; align-items: flex-start; gap: 8px;">
            <div style="font-size: 11px; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 6px;">
                <svg class="svg-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                CUSTOMER VOICE NOTE
            </div>
            <audio controls src="${order.voiceNote}" type="audio/webm" preload="auto" style="width: 100%; height: 45px; z-index: 10; position: relative;"></audio>
        </div>`;
    }

    const mapLink = buildMapLink(order);

    container.innerHTML = `
        <div class="card order-card">
            <div class="card-top">
                <div class="price">${displayFee}</div>
                ${dynamicStatusPill}
            </div>
            ${fundsHtml}
            <div class="timeline">
                <div class="t-line"></div>
                <div class="step"><div class="marker-pickup"></div><div class="label">PICKUP</div><div class="val">${order.storeName || order.pickup || 'N/A'}${order.storeLocation ? `<br><span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${order.storeLocation}</span>` : ''}</div></div>
                <div class="step"><div class="marker-dropoff"></div><div class="label">DROPOFF</div><div class="val">${formatDropoffDisplay(order)}</div></div>
            </div>
            <div class="info-box">${extraInfo}</div>
            <div class="btn-row">
                <a href="${mapLink}" target="_blank" class="btn-outline"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg> Navigate</a>
                <button class="btn-outline" onclick="window._orderSys.openChat('${order.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg> Contact</button>
            </div>
            <button class="btn-complete" onclick="window._orderSys.complete('${order.id}')">Complete Delivery (Requires PIN)</button>
        </div>`;
}

export function getEmptyActiveHtml() {
    return `
        <div class="empty-placeholder">
            <svg width="32" height="32" fill="none" stroke="var(--text-muted)" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom: 8px;"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <p class="empty-placeholder-title">No Active Deliveries</p>
            <p class="empty-placeholder-sub">You are currently available for new requests.</p>
        </div>`;
}

function extractCost(order) {
    if (order.deliveryFee !== undefined && order.deliveryFee !== null && order.deliveryFee !== "") {
        return parseFloat(String(order.deliveryFee).replace(/[^\d.]/g, '')) || 0;
    }
    if (order.baseDeliveryFee !== undefined && order.baseDeliveryFee !== null && order.baseDeliveryFee !== "") {
        return parseFloat(String(order.baseDeliveryFee).replace(/[^\d.]/g, '')) || 0;
    }
    return 0;
}
