// callManager.js
// Enterprise-Grade WebRTC Audio Engine for Bofelo Delivery
// Architecture: Strict State Machine, Centralized Config, Deep Memory Cleanup.

// 🚨 FIX 1: Added ?bundle so the browser doesn't crash trying to load Chime
import { 
    ConsoleLogger, 
    LogLevel, 
    DefaultDeviceController, 
    MeetingSessionConfiguration, 
    DefaultMeetingSession,
    MeetingSessionStatusCode 
} from "https://esm.sh/amazon-chime-sdk-js@3?bundle";

// 🚨 FIX 2: Added Firebase imports needed for the WebCallButton
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ==========================================
// 1. SYSTEM CONFIGURATION & CONSTANTS
// ==========================================
const SYSTEM_CONFIG = {
    API: {
        JOIN_ROOM: "https://e0yvpisdaj.execute-api.eu-north-1.amazonaws.com/default/call",
        PING_PHONE: "https://hem2omj47a.execute-api.eu-north-1.amazonaws.com/default/driver-call-notification"
    },
    TIMEOUTS: {
        RING_AUTO_HANGUP_MS: 45000, 
    },
    DOM: {
        BANNER_ID: 'active-call-banner',
        AUDIO_ID: 'meeting-audio'
    },
    AUDIO_CONSTRAINTS: {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
        video: false 
    }
};

const CALL_STATES = {
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    RINGING: 'RINGING',
    ACTIVE: 'ACTIVE',
    ERROR: 'ERROR'
};

// ==========================================
// 2. ENCAPSULATED ENGINE STATE
// ==========================================
const EngineState = {
    currentStatus: CALL_STATES.IDLE,
    meetingSession: null,
    localAudioStream: null,
    timers: {
        ring: null,
        duration: null
    },
    callSeconds: 0,
    
    reset() {
        this.currentStatus = CALL_STATES.IDLE;
        this.meetingSession = null;
        this.localAudioStream = null;
        this.callSeconds = 0;
        if (this.timers.ring) clearTimeout(this.timers.ring);
        if (this.timers.duration) clearInterval(this.timers.duration);
        this.timers = { ring: null, duration: null };
    }
};

// ==========================================
// 3. UI & DOM DELEGATE (Safely Isolated)
// ==========================================
const CallUI = {
    update(statusText, timeText = null, textColor = "#25D366") {
        const activeBanner = document.getElementById(SYSTEM_CONFIG.DOM.BANNER_ID);
        if (!activeBanner) return;
        
        activeBanner.style.display = 'block';
        const h3 = activeBanner.querySelector('h3');
        
        if (h3) {
            h3.innerHTML = timeText 
                ? `🛡️ ${statusText} <br><span style="color:${textColor}; font-size:14px; font-weight:600;">${timeText}</span>`
                : `🛡️ ${statusText}`;
        }
    },
    
    hide() {
        const activeBanner = document.getElementById(SYSTEM_CONFIG.DOM.BANNER_ID);
        if (activeBanner) activeBanner.style.display = 'none';
    },

    toast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        } else {
            console.warn("[CallManager UI]", msg);
        }
    }
};

// ==========================================
// 4. CORE WEBRTC EXPORTS
// ==========================================

/**
 * Initializes a secure WebRTC meeting room.
 */
export async function joinCallRoom(orderId, userId) {
    if (EngineState.currentStatus !== CALL_STATES.IDLE) {
        console.warn(`[CallManager] Call blocked. Current state: ${EngineState.currentStatus}`);
        return;
    }

    try {
        EngineState.currentStatus = CALL_STATES.CONNECTING;
        CallUI.update("Connecting securely...", "Encrypting...", "#fbbf24");

        // 1. Acquire Hardware Access
        EngineState.localAudioStream = await navigator.mediaDevices.getUserMedia(SYSTEM_CONFIG.AUDIO_CONSTRAINTS);
        
        // 2. Fetch Meeting Credentials
        const response = await fetch(SYSTEM_CONFIG.API.JOIN_ROOM, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                orderId: orderId,
                userId: `User_${userId}_${Date.now()}`
            })
        });
        
        if (!response.ok) throw new Error(`AWS Gateway Error: ${response.status}`);
        const data = await response.json();
        if (!data.Meeting || !data.Attendee) throw new Error("Invalid credential payload from AWS.");

        // 3. Initialize Chime Engine
        const logger = new ConsoleLogger('ChimeLogs', LogLevel.WARN); 
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration(data.Meeting, data.Attendee);
        
        EngineState.meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);

        // 4. Attach Network & Lifecycle Observers
        setupMeetingObservers(configuration.credentials.attendeeId);

        // 5. Bind Audio Devices
        const audioInputDevices = await EngineState.meetingSession.audioVideo.listAudioInputDevices();
        if (!audioInputDevices.length) throw new Error("No microphone detected.");
        await EngineState.meetingSession.audioVideo.startAudioInput(audioInputDevices[0].deviceId);

        const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
        if (!audioElement) throw new Error(`CRITICAL: <audio id='${SYSTEM_CONFIG.DOM.AUDIO_ID}'> missing from DOM.`);
        EngineState.meetingSession.audioVideo.bindAudioElement(audioElement);
        
        // 6. Execute Connection
        EngineState.meetingSession.audioVideo.start();
        
    } catch (err) {
        console.error("[CallManager] Initialization Sequence Failed:", err);
        CallUI.toast(`Call failed: ${err.message}`);
        endCall(); 
    }
}

