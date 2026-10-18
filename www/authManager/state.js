// authManager/state.js
//
// Shared mutable state for the auth module.
//
// Kept in its own file so overlay.js can own the single source of truth
// for "which overlay is currently on screen" without reaching into other
// modules. Adding new shared state later (e.g. a login-retry counter)
// belongs here too.

export const authState = {
    /**
     * The currently-visible status overlay element, or null if none.
     * Mutated only by overlay.js — other modules must import from there.
     */
    activeOverlay: null,
};
