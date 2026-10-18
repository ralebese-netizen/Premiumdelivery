// authManager/index.js
//
// Public API for the auth module.
//
// Re-exports the public functions so that existing imports like:
//
//     import { loginUser, logoutUser } from "../../authManager.js";
//
// continue to work unchanged. The root `authManager.js` is a thin
// re-export of this file — see that file for the full chain.
//
// If you later split any of these into further sub-modules, add the new
// export here. Everything downstream picks it up automatically.

export { loginUser }        from './login.js';
export { logoutUser }       from './logout.js';
export { registerDriver }   from './register.js';
export { monitorAuthState } from './monitor.js';
export { resetPassword }    from './passwordReset.js';