/**
 * Terminates the call and performs a deep hardware/memory scrub.
 */
export function endCall() {
    console.log("[CallManager] Initiating teardown sequence...");
    
    // 1. Disconnect WebRTC Session
    if (EngineState.meetingSession) {
        try {
            EngineState.meetingSession.audioVideo.stop();
        } catch (e) {
            console.error("[CallManager] Error stopping meeting session:", e);
        }
    }
    
    // 2. Deep Hardware Cleanup (Memory Leak Prevention)
    if (EngineState.localAudioStream) {
        EngineState.localAudioStream.getTracks().forEach(track => {
            track.stop();
            EngineState.localAudioStream.removeTrack(track);
        });
    }

    // 3. Clean DOM Audio Reference
    const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
    if (audioElement) {
        audioElement.srcObject = null;
    }
    
    // 4. Reset State & UI
    EngineState.reset();
    CallUI.hide();
}

/**
 * Pings the remote user's device to trigger native-like ringing.
 */
export async function ringCustomerPhone(targetToken, orderId) {
    if (!targetToken) {
        console.error("[CallManager] Aborting ping: Target token missing.");
        return;
    }
    
    try {
        const response = await fetch(SYSTEM_CONFIG.API.PING_PHONE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                fcmToken: targetToken, // 🚨 FIX 3: Fixed typo from fcnToken to fcmToken
                orderId: orderId,
                data: { incomingCall: "true" }
            })
        });
        
        if (!response.ok) throw new Error(`Notification Gateway Failed: ${response.status}`);
        console.log("[CallManager] Device ping dispatched successfully.");
    } catch (err) {
        console.error("[CallManager] Notification Error:", err);
    }
}

// 🚨 FIX 4: Restored the Role-Aware DOM binding so the Driver app UI doesn't crash on load
export function setupWebCallButton(containerId, db, orderId, userId, role = "Driver") {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
        <button id="start-webcall-btn" style="background: #10b981; color: white; border: none; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);">
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
        </button>
    `;

    const btn = document.getElementById('start-webcall-btn');
    
    btn.addEventListener('click', async () => {
        if (EngineState.currentStatus !== CALL_STATES.IDLE) return;
        btn.style.opacity = '0.5';

        document.getElementById('active-call-banner').style.display = 'block';
        const callPromise = joinCallRoom(orderId, userId);
        
        const callStatus = (role === "Customer") ? 'CustomerCalling' : 'DriverCalling';
        updateDoc(doc(db, "orders", orderId), { incomingCall: callStatus })
            .catch(e => console.error("[CallManager] Failed to update DB state", e));

        await callPromise;
        btn.style.opacity = '1';
    });
}

// ==========================================
// 5. PRIVATE HELPER FUNCTIONS
// ==========================================

function setupMeetingObservers(localAttendeeId) {
    const { audioVideo } = EngineState.meetingSession;

    const observer = {
        audioVideoDidStart: () => {
            console.log("[CallManager] WebRTC Tunnel Established.");
            EngineState.currentStatus = CALL_STATES.RINGING;
            CallUI.update("Ringing...", "Waiting for answer", "#fbbf24");

            EngineState.timers.ring = setTimeout(() => {
                if (EngineState.currentStatus !== CALL_STATES.ACTIVE) {
                    CallUI.toast("No answer.");
                    endCall();
                }
            }, SYSTEM_CONFIG.TIMEOUTS.RING_AUTO_HANGUP_MS);
        },
        
        audioVideoDidStop: (sessionStatus) => {
            const code = sessionStatus.statusCode();
            if (code !== MeetingSessionStatusCode.Left) {
                CallUI.toast("Network drop or remote disconnect.");
            }
            endCall(); 
        },
        
        connectionDidBecomePoor: () => {
            CallUI.update("Poor Connection", "Stabilizing WebRTC...", "#f87171");
        },
        
        connectionDidBecomeGood: () => {
            if (EngineState.currentStatus === CALL_STATES.ACTIVE) {
                CallUI.update("Secure Call Active", formatTime(EngineState.callSeconds), "#4ade80");
            }
        }
    };

    audioVideo.addObserver(observer);

    audioVideo.realtimeSubscribeToAttendeeIdPresence((attendeeId, present) => {
        if (attendeeId === localAttendeeId) return;

        if (present) {
            handleRemoteUserJoined(attendeeId);
        } else {
            handleRemoteUserLeft(attendeeId);
        }
    });
}

function handleRemoteUserJoined(attendeeId) {
    console.log(`[CallManager] Handshake complete with attendee ${attendeeId}.`);
    EngineState.currentStatus = CALL_STATES.ACTIVE;
    
    if (EngineState.timers.ring) clearTimeout(EngineState.timers.ring);
    
    EngineState.callSeconds = 0;
    EngineState.timers.duration = setInterval(() => {
        EngineState.callSeconds++;
        CallUI.update("Secure Call Active", formatTime(EngineState.callSeconds), "#4ade80");
    }, 1000);
}

function handleRemoteUserLeft(attendeeId) {
    console.log(`[CallManager] Attendee ${attendeeId} terminated connection.`);
    if (EngineState.currentStatus === CALL_STATES.ACTIVE) {
        CallUI.toast("Call ended.");
    } else {
        CallUI.toast("Call declined.");
    }
    endCall();
}

function formatTime(totalSeconds) {
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

