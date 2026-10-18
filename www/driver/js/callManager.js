// callManager.js
//
// WebRTC Audio Engine for Bofelo Delivery, backed by the Amazon Chime SDK.

import {
    ConsoleLogger,
    LogLevel,
    DefaultDeviceController,
    MeetingSessionConfiguration,
    DefaultMeetingSession,
    MeetingSessionStatusCode,
    AudioProfile
} from "https://esm.sh/amazon-chime-sdk-js@3";

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

const EngineState = {
    currentStatus: CALL_STATES.IDLE,
    meetingSession: null,
    localAudioStream: null,
    timers: {
        ring: null,
        duration: null
    },
    callSeconds: 0,
    ending: false,

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

export async function joinCallRoom(orderId, userId, callSessionId = null) {
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

        EngineState.localAudioStream = await navigator.mediaDevices.getUserMedia(SYSTEM_CONFIG.AUDIO_CONSTRAINTS);

        const response = await fetch(SYSTEM_CONFIG.API.JOIN_ROOM, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                orderId: orderId,
                userId: `User_${userId}_${Date.now()}`,
                callSessionId: callSessionId,
            })
        });

        if (!response.ok) throw new Error(`AWS Gateway Error: ${response.status}`);
        const data = await response.json();
        if (!data.Meeting || !data.Attendee) throw new Error("Invalid credential payload from AWS.");

        const meetingId = data.Meeting.MeetingId || '(unknown)';
        const attendeeId = data.Attendee.AttendeeId || '(unknown)';
        console.log(`[CallManager] Chime credentials received: meetingId=${meetingId} attendeeId=${attendeeId}`);

        const logger = new ConsoleLogger('ChimeLogs', LogLevel.WARN);
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration(data.Meeting, data.Attendee);

        EngineState.meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);

        try {
            EngineState.meetingSession.audioVideo.setAudioProfile(AudioProfile.stereoWideband);
        } catch (e) {
            console.warn("[CallManager] setAudioProfile failed, using default:", e.message);
        }

        setupMeetingObservers(configuration.credentials.attendeeId);

        const audioInputDevices = await EngineState.meetingSession.audioVideo.listAudioInputDevices();
        if (!audioInputDevices.length) throw new Error("No microphone detected.");
        await EngineState.meetingSession.audioVideo.startAudioInput(audioInputDevices[0].deviceId);

        const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
        if (!audioElement) throw new Error(`CRITICAL: <audio id='${SYSTEM_CONFIG.DOM.AUDIO_ID}'> missing from DOM.`);
        EngineState.meetingSession.audioVideo.bindAudioElement(audioElement);

        EngineState.meetingSession.audioVideo.start();

        return { ok: true, status: 'started', meetingId, attendeeId };

    } catch (err) {
        console.error("[CallManager] Initialization failed:", err);
        CallUI.toast(`Call failed: ${err.message}`);
        endCall();
        return { ok: false, reason: 'error', error: err.message };
    }
}

export async function endCall() {
    if (EngineState.ending) {
        console.log("[CallManager] endCall: teardown already in progress, ignoring.");
        return;
    }
    EngineState.ending = true;

    console.log("[CallManager] Initiating teardown sequence...");

    try {
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

        if (EngineState.localAudioStream) {
            for (const track of EngineState.localAudioStream.getTracks()) {
                try { track.stop(); } catch { /* ignore */ }
            }
        }

        const audioElement = document.getElementById(SYSTEM_CONFIG.DOM.AUDIO_ID);
        if (audioElement) {
            audioElement.srcObject = null;
        }
    } finally {
        EngineState.reset();
        CallUI.hide();
        console.log("[CallManager] Teardown complete. State reset to IDLE.");
    }
}

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
