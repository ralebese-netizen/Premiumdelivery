// driver/js/pwa.js
// Service worker registration + install prompt handling.

export function initPWA() {
    // 🟢 STREAMLINED FOR CAPACITOR:
    // If we are inside the Android App (window.Capacitor exists), we completely
    // skip registering the Service Worker. The native app handles push notifications
    // and caching via Android, not the browser's Workbox.
    if ('serviceWorker' in navigator && !window.Capacitor) {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.warn("[PWA] Service worker registration failed:", err);
        });
    }

    // Install prompt
    let deferredPrompt = null;
    const installBtn = document.getElementById('installAppBtn');
    if (!installBtn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'block';
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
}
