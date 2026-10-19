// driver/js/pwa.js
// Service worker registration + install prompt handling.

let swRegistrationPromise = null;

export function initPWA() {
    // 🟢 sw.js lives at the ROOT of sadriver/ (same folder as pbx.html).
    //    We cache the registration promise on window so other modules
    //    (notificationManager, auth-flow) can await it before calling
    //    getToken() — this is what closes the FCM token race condition.
    if ('serviceWorker' in navigator) {
        swRegistrationPromise = navigator.serviceWorker.register('./sw.js')
            .then((reg) => {
                console.log('[PWA] SW registered:', reg.scope);

                // If an older worker is waiting, activate it now
                if (reg.waiting) {
                    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
                return reg;
            })
            .catch((err) => {
                console.error('[PWA] SW registration FAILED:', err);
                return null;
            });

        // Expose so notificationManager.js / auth-flow.js can await it
        window.__swRegistrationPromise = swRegistrationPromise;
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
