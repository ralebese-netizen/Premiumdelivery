// orderManager.js
//
// Barrel — re-exports from the orderManager/ folder so existing imports keep working.
//
// Existing callers (auth-flow.js) import from "../../orderManager.js". That path
// resolves to this file, which in turn re-exports from the modular folder.
// No other file in the app needs to change.

export { initializeOrderSystem } from "./orderManager/index.js";
