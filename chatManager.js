// chatManager.js
// Enterprise-Grade Modular Chat Engine for Bofelo Delivery
// Fully injects its own UI and handles all logic internally.

import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

let chatUnsubscribe = null;
let chatMediaRecorder = null;
let chatAudioChunks = [];
let isRecording = false;

// --- UTILITIES ---
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, tag => ({ '&': '&', '<': '<', '>': '>', "'": '&#39;', '"': '&quot;' }[tag]));
}

function linkify(text) {
    const sanitizedText = escapeHTML(text);
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return sanitizedText.replace(urlRegex, function(url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #53bdeb; text-decoration: underline; word-break: break-all;">${url}</a>`;
    });
}

function formatTime(timestamp) {
    if (!timestamp) return '...'; 
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// --- UI INJECTION ---
function buildChatUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return false;
    
    if (document.getElementById('chat-box')) return true;

    if (!document.getElementById('chat-module-styles')) {
        const style = document.createElement('style');
        style.id = 'chat-module-styles';
        style.innerHTML = `
            .chat-mic-recording { color: #ef4444 !important; animation: pulse-red-icon 1.5s infinite; }
            @keyframes pulse-red-icon { 0% { transform: scale(1); } 50% { transform: scale(1.2); } 100% { transform: scale(1); } }
            .attach-menu-item:hover { background: #f9fafb; }
            .chat-msg audio::-webkit-media-controls-panel { background-color: #f0f2f5; }
        `;
        document.head.appendChild(style);
    }

    container.innerHTML = `
        <div id="chat-box" style="height: 300px; overflow-y: auto; background: #0b141a; padding: 15px; border-radius: 12px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;"></div>
        <div id="chat-upload-status" style="font-size: 11px; color: #e85d21; text-align: center; display: none; margin-bottom: 5px; font-weight: 600;">Uploading...</div>
        
        <div style="position: relative;">
            <div id="attach-menu" style="display: none; position: absolute; bottom: 60px; left: 0; background: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border: 1px solid #f3f4f6; padding: 5px; z-index: 100; min-width: 180px;">
                <div id="menu-photo-btn" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; cursor: pointer; border-bottom: 1px solid #f3f4f6; border-radius: 8px 8px 0 0;">
                    <div style="background: #e85d21; width: 36px; height: 36px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: white;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    </div>
                    <span style="font-size: 14px; font-weight: 600; color: #111827;">Photo / Gallery</span>
                </div>
                <div id="menu-doc-btn" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; cursor: pointer; border-bottom: 1px solid #f3f4f6;">
                    <div style="background: #8b5cf6; width: 36px; height: 36px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: white;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                    </div>
                    <span style="font-size: 14px; font-weight: 600; color: #111827;">Document</span>
                </div>
                <div id="menu-location-btn" class="attach-menu-item" style="display: flex; align-items: center; gap: 12px; padding: 12px; cursor: pointer; border-radius: 0 0 8px 8px;">
                    <div style="background: #10b981; width: 36px; height: 36px; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: white;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    </div>
                    <span style="font-size: 14px; font-weight: 600; color: #111827;">Live Location</span>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; background: #fff; padding: 10px; border-radius: 12px; border: 1px solid #f3f4f6;">
                <input type="file" id="chat-image-input" style="display: none;" accept="image/*">
                <input type="file" id="chat-file-input" style="display: none;" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip">
                
                <button id="chat-attach-btn" style="background: none; border: none; cursor: pointer; color: #6b7280; padding: 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="Attach">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg);"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </button>
                
                <button id="chat-mic-btn" style="background: none; border: none; cursor: pointer; color: #6b7280; padding: 5px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;" title="Voice Note">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </button>
                
                <input type="text" id="chat-input" placeholder="Message..." style="margin-bottom: 0; flex: 1; min-width: 0; border: none; background: #f0f2f5; border-radius: 20px; padding: 10px 15px; outline: none; font-family: 'Inter', sans-serif; font-size: 14px;">
                
                <button id="send-msg-btn" style="background: #111827; color: white; border: none; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0;" title="Send">
                    <svg style="width: 16px; height: 16px; fill: white;" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                </button>
            </div>
        </div>
    `;
    return true;
}

