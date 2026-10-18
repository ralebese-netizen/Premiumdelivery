import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { showToast } from "./ui.js";
export let MY_FLEET_NAME = localStorage.getItem('bofelo_driver_tag') || "General";
export function initBranding() {
    const tagInputEl = document.getElementById('driver-tag-input');
    if (tagInputEl && MY_FLEET_NAME !== "General") tagInputEl.value = MY_FLEET_NAME;
    applyDriverBranding();
    const applyBtn = document.getElementById('apply-tag-btn');
    if (applyBtn) applyBtn.addEventListener('click', applyDriverTag);
}
export async function applyDriverBranding() {
    const brandBox = document.getElementById('driver-brand-box');
    if (!brandBox) return;
    if (MY_FLEET_NAME === "General") { brandBox.innerHTML = `<h1 style="font-size: 16px; margin: 0; font-weight: 800; color: var(--dark);">Bofelo Driver</h1>`; return; }
    try {
        const brandDoc = await getDoc(doc(db, "tags", MY_FLEET_NAME));
        if (brandDoc.exists() && brandDoc.data().logoUrl && brandDoc.data().isPremium) {
            brandBox.innerHTML = `<img src="${brandDoc.data().logoUrl}" style="height: 24px; width: auto; border-radius:4px;" alt="${brandDoc.data().displayName}">`;
        } else {
            const name = brandDoc.data()?.displayName || "Fleet";
            brandBox.innerHTML = `<h1 style="font-size: 16px; margin: 0; font-weight: 800; color: var(--primary);">${name} Driver</h1>`;
        }
    } catch (e) { console.warn("[Branding] Load failed:", e); }
}
export function applyDriverTag() {
    const tagInput = document.getElementById('driver-tag-input').value.trim();
    MY_FLEET_NAME = tagInput || "General";
    localStorage.setItem('bofelo_driver_tag', MY_FLEET_NAME);
    showToast(tagInput ? "Store connected! Reloading feed..." : "Reverted to General Fleet.");
    setTimeout(() => window.location.reload(), 1500);
}
export function getFleetName() { return MY_FLEET_NAME; }
