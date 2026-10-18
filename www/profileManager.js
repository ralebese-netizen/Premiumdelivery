import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export const ProfileManager = {
    userId: null, userType: "user", collectionPath: "users", unsubscribe: null,
    statsFetched: false, cachedDriverData: {}, dailyStats: {}, sortedDates: [], currentDateIndex: 0,
    _statsCache: { data: null, timestamp: 0 }, _statsCacheTTL: 60_000,

    init(db, uid, type = "user") {
        if (!db || !uid) return;
        this.db = db; this.userId = uid; this.userType = type;
        this.collectionPath = type === "driver" ? "drivers" : "users";
        const docRef = doc(this.db, this.collectionPath, this.userId);
        if (this.unsubscribe) this.unsubscribe();
        this.unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                this.cachedDriverData = {
                    ...data, name: (data.name || data.fullName || "Partner").trim(),
                    phone: (data.phone || data.phoneNumber || "No Phone").trim(),
                    rating: data.driverRating || "0.0", deliveries: data.deliveriesCount || 0,
                    walletBalance: data.walletBalance || 0
                };
                const snapshotJson = JSON.stringify(this.cachedDriverData);
                if (snapshotJson !== localStorage.getItem('user_profile')) localStorage.setItem('user_profile', snapshotJson);
                if (!this.statsFetched) this.renderProfileSkeleton(this.cachedDriverData);
                else this.updateProfileHeader(this.cachedDriverData);
                if (!this.statsFetched && this.userType === 'driver') this.fetchHistoricalStats();
            } else {
                this.renderProfileSkeleton({ name: "New User", phone: "Update Profile", rating: "0.0", deliveries: 0 });
            }
        }, (error) => {
            console.error("[ProfileManager] Sync Error:", error);
            const localCache = JSON.parse(localStorage.getItem('user_profile'));
            if (localCache) this.renderProfileSkeleton(localCache);
        });
    },
    invalidateStats() { this.statsFetched = false; this._statsCache = { data: null, timestamp: 0 }; },
    updateProfileHeader(data) {
        const profileView = document.getElementById('view-profile');
        if (!profileView) return;
        const nameEl = profileView.querySelector('.profile-name');
        if (nameEl) nameEl.textContent = data.name;
        const deliveriesEl = document.getElementById('skel-deliveries');
        if (deliveriesEl) deliveriesEl.textContent = data.deliveries;
        const balanceEl = document.getElementById('wallet-balance-display');
        if (balanceEl) balanceEl.innerText = 'M ' + parseFloat(data.walletBalance || 0).toFixed(2);
    },
    renderProfileSkeleton(data) { /* Truncated for brevity, insert your exact code here */ },
    async fetchHistoricalStats() { /* Truncated for brevity, insert your exact code here */ },
    paintAnalyticsGrid() { /* Truncated for brevity, insert your exact code here */ },
    async editProfile() { /* Truncated for brevity, insert your exact code here */ },
    setupEventListeners() { /* Truncated for brevity, insert your exact code here */ },
    _escapeHtml(unsafe) { return unsafe ? String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;") : ""; },
    _notify(message) { if (typeof window.showToast === 'function') window.showToast(message); else alert(message); }
};
