// chatManager/constants.js
// All magic strings, URLs, and configuration in one place.

export const WS_URL = "wss://kgzxrbaqa0.execute-api.eu-north-1.amazonaws.com/production/";

export const WS_RECONNECT_DELAY_MS = 3000;
export const ATTACH_MAX_ATTEMPTS = 20;
export const ATTACH_RETRY_DELAY_MS = 100;

export const DOM_IDS = {
    CHAT_BOX: 'chat-box',
    UPLOAD_STATUS: 'chat-upload-status',
    ATTACH_BTN: 'chat-attach-btn',
    ATTACH_MENU: 'attach-menu',
    PHOTO_BTN: 'menu-photo-btn',
    DOC_BTN: 'menu-doc-btn',
    LOCATION_BTN: 'menu-location-btn',
    IMAGE_INPUT: 'chat-image-input',
    FILE_INPUT: 'chat-file-input',
    SEND_BTN: 'send-msg-btn',
    INPUT: 'chat-input',
    MIC_BTN: 'chat-mic-btn',
    MODE_APP_BTN: 'mode-app-btn',
    MODE_WA_BTN: 'mode-wa-btn'
};

export const CHAT_MODES = {
    APP: 'app',
    WHATSAPP: 'whatsapp'
};

export const MAX_DOC_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
