/**
 * pbxManager.js
 * Specialized module for triggering secure cellular bridge calls via AWS Lambda.
 */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 🚨 SECURE PROXY: Your AWS Gateway URL
const LAMBDA_URL = "https://vvwtvhcl8f.execute-api.eu-north-1.amazonaws.com/default/bofelo-telephony-api";

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
    `;
    
    pbxBtn.onclick = async () => {
        await triggerCellularCall(db, orderId, driverId);
    };

    container.appendChild(pbxBtn);
}

/**
 * 2. CORE PBX CELLULAR LOGIC (Routed via Lambda)
 */
export async function triggerCellularCall(db, orderId, driverId) {
    if (!orderId || !driverId) {
        if (window.showToast) window.showToast("Missing order or driver data.");
        return;
    }

    try {
        if (window.showToast) window.showToast("Requesting secure cellular bridge...");

        // A. Fetch Customer Phone from the Order
        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (!orderSnap.exists()) throw new Error("Order not found.");
        const customerPhone = orderSnap.data().phone;
        
        // B. Fetch Driver Phone from the Profile
        const driverSnap = await getDoc(doc(db, "drivers", driverId));
        if (!driverSnap.exists()) throw new Error("Driver profile not found.");
        const driverPhone = driverSnap.data().phoneNumber;

        if (!customerPhone || !driverPhone) {
            throw new Error("Phone numbers missing in records.");
        }

        // C. Fire Request to Lambda Proxy
        // We no longer handle API keys here. Lambda handles them securely.
        const response = await fetch(LAMBDA_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                driverPhone: driverPhone,
                customerPhone: customerPhone
            })
        });

        const result = await response.json();

        if (response.ok) {
            if (window.showToast) window.showToast("Call initiated! Your phone will ring shortly.");
        } else {
            console.error("Telecom Gateway Error:", result);
            if (window.showToast) window.showToast("Telephony gateway is busy. Try again.");
        }

    } catch (error) {
        console.error("PBX Logic Error: ", error);
        if (window.showToast) window.showToast("Could not connect to cellular bridge.");
    }
}
