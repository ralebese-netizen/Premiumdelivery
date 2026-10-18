// chatManager/renderer.js
// All DOM rendering: chat bubble creation, sorted insertion, UI skeleton injection.
//
// 🔒 Fix #23 — voice-note player listener cleanup.
//
// wireVoiceNotePlayer previously attached five listeners (loadedmetadata,
// timeupdate, ended on the <audio>; click on playBtn; click on the progress
// bar) and never removed them. In a long driver session, every rendered
// voice-note bubble leaked its listeners. The timeupdate handler alone fires
// 4×/second per playing element, and nothing stopped it after the bubble
// was replaced or scrolled out of view.
//
// Fix: collect the listeners in a small cleanup registry stored on the
// bubble itself, and remove them all when the bubble leaves the DOM. A
// single MutationObserver per chat box handles the removal detection,
// so no other module needs to know about this.

import { DOM_IDS } from "./constants.js";
import { linkify, formatTime, deriveSortKey } from "./utils.js";

// --- LOCATION PIN (professional map-pin bubble) ---
const LOCATION_PIN_GRADIENT = { top: '#34D399', bottom: '#059669' };

const LOCATION_BUBBLE_STYLES = {
    link:     `text-decoration: none; display: block;`,
    row:      `display:flex; align-items:center; gap:12px; background: rgba(0,0,0,0.2); padding: 10px 12px; border-radius: 8px; margin-top: 2px; min-width: 200px;`,
    iconWrap: `flex-shrink: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35));`,
    textCol:  `overflow: hidden; flex: 1;`,
    title:    `color: #e9edef; font-weight: 600; font-size: 14px;`,
    subtitle: `font-size: 12px; color: #53bdeb; margin-top: 2px;`,
};

function buildLocationBubble(msg, timeHtml) {
    const gradId = `locPin-${msg.messageId || msg.id}`;

    const pinSvg = `
        <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%"   stop-color="${LOCATION_PIN_GRADIENT.top}"/>
                    <stop offset="100%" stop-color="${LOCATION_PIN_GRADIENT.bottom}"/>
                </linearGradient>
            </defs>
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                  fill="url(#${gradId})"/>
            <circle cx="12" cy="9" r="2.6" fill="#FFFFFF"/>
        </svg>`;

    return `
        <a href="${msg.mediaUrl}" target="_blank" rel="noopener" style="${LOCATION_BUBBLE_STYLES.link}">
            <div style="${LOCATION_BUBBLE_STYLES.row}">
                <div style="${LOCATION_BUBBLE_STYLES.iconWrap}">${pinSvg}</div>
                <div style="${LOCATION_BUBBLE_STYLES.textCol}">
                    <div style="${LOCATION_BUBBLE_STYLES.title}">Location Pin</div>
                    <div style="${LOCATION_BUBBLE_STYLES.subtitle}">Tap to open in Maps</div>
                </div>
            </div>
        </a>
        ${timeHtml}`;
}

// --- VOICE NOTE CLEANUP REGISTRY ---
// One MutationObserver per chat box, watching for removed .chat-msg nodes.
// When a bubble is removed, its registered cleanup functions run.
const _cleanupObservers = new WeakMap();   // chatBox → MutationObserver

function ensureCleanupObserver(chatBox) {
    if (_cleanupObservers.has(chatBox)) return;

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const removed of m.removedNodes) {
                if (removed.nodeType !== 1) continue;   // element nodes only
                // The removed node might itself be a .chat-msg, or contain them.
                const bubbles = [];
                if (removed.classList?.contains('chat-msg')) {
                    bubbles.push(removed);
                } else if (removed.querySelectorAll) {
                    bubbles.push(...removed.querySelectorAll('.chat-msg'));
                }
                for (const b of bubbles) {
                    if (typeof b.__cleanupVoiceNote === 'function') {
                        try { b.__cleanupVoiceNote(); }
                        catch (e) { console.warn('[chatManager] voice note cleanup failed:', e); }
                    }
                }
            }
        }
    });

    observer.observe(chatBox, { childList: true, subtree: true });
    _cleanupObservers.set(chatBox, observer);
}