// --- CORE CHAT LOGIC ---
function startChatListener(db, orderId, currentUserRole) {
    const chatBox = document.getElementById('chat-box');
    if (!chatBox) return;

    if (chatUnsubscribe) chatUnsubscribe(); 

    const q = query(collection(db, "orders", orderId, "chat"), orderBy("timestamp", "asc"));
    
    chatUnsubscribe = onSnapshot(q, (snapshot) => {
        chatBox.innerHTML = '';
        
        snapshot.forEach((doc) => {
            const msg = doc.data();
            const div = document.createElement('div');
            const isMe = (msg.sender === currentUserRole);
            
            const bubbleBg = isMe ? '#005c4b' : '#202c33';
            const textColor = '#e9edef';
            const timeColor = 'rgba(255, 255, 255, 0.6)';
            const borderRadius = isMe ? '8px 0px 8px 8px' : '0px 8px 8px 8px';

            div.className = `chat-msg`;
            div.style.cssText = `background-color: ${bubbleBg}; color: ${textColor}; align-self: ${isMe ? 'flex-end' : 'flex-start'}; border-radius: ${borderRadius}; padding: 6px 7px 8px 9px; font-size: 14.2px; line-height: 19px; max-width: 85%; margin-bottom: 4px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); position: relative; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;`;
            
            const readTicks = isMe ? `<svg viewBox="0 0 16 15" width="16" height="15" style="margin-left: 4px; fill: #53bdeb;"><path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"></path></svg>` : '';
            const timeHtml = `<span style="float: right; font-size: 11px; color: ${timeColor}; margin-top: 10px; margin-left: 10px; display: flex; align-items: center; line-height: 11px;">${formatTime(msg.timestamp)} ${readTicks}</span><div style="clear: both;"></div>`;
            
            if (msg.type === 'text') {
                div.innerHTML = `<span style="word-wrap: break-word;">${linkify(msg.text).replace(/\n/g, '<br>')}</span>${timeHtml}`;
            } else if (msg.type === 'image') {
                div.innerHTML = `<div style="padding: 2px;"><img src="${msg.mediaUrl}" style="max-width: 100%; border-radius: 6px; cursor:zoom-in; object-fit: cover; display: block;" onclick="window.open('${msg.mediaUrl}', '_blank')" loading="lazy"></div>${timeHtml}`;
            } else if (msg.type === 'audio') {
                div.innerHTML = `<audio controls src="${msg.mediaUrl}" style="height: 40px; max-width: 220px; outline: none; filter: invert(100%); margin-top: 5px;"></audio>${timeHtml}`;
            } else if (msg.type === 'location') {
                div.innerHTML = `<a href="${msg.mediaUrl}" target="_blank" style="text-decoration: none;"><div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-top: 2px;"><div style="background: #00a884; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><span style="font-size:16px;">📍</span></div><div><div style="color: #e9edef; font-weight: 500; font-size: 14px;">Location</div><div style="font-size: 12px; color: #53bdeb; margin-top: 2px;">View on Maps</div></div></div></a>${timeHtml}`;
            } else if (msg.type === 'document') {
                // Renders a clickable document bubble with the filename
                div.innerHTML = `
                    <a href="${msg.mediaUrl}" target="_blank" download="${msg.fileName || 'Document'}" style="text-decoration: none;">
                        <div style="display:flex; align-items:center; gap:10px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; margin-top: 2px;">
                            <div style="background: #8b5cf6; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: white;">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                            </div>
                            <div style="overflow: hidden;">
                                <div style="color: #e9edef; font-weight: 500; font-size: 14px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; max-width: 150px;">${msg.fileName || 'Document'}</div>
                                <div style="font-size: 12px; color: #53bdeb; margin-top: 2px;">Tap to view/download</div>
                            </div>
                        </div>
                    </a>${timeHtml}`;
            }
            
            chatBox.appendChild(div);
        });
        chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: 'smooth' });
    });
}

