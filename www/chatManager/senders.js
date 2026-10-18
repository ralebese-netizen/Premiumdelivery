// chatManager/senders.js
// All outbound message senders (text, image, doc, location, voice).

import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { MAX_DOC_SIZE_BYTES, CHAT_MODES } from "./constants.js";
import { state } from "./state.js";
import { cleanPhoneNumber, generateMessageId } from "./utils.js";
import { dispatchWebSocketMessage } from "./websocket.js";

// --- SHARED HELPERS ---

async function persistMessage(db, orderId, payload) {
    const now = Date.now();
    await addDoc(collection(db, "orders", orderId, "chat"), {
        ...payload,
        clientTime: now,
        timestamp: serverTimestamp()
    });
    return now;
}

function showStatus(statusEl, text, color = '#e85d21', autoHideMs = 0) {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.style.color = color;
    statusEl.innerText = text;
    if (autoHideMs > 0) setTimeout(() => { statusEl.style.display = 'none'; }, autoHideMs);
}

function hideStatus(statusEl) {
    if (statusEl) statusEl.style.display = 'none';
}

function phoneForCurrentMode() {
    return state.activeChatMode === CHAT_MODES.WHATSAPP
        ? cleanPhoneNumber(state.currentCustomerPhone)
        : "";
}

// --- TEXT ---
export async function sendTextMessage(db, orderId, role, text) {
    if (!text.trim() || !orderId) return false;

    const now = Date.now();
    const payload = {
        messageId: generateMessageId(),
        orderId,
        customerPhone: phoneForCurrentMode(),
        text: text.trim(),
        type: 'text',
        sender: role,
        channel: state.activeChatMode,
        timestamp: now
    };

    try {
        await persistMessage(db, orderId, payload);
        dispatchWebSocketMessage("sendMessage", payload);
        return true;
    } catch (err) {
        console.error("[ChatManager] Failed to send message:", err);
        return false;
    }
}

// --- IMAGE ---
export async function sendImageMessage(db, storage, orderId, role, file, statusEl) {
    if (!file || !orderId) return;
    if (!file.type.startsWith('image/')) {
        showStatus(statusEl, 'Invalid image file.', '#ef4444', 3000);
        return;
    }
    showStatus(statusEl, 'Sending photo...');

    try {
        const storageRef = ref(storage, `chat_images/img_${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const payload = {
            messageId: generateMessageId(),
            orderId,
            customerPhone: phoneForCurrentMode(),
            type: 'image',
            mediaUrl: url,
            sender: role,
            channel: state.activeChatMode,
            timestamp: Date.now()
        };

        await persistMessage(db, orderId, payload);
        dispatchWebSocketMessage("sendMessage", payload);
        hideStatus(statusEl);
    } catch (err) {
        showStatus(statusEl, 'Upload failed.', '#ef4444', 3000);
    }
}

// --- DOCUMENT ---
export async function sendDocumentMessage(db, storage, orderId, role, file, statusEl) {
    if (!file || !orderId) return;
    if (file.size > MAX_DOC_SIZE_BYTES) {
        showStatus(statusEl, 'File too large (Max 10MB).', '#ef4444', 3000);
        return;
    }
    showStatus(statusEl, 'Sending document...');

    try {
        const storageRef = ref(storage, `chat_docs/doc_${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const payload = {
            messageId: generateMessageId(),
            orderId,
            customerPhone: phoneForCurrentMode(),
            type: 'document',
            mediaUrl: url,
            fileName: file.name,
            sender: role,
            channel: state.activeChatMode,
            timestamp: Date.now()
        };

        await persistMessage(db, orderId, payload);
        dispatchWebSocketMessage("sendMessage", payload);
        hideStatus(statusEl);
    } catch (err) {
        showStatus(statusEl, 'Document upload failed.', '#ef4444', 3000);
    }
}

// --- LOCATION ---
export async function sendLocationMessage(db, orderId, role, statusEl) {
    if (!navigator.geolocation) {
        showStatus(statusEl, 'GPS not supported.', '#ef4444', 3000);
        return;
    }
    showStatus(statusEl, 'Fetching location...');

    navigator.geolocation.getCurrentPosition(async (position) => {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${position.coords.latitude},${position.coords.longitude}`;
        try {
            const payload = {
                messageId: generateMessageId(),
                orderId,
                customerPhone: phoneForCurrentMode(),
                type: 'location',
                mediaUrl: mapUrl,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                sender: role,
                channel: state.activeChatMode,
                timestamp: Date.now()
            };

            await persistMessage(db, orderId, payload);
            dispatchWebSocketMessage("sendMessage", payload);
            hideStatus(statusEl);
        } catch (err) {
            showStatus(statusEl, 'Failed to send.', '#ef4444', 3000);
        }
    }, () => {
        showStatus(statusEl, 'GPS denied.', '#ef4444', 3000);
    }, { enableHighAccuracy: true, timeout: 10000 });
}

// --- VOICE NOTE ---
export async function toggleVoiceNote(db, storage, orderId, role, statusEl, micBtn) {
    if (!state.isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const options = { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4' };
            state.mediaRecorder = new MediaRecorder(stream, options);
            state.audioChunks = [];

            state.mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) state.audioChunks.push(e.data);
            };

            state.mediaRecorder.onstop = async () => {
                showStatus(statusEl, 'Sending voice note...');
                try {
                    const ext = options.mimeType.includes('webm') ? 'webm' : 'mp4';
                    const storageRef = ref(storage, `chat_audio/voice_${Date.now()}.${ext}`);
                    await uploadBytes(storageRef, new Blob(state.audioChunks, { type: options.mimeType }));
                    const url = await getDownloadURL(storageRef);

                    const payload = {
                        messageId: generateMessageId(),
                        orderId,
                        customerPhone: phoneForCurrentMode(),
                        type: 'audio',
                        mediaUrl: url,
                        sender: role,
                        channel: state.activeChatMode,
                        timestamp: Date.now()
                    };

                    await persistMessage(db, orderId, payload);
                    dispatchWebSocketMessage("sendMessage", payload);
                    hideStatus(statusEl);
                } catch (err) {
                    showStatus(statusEl, 'Failed.', '#ef4444', 3000);
                }
            };

            state.mediaRecorder.start();
            state.isRecording = true;
            micBtn.classList.add('chat-mic-recording');
        } catch (err) {
            state.isRecording = false;
            micBtn.classList.remove('chat-mic-recording');
            alert("Microphone access is required.");
        }
    } else {
        if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') {
            state.isRecording = false;
            micBtn.classList.remove('chat-mic-recording');
            return;
        }
        state.mediaRecorder.stop();
        state.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        state.isRecording = false;
        micBtn.classList.remove('chat-mic-recording');
    }
}
