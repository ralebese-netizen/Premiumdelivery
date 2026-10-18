// authManager.js
//
// Barrel — re-exports from the authManager/ folder so existing imports
// keep working.
//
// Existing callers that do:
//
//     import { loginUser, logoutUser, registerDriver } from "./authManager.js";
//
// resolve here, and this file re-exports from ./authManager/index.js.
// No other file in the app needs to change.

export {
    loginUser,
    logoutUser,
    registerDriver,
    monitorAuthState,
    resetPassword,
} from './authManager/index.js';
