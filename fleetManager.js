/**
 * fleetManager.js
 * Manages driver tags, local storage, and custom branding UI.
 */
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export function getFleetTag() {
    return localStorage.getItem('bofelo_driver_tag') || "General";
}

async function applyDriverBranding(db) {
    const fleetName = getFleetTag();
    const brandBox = document.getElementById('driver-brand-box');
    if (!brandBox) return;

    if (fleetName === "General") {
        brandBox.innerHTML = `<h1 style="font-size: 18px; margin: 0; font-weight: 800; color: #111827;">Bofelo Driver</h1>`;
        return;
    }
    
    try {
        const brandDoc = await getDoc(doc(db, "tags", fleetName));
        if (brandDoc.exists()) {
            const data = brandDoc.data();
            if (data.logoUrl && data.isPremium) {
                brandBox.innerHTML = `<img src="${data.logoUrl}" style="height: 30px; width: auto; border-radius:4px;" alt="${data.displayName}">`;
            } else {
                brandBox.innerHTML = `<h1 style="font-size: 18px; margin: 0; font-weight: 800; color: var(--mint);">${data.displayName} Driver</h1>`;
            }
        } else {
            localStorage.removeItem('bofelo_driver_tag');
            if (document.getElementById('driver-tag-input')) {
                document.getElementById('driver-tag-input').value = "";
            }
            brandBox.innerHTML = `<h1 style="font-size: 18px; margin: 0; font-weight: 800; color: #111827;">Bofelo Driver</h1>`;
        }
    } catch(e) { 
        console.warn("Could not load branding", e); 
    }
}

// 🚨 NEW: Self-contained setup engine
export function setupFleetManager(db) {
    document.addEventListener("DOMContentLoaded", () => {
        const currentTag = getFleetTag();
        if (currentTag !== "General") {
            const tagInputEl = document.getElementById('driver-tag-input');
            if (tagInputEl) tagInputEl.value = currentTag;
        }
        applyDriverBranding(db);
    });

    window.applyDriverTag = async () => {
        const tagInput = document.getElementById('driver-tag-input')?.value?.trim();
        if (!tagInput) {
            localStorage.setItem('bofelo_driver_tag', "General");
            await applyDriverBranding(db);
            if (window.showToast) window.showToast("Reverted to General Fleet.");
            setTimeout(() => window.location.reload(), 1500); 
            return;
        }

        localStorage.setItem('bofelo_driver_tag', tagInput);
        if (window.showToast) window.showToast("Applying Fleet Tag...");
        await applyDriverBranding(db);
        if (window.showToast) window.showToast("Store connected! Reloading feed...");
        setTimeout(() => window.location.reload(), 1500); 
    };
}
