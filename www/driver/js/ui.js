export function showToast(message) { const toast = document.getElementById("custom-toast"); if (!toast) return; toast.innerText = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3000); }
export function showScreen(id, displayMode = 'block') { const el = document.getElementById(id); if (el) el.style.setProperty('display', displayMode, 'important'); }
export function hideScreen(id) { const el = document.getElementById(id); if (el) el.style.setProperty('display', 'none', 'important'); }
export function showBanner(id) { const el = document.getElementById(id); if (el) el.style.setProperty('display', 'block', 'important'); }
export function hideBanner(id) { const el = document.getElementById(id); if (el) el.style.setProperty('display', 'none', 'important'); }
