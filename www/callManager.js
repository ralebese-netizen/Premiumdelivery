import { ConsoleLogger, LogLevel, DefaultDeviceController, MeetingSessionConfiguration, DefaultMeetingSession, MeetingSessionStatusCode, AudioProfile } from "https://esm.sh/amazon-chime-sdk-js@3";
const SYSTEM_CONFIG = {
    API: { JOIN_ROOM: "https://e0yvpisdaj.execute-api.eu-north-1.amazonaws.com/default/call", PING_PHONE: "https://hem2omj47a.execute-api.eu-north-1.amazonaws.com/default/driver-call-notification" },
    TIMEOUTS: { RING_AUTO_HANGUP_MS: 45000 },
    DOM: { BANNER_ID: 'active-call-banner', AUDIO_ID: 'meeting-audio' },
    AUDIO_CONSTRAINTS: { audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 }, latency: { ideal: 0.005 } }, video: false }
};
const CALL_STATES = { IDLE: 'IDLE', CONNECTING: 'CONNECTING', RINGING: 'RINGING', ACTIVE: 'ACTIVE', ERROR: 'ERROR' };
const EngineState = {
    currentStatus: CALL_STATES.IDLE, meetingSession: null, localAudioStream: null,
    timers: { ring: null, duration: null }, callSeconds: 0, ending: false,
    reset() { this.currentStatus = CALL_STATES.IDLE; this.meetingSession = null; this.localAudioStream = null; this.callSeconds = 0; if (this.timers.ring) { clearTimeout(this.timers.ring); this.timers.ring = null; } if (this.timers.duration) { clearInterval(this.timers.duration); this.timers.duration = null; } this.ending = false; }
};
const CallUI = {
    update(statusText, timeText = null, textColor = "#25D366") { const activeBanner = document.getElementById(SYSTEM_CONFIG.DOM.BANNER_ID); if (!activeBanner) return; activeBanner.style.display = 'block'; const h3 = activeBanner.querySelector('h3'); if (h3) h3.innerHTML = timeText ? `🛡️ ${statusText} <br><span style="color:${textColor}; font-size:14px; font-weight:600;">${timeText}</span>` : `🛡️ ${statusText}`; },
    hide() { const activeBanner = document.getElementById(SYSTEM_CONFIG.DOM.BANNER_ID); if (activeBanner) activeBanner.style.display = 'none'; },
    toast(msg) { if (typeof window.showToast === 'function') window.showToast(msg); else console.warn("[CallManager UI]", msg); }
};
export async function joinCallRoom(orderId, userId, callSessionId = null) { /* Truncated for brevity, insert your exact code here */ }
export async function endCall() { /* Truncated for brevity, insert your exact code here */ }
export async function ringCustomerPhone(targetToken, orderId) { /* Truncated for brevity, insert your exact code here */ }
