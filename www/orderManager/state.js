// orderManager/state.js
// Shared mutable state. Mutate the fields, never reassign the object.

export const env = {
    db: null,
    driverId: null,
    driverToken: null,
    fleetName: 'General',
    isVIP: false,
    onToast: () => {},
    onOpenChat: () => {},
    onStartTracking: () => {},
    onStopTracking: () => {},
    onCallStateChange: () => {},
    onNewOrderNotification: () => {}
};

export function setEnv(config) {
    Object.assign(env, config);
}

export const state = {
    rawOwnOrders: [],
    rawOtherOrders: [],
    declinedIds: new Set(),
    notifiedIds: new Set(),
    isInitialLoad: true,
    hasActiveOrder: false,
    activeOrderId: null,
    refreshInterval: null,
    activeUnsubscribe: null,
    pendingOwnUnsubscribe: null,
    pendingOtherUnsubscribe: null
};

export function resetState() {
    state.rawOwnOrders = [];
    state.rawOtherOrders = [];
    state.declinedIds = new Set();
    state.notifiedIds = new Set();
    state.isInitialLoad = true;
    state.hasActiveOrder = false;
    state.activeOrderId = null;
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
}
