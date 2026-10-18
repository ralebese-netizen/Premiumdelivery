import { authState } from './state.js';
const BASE_STYLE = { position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#333', color: '#fff', padding: '12px 24px', borderRadius: '8px', zIndex: '9999', fontFamily: 'sans-serif', fontSize: '14px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', transition: 'opacity 0.3s ease', maxWidth: '90vw', textAlign: 'center', pointerEvents: 'none' };
const COLORS = { NEUTRAL: '#333', SUCCESS: '#28a745', ERROR: '#dc3545' };
export function showOverlay(message, tone = 'neutral') {
    if (authState.activeOverlay && authState.activeOverlay.isConnected) { authState.activeOverlay.innerText = message; authState.activeOverlay.style.backgroundColor = COLORS[tone.toUpperCase()] || COLORS.NEUTRAL; return authState.activeOverlay; }
    const el = document.createElement('div'); el.innerText = message; Object.assign(el.style, { ...BASE_STYLE, backgroundColor: COLORS[tone.toUpperCase()] || COLORS.NEUTRAL }); document.body.appendChild(el); authState.activeOverlay = el; return el;
}
export function hideOverlayAfter(ms = 1500) { const el = authState.activeOverlay; if (!el) return; setTimeout(() => { el.remove(); if (authState.activeOverlay === el) authState.activeOverlay = null; }, ms); }
export function clearOverlay() { if (authState.activeOverlay && authState.activeOverlay.isConnected) authState.activeOverlay.remove(); authState.activeOverlay = null; }