// --- CHAT BUBBLE (SORTED INSERTION) ---
export function appendMessageToUI(msg, currentUserRole = 'driver') {
    const chatBox = document.getElementById(DOM_IDS.CHAT_BOX);
    if (!chatBox || !msg) return;

    ensureCleanupObserver(chatBox);

    const msgId = msg.messageId || msg.id;
    if (!msgId) {
        console.warn("[chatManager] Skipping message with no id:", msg);
        return;
    }
    if (document.getElementById(`msg-${msgId}`)) return; // already rendered

    const sortKey = deriveSortKey(msg);

    const div = document.createElement('div');
    div.id = `msg-${msgId}`;
    div.dataset.sortKey = String(sortKey);
    div.className = `chat-msg`;

    const isMe = (msg.sender === currentUserRole);
    const bubbleBg = isMe ? '#005c4b' : '#202c33';
    const borderRadius = isMe ? '8px 0px 8px 8px' : '0px 8px 8px 8px';

    div.style.cssText = `background-color: ${bubbleBg}; color: #e9edef; align-self: ${isMe ? 'flex-end' : 'flex-start'}; border-radius: ${borderRadius}; padding: 6px 7px 8px 9px; font-size: 14.2px; line-height: 19px; max-width: 85%; margin-bottom: 4px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); position: relative; font-family: 'Inter', -apple-system, sans-serif;`;

    const readTicks = isMe
        ? `<svg viewBox="0 0 16 15" width="16" height="15" style="margin-left: 4px; fill: #53bdeb;"><path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"></path></svg>`
        : '';

    const channelBadge = msg.channel === 'whatsapp'
        ? `<span style="font-size:10px; color:#25D366; font-weight:700; margin-right:5px; background: rgba(37, 211, 102, 0.15); padding: 1px 4px; border-radius: 4px;">WA</span>`
        : '';

    // Prefer clientTime (raw number set at send time) over Firestore serverTimestamp()
    const displayTs = msg.clientTime || msg.timestamp || Date.now();
    const timeHtml = `<span style="float: right; font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 8px; margin-left: 10px; display: flex; align-items: center; line-height: 11px;">${channelBadge}${formatTime(displayTs)} ${readTicks}</span><div style="clear: both;"></div>`;

    if (msg.type === 'text' || !msg.type) {
        div.innerHTML = `<span style="word-wrap: break-word;">${linkify(msg.text || '').replace(/\n/g, '<br>')}</span>${timeHtml}`;
    } else if (msg.type === 'image') {
        div.innerHTML = `<div style="padding: 2px;"><img src="${msg.mediaUrl}" style="max-width: 100%; border-radius: 6px; cursor:zoom-in; object-fit: cover; display: block;" onclick="window.open('${msg.mediaUrl}', '_blank')" loading="lazy"></div>${timeHtml}`;
    } else if (msg.type === 'audio') {
        // 🟢 Slim custom voice-note player
        const audioId = `audio-${msgId}`;
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; padding: 4px 8px 4px 0; min-width: 190px; max-width: 240px;">
                <button type="button" class="chat-audio-play" data-target="${audioId}" aria-label="Play voice note">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path class="play-icon" d="M8 5v14l11-7z"/>
                        <path class="pause-icon" d="M6 4h4v16H6zM14 4h4v16h-4z" style="display:none;"/>
                    </svg>
                </button>
                <div style="flex:1; display:flex; flex-direction:column; gap:4px; min-width: 100px;">
                    <div class="chat-audio-bar" style="position:relative; height:4px; background:rgba(255,255,255,0.25); border-radius:2px; cursor:pointer;">
                        <div class="chat-audio-progress" style="position:absolute; top:0; left:0; height:100%; width:0%; background:#53bdeb; border-radius:2px; transition: width 0.1s linear;"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:10px; color:rgba(255,255,255,0.65); font-weight:600;">
                        <span class="chat-audio-current">0:00</span>
                        <span class="chat-audio-duration">0:00</span>
                    </div>
                </div>
                <audio id="${audioId}" src="${msg.mediaUrl}" preload="metadata" style="display:none;"></audio>
            </div>
            ${timeHtml}
        `;

        // Wire up the custom player after the bubble is inserted into the DOM.
        // wireVoiceNotePlayer registers a cleanup function on the bubble so
        // the MutationObserver can tear the listeners down when the bubble
        // is removed.
        setTimeout(() => wireVoiceNotePlayer(div, audioId), 0);
   } else if (msg.type === 'location') {
    div.innerHTML = buildLocationBubble(msg, timeHtml);
    
    } else if (msg.type === 'document') {
        div.innerHTML = `<a href="${msg.mediaUrl}" target="_blank" download="${msg.fileName || 'Document'}" style="text-decoration: none;"><div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-top: 2px;"><div style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: white;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></div><div style="overflow: hidden;"><div style="color: #e9edef; font-weight: 500; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; max-width: 150px;">${msg.fileName || 'Document'}</div><div style="font-size: 12px; color: #53bdeb; margin-top: 2px;">Tap to view/download</div></div></div></a>${timeHtml}`;
    }

    // SORTED INSERTION — display order = send order, not arrival order
    let inserted = false;
    const existingBubbles = chatBox.querySelectorAll('.chat-msg');
    for (const el of existingBubbles) {
        const elKey = Number(el.dataset.sortKey || 0);
        if (sortKey < elKey) {
            chatBox.insertBefore(div, el);
            inserted = true;
            break;
        }
    }
    if (!inserted) chatBox.appendChild(div);

    // Only auto-scroll if the user is near the bottom
    const nearBottom = chatBox.scrollHeight - chatBox.scrollTop - chatBox.clientHeight < 80;
    if (nearBottom) {
        chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
    }
}

