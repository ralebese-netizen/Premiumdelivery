// chatManager.js
// Barrel — re-exports from the chatManager/ folder so existing imports keep working.
// pbx.html can stay unchanged: `import { setupChatSystem, stopChatListener } from './chatManager.js';`

export { setupChatSystem, stopChatListener } from './chatManager/index.js';
