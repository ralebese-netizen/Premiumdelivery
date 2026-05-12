/**
 * pwaManager.js
 * Handles the Progressive Web App (PWA) installation prompts.
 */
export function setupPWAInstaller() {
    let deferredPrompt;
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
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Driver responded to prompt with: ${outcome}`);
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });

    window.addEventListener('appinstalled', () => {
        installBtn.style.display = 'none';
        deferredPrompt = null;
        console.log('PWA was successfully installed.');
    });
}

