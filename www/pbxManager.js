/**
 * pbxManager.js
 * Specialized module for triggering secure cellular bridge calls via AWS Lambda.
 */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// SECURE PROXY: Active AWS Gateway URL
const LAMBDA_URL = "https://spxkdd1to6.execute-api.eu-north-1.amazonaws.com/default/bofelo-telephony-api";

// 🟢 ADDED: in-flight lock — prevents multiple parallel bridge requests
let pbxInFlight = false;

/**
 * 1. INJECT PBX BUTTON DYNAMICALLY
 * @param {string} containerId - The ID of the div where the button lands.
 * @param {object} db - Firestore instance.
 * @param {string} orderId - Current active order.
 * @param {string} driverId - Current logged-in driver.
 */
export function setupPBXButton(containerId, db, orderId, driverId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear container to prevent duplicate buttons if modal re-opens
    container.innerHTML = ''; 

    const pbxBtn = document.createElement('button');
    pbxBtn.innerHTML = '📞';
    pbxBtn.title = "Direct Cellular Call";
    
    // Style matches the Green PBX aesthetic
    pbxBtn.style.cssText = `
        background: #25D366; 
        color: white; 
        border: none; 
        border-radius: 50%; 
        width: 36px; 
        height: 36px; 
        cursor: pointer; 
        box-shadow: 0 4px 10px rgba(37, 211, 102, 0.3); 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        font-size: 16px;
        transition: transform 0.2s;
    `;
    
    pbxBtn.onmousedown = () => pbxBtn.style.transform = 'scale(0.9)';
    pbxBtn.onmouseup = () => pbxBtn.style.transform = 'scale(1)';

    pbxBtn.onclick = async () => {
        await triggerCellularCall(db, orderId, driverId);
    };

    container.appendChild(pbxBtn);
}

/**
 * 2. CORE PBX CELLULAR LOGIC (Formatted for Exact Lambda Event Reading)
 */
export async function triggerCellularCall(db, orderId, driverId) {
    // 🟢 ADDED: refuse if a call is already in flight
    if (pbxInFlight) {
        if (window.showToast) window.showToast("Call already in progress...");
        return;
    }

    if (!orderId || !driverId) {
        if (window.showToast) window.showToast("Missing order or driver data.");
        return;
    }

    // 🟢 ADDED: acquire the lock
    pbxInFlight = true;

    try {
        if (window.showToast) window.showToast("Requesting secure cellular bridge...");

        // A. Fetch Customer Phone directly from the primary 'phone' field
        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (!orderSnap.exists()) throw new Error("Order not found.");
        let rawCustomerPhone = orderSnap.data().phone;
        
        // B. Fetch Driver Phone from the Profile
        const driverSnap = await getDoc(doc(db, "drivers", driverId));
        if (!driverSnap.exists()) throw new Error("Driver profile not found.");
        let rawDriverPhone = driverSnap.data().phoneNumber;

        if (!rawCustomerPhone || !rawDriverPhone) {
            throw new Error("Phone numbers missing in records.");
        }

        // --- DATA NORMALIZATION FILTER ---
        const cleanNumber = (num) => {
            if (!num) return "";
            let digits = String(num).replace(/\D/g, ''); 
            if (digits.startsWith("266") && digits.length > 8) {
                return digits.substring(3); // Removes the 266 country prefix
            }
            return digits; // Leaves the local 8 digits alone
        };

        const customerPhone = cleanNumber(rawCustomerPhone);
        const driverPhone = cleanNumber(rawDriverPhone);
        // ----------------------------------

        // C. Nest the data structure to match what Lambda expects natively
        const innerDataString = JSON.stringify({
            customerPhone: customerPhone,
            driverPhone: driverPhone
        });

        const exactPayload = {
            body: innerDataString
        };

        // 🟢 ADDED: abort the fetch if the gateway hangs (10s timeout)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // D. Fire Request to the REST URL
        let response;
        try {
            response = await fetch(LAMBDA_URL, { 
                method: 'POST', 
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(exactPayload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        // E. Handle response payload
        const result = await response.json();

        if (response.ok) {
            if (window.showToast) window.showToast("Call initiated! Your phone will ring shortly.");
        } else {
            console.error("Telecom Gateway Error:", result);
            if (window.showToast) window.showToast("Telephony gateway is busy. Try again.");
        }

    } catch (error) {
        console.error("PBX Logic Error: ", error);
        // 🟢 ADDED: distinguish timeout from other errors
        if (error.name === 'AbortError') {
            if (window.showToast) window.showToast("Telephony gateway timed out. Try again.");
        } else {
            if (window.showToast) window.showToast("Could not connect to cellular bridge.");
        }
    } finally {
        // 🟢 ADDED: always release the lock
        pbxInFlight = false;
    }
}
