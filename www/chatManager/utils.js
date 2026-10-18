// chatManager/utils.js
// Pure helpers — no DOM, no state, no side effects.

export function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

export function linkify(text) {
    const sanitizedText = escapeHTML(text);
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return sanitizedText.replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #53bdeb; text-decoration: underline; word-break: break-all;">${url}</a>`;
    });
}

export function formatTime(timestamp) {
    if (!timestamp) return '...';
    const date = timestamp.toDate
        ? timestamp.toDate()
        : new Date(typeof timestamp === 'string' && !isNaN(timestamp) ? Number(timestamp) : timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function cleanPhoneNumber(phone) {
    if (!phone) return "";
    let cleaned = phone.toString().replace(/\D/g, '');
    if (cleaned.length === 8) cleaned = "266" + cleaned;
    return cleaned;
}

// 🟢 Single source of truth for sort key — used by BOTH render paths and mirror.
export function deriveSortKey(msg) {
    if (!msg) return Date.now();

    const clientTime = msg.clientTime;
    if (typeof clientTime === 'number' && Number.isFinite(clientTime)) {
        return clientTime;
    }
    if (typeof clientTime === 'string' && clientTime && !isNaN(Number(clientTime))) {
        return Number(clientTime);
    }

    const ts = msg.timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) {
        return ts;
    }
    if (typeof ts === 'string' && ts && !isNaN(Number(ts))) {
        return Number(ts);
    }
    if (ts && typeof ts.toMillis === 'function') {
        return ts.toMillis();
    }
    if (ts && typeof ts.toDate === 'function') {
        return ts.toDate().getTime();
    }

    return Date.now();
}

export function generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}
