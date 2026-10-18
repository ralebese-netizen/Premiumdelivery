// callManager.js
//
// WebRTC Audio Engine for Bofelo Delivery, backed by the Amazon Chime SDK.
//
// Architecture:
//   - Strict state machine (IDLE → CONNECTING → RINGING → ACTIVE → IDLE)
//   - Centralized config (SYSTEM_CONFIG)
//   - Serialized teardown (endCall is safe to call concurrently)
//   - Observable entry conditions (joinCallRoom returns a status object)
//
// 🔒 Improvements over previous version:
//   1. joinCallRoom logs its entry state and returns a status object, so
//      callers can distinguish "started" from "rejected because busy".
//   2. Meeting + attendee IDs are logged after credentials are fetched —
//      the single fastest way to detect "customer and driver in different
//      meetings".
//   3. setAudioProfile is guarded — a bad enum value won't kill the call.
//   4. endCall is serialized and idempotent, safe to call from multiple
//      paths (button, observer, error handler) without state corruption.
//   5. All teardown paths converge on _teardown(), so nothing is missed.
//
// 🔒 Fix — callSessionId was being dropped.
//
//   The customer app generates a unique `callSessionId` per call and
//   writes it to orders/{orderId}.activeCallSessionId. Both apps must
//   pass it to the backend so Chime uses it as the ClientRequestToken
//   and puts BOTH parties in the SAME meeting.
//
//   call-handlers.js was already passing a third argument to
//   joinCallRoom() — but joinCallRoom's signature only accepted two,
//   and its fetch body didn't include the field. The result: customer
//   joined the meeting keyed on `call_xxx`, driver joined the meeting
//   keyed on `orderId`, and both sides sat at "Ringing..." forever,
//   each waiting for the other to appear in a meeting they were never
//   in.
//
//   Fix: accept the third parameter and forward it in the POST body.

import {
    ConsoleLogger,
    LogLevel,
    DefaultDeviceController,
    MeetingSessionConfiguration,
    DefaultMeetingSession,
    MeetingSessionStatusCode,
    AudioProfile
} from "https://esm.sh/amazon-chime-sdk-js@3";

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
        audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 48000 },
            sampleSize: { ideal: 16 },
            latency: { ideal: 0.005 }
        },
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
    ending: false,   // guards against concurrent endCall

    reset() {
        this.currentStatus = CALL_STATES.IDLE;
        this.meetingSession = null;
        this.localAudioStream = null;
        this.callSeconds = 0;
        if (this.timers.ring) { clearTimeout(this.timers.ring); this.timers.ring = null; }
        if (this.timers.duration) { clearInterval(this.timers.duration); this.timers.duration = null; }
        this.ending = false;
    }
};

// ==========================================
// 3. UI & DOM DELEGATE
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
// 4. CORE EXPORTS
// ==========================================

/**
 * Initializes a secure Chime meeting and joins it.
 *
 * Returns a status object so callers can distinguish success from the
 * various early-exit paths:
 *
 *   { ok: true,  status: 'started',  meetingId, attendeeId }
 *   { ok: false, reason: 'busy',     currentState }
 *   { ok: false, reason: 'error',    error }
 *
 * @param {string} orderId
 * @param {string} userId
 * @param {string|null} callSessionId  Unique per-call identifier. Used as
 *                                     the Chime ClientRequestToken on the
 *                                     backend so both parties land in the
 *                                     SAME meeting. Pass null for legacy
 *                                     paths that don't have a session ID
 *                                     yet — the backend falls back to
 *                                     orderId in that case.
 * @returns {Promise<{ok: boolean, reason?: string, status?: string, meetingId?: string, attendeeId?: string, error?: string, currentState?: string}>}
 */