// --- VOICE NOTE PLAYER WIRING ---
// Registers a `__cleanupVoiceNote` function on the bubble. Called by the
// MutationObserver in ensureCleanupObserver when the bubble leaves the DOM.
function wireVoiceNotePlayer(bubble, audioId) {
    const audio = document.getElementById(audioId);
    if (!audio) return;

    const playBtn = bubble.querySelector('.chat-audio-play');
    const bar = bubble.querySelector('.chat-audio-bar');
    const prog = bubble.querySelector('.chat-audio-progress');
    const cur = bubble.querySelector('.chat-audio-current');
    const dur = bubble.querySelector('.chat-audio-duration');
    const playIcon = bubble.querySelector('.play-icon');
    const pauseIcon = bubble.querySelector('.pause-icon');

    if (!playBtn || !bar || !prog || !cur || !dur) return;

    const fmt = (s) => {
        if (!isFinite(s) || s < 0) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${String(sec).padStart(2, '0')}`;
    };

    // Named handlers so they can be removed by the same reference.
    const onLoadedMetadata = () => {
        dur.textContent = fmt(audio.duration);
    };

    const onTimeUpdate = () => {
        if (audio.duration && isFinite(audio.duration)) {
            prog.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
            cur.textContent = fmt(audio.currentTime);
        }
    };

    const onEnded = () => {
        playIcon.style.display = '';
        pauseIcon.style.display = 'none';
        prog.style.width = '0%';
        cur.textContent = '0:00';
    };

    const onPlayClick = () => {
        // Pause every other voice note in the chat before playing this one
        document.querySelectorAll('#chat-box audio').forEach(a => {
            if (a !== audio) {
                a.pause();
                // Reset its icon/progress
                const parentBubble = a.closest('.chat-msg');
                if (parentBubble) {
                    const pi = parentBubble.querySelector('.play-icon');
                    const pai = parentBubble.querySelector('.pause-icon');
                    const pb = parentBubble.querySelector('.chat-audio-progress');
                    const pc = parentBubble.querySelector('.chat-audio-current');
                    if (pi) pi.style.display = '';
                    if (pai) pai.style.display = 'none';
                    if (pb) pb.style.width = '0%';
                    if (pc) pc.textContent = '0:00';
                }
            }
        });

        if (audio.paused) {
            audio.play().catch(e => console.warn('[Chat] Audio play failed:', e));
            playIcon.style.display = 'none';
            pauseIcon.style.display = '';
        } else {
            audio.pause();
            playIcon.style.display = '';
            pauseIcon.style.display = 'none';
        }
    };

    const onBarClick = (e) => {
        const rect = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (audio.duration && isFinite(audio.duration)) {
            audio.currentTime = pct * audio.duration;
        }
    };

    // Attach
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    playBtn.addEventListener('click', onPlayClick);
    bar.addEventListener('click', onBarClick);

    // 🔒 Fix #23 — register the cleanup function on the bubble itself.
    // The MutationObserver created in ensureCleanupObserver calls this
    // when the bubble is removed from the DOM.
    bubble.__cleanupVoiceNote = () => {
        try { audio.pause(); } catch { /* ignore */ }
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('ended', onEnded);
        playBtn.removeEventListener('click', onPlayClick);
        bar.removeEventListener('click', onBarClick);
        // Release the media resource so the browser stops fetching it.
        try { audio.src = ''; audio.load(); } catch { /* ignore */ }
        bubble.__cleanupVoiceNote = null;
    };
}

// --- UI SKELETON INJECTION ---
export function buildChatUI(containerId, customerPhone = "") {
    const container = document.getElementById(containerId);
    if (!container) return false;

    const existingBox = document.getElementById(DOM_IDS.CHAT_BOX);
    if (existingBox && container.contains(existingBox)) return true;

    injectStyles();
    container.innerHTML = getChatHTML();
    return true;
}

function injectStyles() {
    if (document.getElementById('chat-module-styles')) return;

    const style = document.createElement('style');
    style.id = 'chat-module-styles';
    style.innerHTML = `
        .chat-mic-recording { color: #ef4444 !important; animation: pulse-red-icon 1.5s infinite; }
        @keyframes pulse-red-icon { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
        .attach-menu-item:hover { background: #1f2937 !important; color: #ffffff !important; }
        .chat-msg audio::-webkit-media-controls-panel { background-color: #f0f2f5; }
        .mode-toggle-container { display: flex; background: #111827; padding: 3px; border-radius: 8px; border: 1px solid #374151; margin-bottom: 8px; gap: 4px; }
        .mode-toggle-btn { flex: 1; padding: 5px 10px; height: 32px; border: none; border-radius: 6px; background: transparent; color: #9ca3af; font-weight: 600; cursor: pointer; font-size: 12px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: 'Inter', sans-serif; }
        .mode-toggle-btn:hover:not(.chat-mode-app-active):not(.chat-mode-wa-active) { color: #d1d5db; background: rgba(255, 255, 255, 0.04); }
        .chat-mode-app-active { background: #e85d21 !important; color: #ffffff !important; font-weight: 700 !important; box-shadow: 0 1px 6px rgba(232, 93, 33, 0.3); }
        .chat-mode-wa-active { background: #25D366 !important; color: #052e16 !important; font-weight: 700 !important; box-shadow: 0 1px 6px rgba(37, 211, 102, 0.3); }

        /* 🟢 Slim custom voice-note player */
        .chat-audio-play {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.15);
            border: none;
            color: #53bdeb;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            transition: transform 0.1s ease, background 0.15s ease;
            padding: 0;
        }
        .chat-audio-play:hover { background: rgba(255, 255, 255, 0.25); }
        .chat-audio-play:active { transform: scale(0.92); }
        .chat-audio-bar:hover { height: 5px !important; }
    `;
    document.head.appendChild(style);
}

function getChatHTML() {
    return `
        <div class="mode-toggle-container">
            <button id="${DOM_IDS.MODE_APP_BTN}" class="mode-toggle-btn chat-mode-app-active">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                App Chat
            </button>
            <button id="${DOM_IDS.MODE_WA_BTN}" class="mode-toggle-btn">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
                WhatsApp
            </button>
        </div>

        <div id="${DOM_IDS.CHAT_BOX}" style="height: 310px; overflow-y: auto; background: #0b141a; padding: 12px; border-radius: 12px; border: 1px solid #1f2937; display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;"></div>
        <div id="${DOM_IDS.UPLOAD_STATUS}" style="font-size: 11px; color: #e85d21; text-align: center; display: none; margin-bottom: 6px; font-weight: 600;">Uploading...</div>

        <div style="position: relative;">
            <div id="${DOM_IDS.ATTACH_MENU}" style="display: none; position: absolute; bottom: 60px; left: 0; background: #111827; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); border: 1px solid #374151; padding: 6px; z-index: 100; min-width: 190px;">
                <div id="${DOM_IDS.PHOTO_BTN}" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; border-radius: 8px; transition: all 0.2s;">
                    <div style="background: rgba(232, 93, 33, 0.15); width: 34px; height: 34px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: #e85d21;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    </div>
                    <span style="font-size: 13.5px; font-weight: 600; color: #e5e7eb;">Photo / Gallery</span>
                </div>
                <div id="${DOM_IDS.DOC_BTN}" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; border-radius: 8px; transition: all 0.2s;">
                    <div style="background: rgba(139, 92, 246, 0.15); width: 34px; height: 34px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: #8b5cf6;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    </div>
                    <span style="font-size: 13.5px; font-weight: 600; color: #e5e7eb;">Document</span>
                </div>
                <div id="${DOM_IDS.LOCATION_BTN}" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; cursor: pointer; border-radius: 8px; transition: all 0.2s;">
                    <div style="background: rgba(16, 185, 129, 0.15); width: 34px; height: 34px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: #10b981;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    </div>
                    <span style="font-size: 13.5px; font-weight: 600; color: #e5e7eb;">Live Location</span>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; background: #111827; padding: 8px; border-radius: 12px; border: 1px solid #374151;">
                <input type="file" id="${DOM_IDS.IMAGE_INPUT}" style="display: none;" accept="image/*">
                <input type="file" id="${DOM_IDS.FILE_INPUT}" style="display: none;" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip">

                <button id="${DOM_IDS.ATTACH_BTN}" style="background: none; border: none; cursor: pointer; color: #9ca3af; padding: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="Attach File">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg);"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </button>

                <button id="${DOM_IDS.MIC_BTN}" style="background: none; border: none; cursor: pointer; color: #9ca3af; padding: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="Voice Note">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </button>

                <input type="text" id="${DOM_IDS.INPUT}" placeholder="Message via App..." style="margin-bottom: 0; flex: 1; min-width: 0; border: none; background: #1f2937; color: #f9fafb; border-radius: 20px; padding: 9px 15px; outline: none; font-family: 'Inter', sans-serif; font-size: 13.5px;">

                <button id="${DOM_IDS.SEND_BTN}" style="background: #e85d21; color: white; border: none; border-radius: 50%; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.15s ease;" title="Send Message">
                    <svg style="width: 15px; height: 15px; fill: white;" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                </button>
            </div>
        </div>
    `;
}