export function stopChatListener() {
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
}

async function sendTextMessage(db, orderId, role, text) {
    if (!text.trim() || !orderId) return false;
    try {
        await addDoc(collection(db, "orders", orderId, "chat"), { type: 'text', text: text.trim(), sender: role, timestamp: serverTimestamp() });
        return true; 
    } catch (err) { return false; }
}

async function sendImageMessage(db, storage, orderId, role, file, statusEl) {
    if (!file || !orderId) return;
    if (!file.type.startsWith('image/')) { if(statusEl) { statusEl.style.display = 'block'; statusEl.innerText = 'Invalid image file.'; setTimeout(() => statusEl.style.display='none', 3000); } return; }
    if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#e85d21'; statusEl.innerText = 'Sending photo...'; }
    
    try {
        const storageRef = ref(storage, `chat_images/img_${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        await addDoc(collection(db, "orders", orderId, "chat"), { type: 'image', mediaUrl: url, sender: role, timestamp: serverTimestamp() });
        if(statusEl) statusEl.style.display = 'none';
    } catch (err) {
        if(statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = 'Upload failed.'; setTimeout(() => statusEl.style.display='none', 3000); }
    }
}

// NEW: Send Document Logic
async function sendDocumentMessage(db, storage, orderId, role, file, statusEl) {
    if (!file || !orderId) return;
    
    // Quick size check (Optional: Limit to 10MB)
    if (file.size > 10 * 1024 * 1024) {
        if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#ef4444'; statusEl.innerText = 'File too large (Max 10MB).'; setTimeout(() => statusEl.style.display='none', 3000); }
        return;
    }

    if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#e85d21'; statusEl.innerText = 'Sending document...'; }
    
    try {
        const storageRef = ref(storage, `chat_docs/doc_${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        
        await addDoc(collection(db, "orders", orderId, "chat"), { 
            type: 'document', 
            mediaUrl: url, 
            fileName: file.name,
            sender: role, 
            timestamp: serverTimestamp() 
        });
        if(statusEl) statusEl.style.display = 'none';
    } catch (err) {
        if(statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = 'Document upload failed.'; setTimeout(() => statusEl.style.display='none', 3000); }
    }
}

async function sendLocationMessage(db, orderId, role, statusEl) {
    if (!navigator.geolocation) { if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#ef4444'; statusEl.innerText = 'GPS not supported.'; setTimeout(() => statusEl.style.display='none', 3000); } return; }
    if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#e85d21'; statusEl.innerText = 'Fetching location...'; }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=$$${position.coords.latitude},${position.coords.longitude}`;
        try {
            await addDoc(collection(db, "orders", orderId, "chat"), { type: 'location', mediaUrl: mapUrl, sender: role, timestamp: serverTimestamp() });
            if(statusEl) statusEl.style.display = 'none';
        } catch (err) { if(statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = 'Failed to send.'; setTimeout(() => statusEl.style.display='none', 3000); } }
    }, (error) => {
        if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#ef4444'; statusEl.innerText = 'GPS denied.'; setTimeout(() => statusEl.style.display='none', 3000); }
    }, { enableHighAccuracy: true, timeout: 10000 });
}

async function toggleVoiceNote(db, storage, orderId, role, statusEl, micBtn) {
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const options = { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' };
            chatMediaRecorder = new MediaRecorder(stream, options);
            chatAudioChunks = [];
            
            chatMediaRecorder.ondataavailable = e => { if (e.data.size > 0) chatAudioChunks.push(e.data); };
            chatMediaRecorder.onstop = async () => {
                if(statusEl) { statusEl.style.display = 'block'; statusEl.style.color = '#e85d21'; statusEl.innerText = 'Sending voice note...'; }
                try {
                    const ext = options.mimeType.includes('webm') ? 'webm' : 'mp4';
                    const storageRef = ref(storage, `chat_audio/voice_${Date.now()}.${ext}`);
                    await uploadBytes(storageRef, new Blob(chatAudioChunks, { type: options.mimeType }));
                    const url = await getDownloadURL(storageRef);
                    await addDoc(collection(db, "orders", orderId, "chat"), { type: 'audio', mediaUrl: url, sender: role, timestamp: serverTimestamp() });
                    if(statusEl) statusEl.style.display = 'none';
                } catch (err) { if(statusEl) { statusEl.style.color = '#ef4444'; statusEl.innerText = 'Failed.'; setTimeout(() => statusEl.style.display='none', 3000); } }
            };
            
            chatMediaRecorder.start(); isRecording = true; micBtn.classList.add('chat-mic-recording'); 
        } catch (err) { alert("Microphone access is required."); }
    } else {
        chatMediaRecorder.stop(); chatMediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false; micBtn.classList.remove('chat-mic-recording'); 
    }
}