export async function joinCallRoom(orderId, userId, callSessionId = null) {
    // Log every entry attempt with the current state — this is the single
    // most useful diagnostic when a call silently fails to start.
    console.log(
        `[CallManager] joinCallRoom entry: orderId=${orderId} userId=${userId} callSessionId=${callSessionId || '(none)'} state=${EngineState.currentStatus}`
    );

    if (EngineState.currentStatus !== CALL_STATES.IDLE) {
        console.warn(`[CallManager] Call blocked. Current state: ${EngineState.currentStatus}`);
        return { ok: false, reason: 'busy', currentState: EngineState.currentStatus };
    }

    try {
        EngineState.currentStatus = CALL_STATES.CONNECTING;
        CallUI.update("Connecting securely...", "Encrypting...", "#fbbf24");

        // 1. Acquire microphone hardware access
        EngineState.localAudioStream = await navigator.mediaDevices.getUserMedia(SYSTEM_CONFIG.AUDIO_CONSTRAINTS);

        // 2. Fetch meeting credentials from the backend
        const response = await fetch(SYSTEM_CONFIG.API.JOIN_ROOM, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                orderId: orderId,
                userId: `User_${userId}_${Date.now()}`,
                callSessionId: callSessionId,   // 🟢 forwarded to backend
            })
        });

        if (!response.ok) throw new Error(`AWS Gateway Error: ${response.status}`);
        const data = await response.json();
        if (!data.Meeting || !data.Attendee) throw new Error("Invalid credential payload from AWS.");

        // Log meeting + attendee IDs. If the customer and driver log
        // different meeting IDs, they're in different meetings and will
        // never hear each other — the #1 cause of "connected but silent".
        const meetingId = data.Meeting.MeetingId || '(unknown)';
        const attendeeId = data.Attendee.AttendeeId || '(unknown)';
        console.log(`[CallManager] Chime credentials received: meetingId=${meetingId} attendeeId=${attendeeId}`);

        // 3. Initialize the Chime engine
        const logger = new ConsoleLogger('ChimeLogs', LogLevel.WARN);
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration(data.Meeting, data.Attendee);

        EngineState.meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);

        // 4. Apply the audio profile (guarded — a version mismatch here
        //    shouldn't kill the call).
        try {
            EngineState.meetingSession.audioVideo.setAudioProfile(AudioProfile.stereoWideband);
        } catch (e) {
            console.warn("[CallManager] setAudioProfile failed, using default:", e.message);
        }

        // 5. Attach lifecycle observers
        setupMeetingObservers(configuration.credentials.attendeeId);

        // 6. Bind audio devices
        const audioInputDevices = await EngineState.meetingSession.audioVideo.listAudioInputDevices();
        if (!audioInputDevices.length) throw new Error("No microphone detected.");
        await EngineState.meetingSession.audioVideo.startAudioInput(audioInputDevices[0].deviceId);

        const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
        if (!audioElement) throw new Error(`CRITICAL: <audio id='${SYSTEM_CONFIG.DOM.AUDIO_ID}'> missing from DOM.`);
        EngineState.meetingSession.audioVideo.bindAudioElement(audioElement);

        // 7. Start the connection
        EngineState.meetingSession.audioVideo.start();

        return { ok: true, status: 'started', meetingId, attendeeId };

    } catch (err) {
        console.error("[CallManager] Initialization failed:", err);
        CallUI.toast(`Call failed: ${err.message}`);
        // Fire-and-forget; teardown is serialized internally.
        endCall();
        return { ok: false, reason: 'error', error: err.message };
    }
}

/**
 * Terminates the call and performs a deep hardware/memory scrub.
 *
 * Safe to call concurrently — subsequent calls during an in-progress
 * teardown are coalesced into the same operation.
 */
export async function endCall() {
    // Guard against re-entry while a teardown is in progress.
    if (EngineState.ending) {
        console.log("[CallManager] endCall: teardown already in progress, ignoring.");
        return;
    }
    EngineState.ending = true;

    console.log("[CallManager] Initiating teardown sequence...");

    try {
        // 1. Stop the Chime session and its audio input hardware.
        if (EngineState.meetingSession) {
            try {
                const av = EngineState.meetingSession.audioVideo;
                if (av) {
                    await av.stopAudioInput();
                    av.stop();
                }
            } catch (e) {
                console.error("[CallManager] Error stopping meeting session:", e);
            }
        }

        // 2. Close the raw microphone stream so the OS indicator clears.
        if (EngineState.localAudioStream) {
            for (const track of EngineState.localAudioStream.getTracks()) {
                try { track.stop(); } catch { /* ignore */ }
            }
        }

        // 3. Clear the DOM audio element.
        const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
        if (audioElement) {
            audioElement.srcObject = null;
        }
    } finally {
        // 4. Always reset state and UI, even if a step above threw.
        EngineState.reset();
        CallUI.hide();
        console.log("[CallManager] Teardown complete. State reset to IDLE.");
    }
}

/**
 * Pings the remote user's device to trigger native-like ringing.
 * @param {string} targetToken FCM/APNs token
 * @param {string} orderId
 */
export async function ringCustomerPhone(targetToken, orderId) {
    if (!targetToken) {
        console.error("[CallManager] Aborting ping: target token missing.");
        return;
    }

    try {
        const response = await fetch(SYSTEM_CONFIG.API.PING_PHONE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fcnToken: targetToken,
                orderId: orderId,
                data: { incomingCall: "true" }
            })
        });

        if (!response.ok) throw new Error(`Notification Gateway Failed: ${response.status}`);
        console.log("[CallManager] Device ping dispatched successfully.");
    } catch (err) {
        console.error("[CallManager] Notification error:", err);
    }
}

// ==========================================
// 5. PRIVATE HELPERS
// ==========================================

function setupMeetingObservers(localAttendeeId) {
    const { audioVideo } = EngineState.meetingSession;

    const observer = {
        audioVideoDidStart: () => {
            console.log("[CallManager] WebRTC tunnel established.");
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
            CallUI.update("Poor connection", "Stabilizing WebRTC...", "#f87171");
        },

        connectionDidBecomeGood: () => {
            if (EngineState.currentStatus === CALL_STATES.ACTIVE) {
                CallUI.update("Secure HD Call Active", formatTime(EngineState.callSeconds), "#4ade80");
            }
        }
    };

    audioVideo.addObserver(observer);

    // Detect when the other party actually connects / disconnects.
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

    if (EngineState.timers.ring) {
        clearTimeout(EngineState.timers.ring);
        EngineState.timers.ring = null;
    }

    EngineState.callSeconds = 0;
    EngineState.timers.duration = setInterval(() => {
        EngineState.callSeconds++;
        CallUI.update("Secure HD Call Active", formatTime(EngineState.callSeconds), "#4ade80");
    }, 1000);
}

function handleRemoteUserLeft(attendeeId) {
    console.log(`[CallManager] Attendee ${attendeeId} terminated the connection.`);
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
