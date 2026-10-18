// driver/js/pwa.js
// Service worker registration + install prompt handling.

export function initPWA() {
    // 🟢 sw.js lives at the ROOT of sadriver/ (same folder as pbx.html).
    //    Paths passed to register() resolve against the DOCUMENT URL, not this
    //    script's URL — so from pbx.html, './sw.js' → sadriver/sw.js ✅
    if ('serviceWorker' in navigator) {
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