// --- DOM BINDING & EXPORT ENGINE ---
export function setupChatSystem(db, storage, orderId, role, containerId, onMessageSentCallback) {
    const uiInjected = buildChatUI(containerId);
    if (!uiInjected) return;

    startChatListener(db, orderId, role);

    const attachBtn = document.getElementById('chat-attach-btn');
    const attachMenu = document.getElementById('attach-menu');
    const photoBtn = document.getElementById('menu-photo-btn');
    const docBtn = document.getElementById('menu-doc-btn');
    const locationBtn = document.getElementById('menu-location-btn');
    
    const imageInput = document.getElementById('chat-image-input');
    const fileInput = document.getElementById('chat-file-input');
    
    const sendBtn = document.getElementById('send-msg-btn');
    const inputEl = document.getElementById('chat-input');
    const micBtn = document.getElementById('chat-mic-btn');
    const statusEl = document.getElementById('chat-upload-status');

    if (attachBtn.dataset.chatBound) return;

    attachBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        attachMenu.style.display = (attachMenu.style.display === 'none' || attachMenu.style.display === '') ? 'block' : 'none';
    });

    document.addEventListener('click', (e) => {
        if (attachMenu.style.display === 'block' && !attachMenu.contains(e.target) && !attachBtn.contains(e.target)) {
            attachMenu.style.display = 'none';
        }
    });

    // Image Upload
    photoBtn.addEventListener('click', () => {
        imageInput.click();
        attachMenu.style.display = 'none';
    });

    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        await sendImageMessage(db, storage, orderId, role, file, statusEl);
        e.target.value = ''; 
    });

    // Document Upload
    docBtn.addEventListener('click', () => {
        fileInput.click();
        attachMenu.style.display = 'none';
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        await sendDocumentMessage(db, storage, orderId, role, file, statusEl);
        e.target.value = ''; 
    });

    // Location Share
    locationBtn.addEventListener('click', async () => {
        attachMenu.style.display = 'none';
        await sendLocationMessage(db, orderId, role, statusEl);
    });

    // Voice Note
    micBtn.addEventListener('click', async function() {
        await toggleVoiceNote(db, storage, orderId, role, statusEl, this);
    });

    const handleSend = async () => {
        const text = inputEl.value;
        if(!text.trim() || !orderId) return;
        inputEl.value = ''; 
        const success = await sendTextMessage(db, orderId, role, text);
        if(success && onMessageSentCallback) onMessageSentCallback(text);
    };

    sendBtn.addEventListener('click', handleSend);
    inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSend();
    });

    attachBtn.dataset.chatBound = "true";
}
