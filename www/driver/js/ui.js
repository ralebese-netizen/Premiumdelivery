// driver/js/ui.js
// Shared UI helpers: toast, screen visibility, banner visibility.

export function showToast(message) {
    const toast = document.getElementById("custom-toast");
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

export function showScreen(id, displayMode = 'block') {
    const el = document.getElementById(id);
    if (el) {
        // 🟢 Force the display with !important so the browser cannot ignore it
        el.style.setProperty('display', displayMode, 'important');
    }
}

export function hideScreen(id) {
    const el = document.getElementById(id);
    if (el) {
        // 🟢 Force hide with !important to instantly kill the flash on refresh
        el.style.setProperty('display', 'none', 'important');
    }
}

export function showBanner(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.setProperty('display', 'block', 'important');
    }
}

export function hideBanner(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.setProperty('display', 'none', 'important');
    }
}
