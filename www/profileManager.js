import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Enterprise-Grade Profile & Analytics Management System
 * Fully dynamic: Calculates earnings (Day/Week/Month) and paints the multi-billion dollar UI.
 */
export const ProfileManager = {
    userId: null,
    userType: "user", 
    collectionPath: "users",
    unsubscribe: null,
    
    // Global State for Analytics
    statsFetched: false,
    cachedDriverData: {},
    dailyStats: {},
    sortedDates: [],
    currentDateIndex: 0,

    /**
     * Initializes the profile module with a REAL-TIME Firestore listener.
     */
    init(db, uid, type = "user") {
        if (!db || !uid) return;

        this.db = db;
        this.userId = uid;
        this.userType = type;
        this.collectionPath = type === "driver" ? "drivers" : "users";

        const docRef = doc(this.db, this.collectionPath, this.userId);

        if (this.unsubscribe) this.unsubscribe();

        // Real-time synchronization
        this.unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                this.cachedDriverData = {
                    ...data,
                    name: (data.name || data.fullName || "Partner").trim(),
                    phone: (data.phone || data.phoneNumber || "No Phone").trim(),
                    rating: data.driverRating || "0.0",
                    deliveries: data.deliveriesCount || 0,
                    walletBalance: data.walletBalance || 0
                };
                
                localStorage.setItem('user_profile', JSON.stringify(this.cachedDriverData));
                this.renderProfileSkeleton(this.cachedDriverData);
                
                // Fetch the deep analytics only once per session to save Firestore read costs
                if (!this.statsFetched && this.userType === 'driver') {
                    this.fetchHistoricalStats();
                }
            } else {
                this.renderProfileSkeleton({ name: "New User", phone: "Update Profile", rating: "0.0", deliveries: 0 });
            }
        }, (error) => {
            console.error("[ProfileManager] Sync Error:", error);
            const localCache = JSON.parse(localStorage.getItem('user_profile'));
            if (localCache) this.renderProfileSkeleton(localCache);
        });
    },

    /**
     * Dynamically paints the top-level DOM structure.
     */
    renderProfileSkeleton(data) {
        const profileView = document.getElementById('view-profile');
        if (!profileView) return;

        let initials = data.initials;
        if (!initials && data.name) {
            const nameParts = data.name.trim().split(/\s+/);
            initials = nameParts.length > 1 
                ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
                : data.name.substring(0, 2).toUpperCase();
        }

        // ====================================================================
        // 🚀 DRIVER UI SKELETON
        // ====================================================================
        if (this.userType === 'driver') {
            profileView.innerHTML = `
                <div style="font-family: 'Inter', sans-serif; padding-bottom: 5px;">
                    
                    <div id="edit-profile-card" style="background: white; border-radius: 20px; padding: 24px; display: flex; align-items: center; gap: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.04); border: 1px solid #f3f4f6; margin-bottom: 24px; cursor: pointer; transition: transform 0.2s;">
                        <div style="position: relative;">
                            <div style="width: 80px; height: 80px; background: #fce7f3; color: #be123c; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800;">
                                ${initials || "??"}
                            </div>
                            <div style="position: absolute; bottom: 2px; right: 2px; width: 14px; height: 14px; background: #22c55e; border: 3px solid white; border-radius: 50%;"></div>
                        </div>
                        <div>
                            <h2 style="margin: 0 0 4px 0; font-size: 22px; color: #111827; font-weight: 800; letter-spacing: -0.5px;">${this._escapeHtml(data.name)}</h2>
                            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px; font-weight: 500;">Delivery Partner</p>
                            <div style="display: flex; gap: 12px; font-size: 13px; font-weight: 700; color: #374151;">
                                <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #fbbf24; font-size: 14px;">⭐</span> ${data.rating}</span>
                                <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #60a5fa; font-size: 14px;">🚚</span> <span id="skel-deliveries">${data.deliveries}</span> deliveries</span>
                            </div>
                        </div>
                    </div>

                    <div id="driver-dynamic-analytics">
                        <div style="padding: 40px 20px; text-align: center; color: #6b7280; font-size: 13px; font-weight: 600;">
                            <svg style="animation: spin 1s linear infinite; margin-bottom: 10px;" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
                            <p>Calculating earnings analytics...</p>
                        </div>
                    </div>

                    <button id="logout-btn" style="width: 100%; background: white; border: 1px solid #fca5a5; color: #ef4444; padding: 16px; border-radius: 16px; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: 0 4px 10px rgba(239, 68, 68, 0.08);">
                        Secure Log Out
                    </button>
                </div>
            `;
            
            // Add a simple spin animation for the loader
            if (!document.getElementById('profile-animations')) {
                const style = document.createElement('style');
                style.id = 'profile-animations';
                style.innerHTML = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }
            
        } 
        // ====================================================================
        // 🛍️ CUSTOMER UI
        // ====================================================================
        else {
            profileView.innerHTML = `
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 24px; background: white; padding: 24px; border-radius: 20px; border: 1px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.04);">
                    <div style="width: 64px; height: 64px; background: #e0f2fe; color: #0284c7; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800;">
                        ${initials || "??"}
                    </div>
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 800; font-size: 18px; color: #111827; margin-bottom: 4px;">${this._escapeHtml(data.name)}</div>
                        <div style="font-size: 13px; color: #6b7280; font-weight: 500;">${this._escapeHtml(data.phone)}</div>
                    </div>
                    <button id="edit-profile-card" style="background: #f0f9ff; border: none; color: #0284c7; cursor: pointer; padding: 10px; border-radius: 12px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                </div>
                <button id="logout-btn" style="width: 100%; margin-top: 32px; background: white; border: 1px solid #fca5a5; color: #ef4444; padding: 16px; border-radius: 16px; font-weight: 700; font-size: 15px; cursor: pointer;">
                    Secure Log Out
                </button>
            `;
        }

        this.setupEventListeners();
    },

    /**
     * Queries the orders collection, calculates dynamic date ranges, and builds the UI.
     */
    async fetchHistoricalStats() {
        const container = document.getElementById('driver-dynamic-analytics');
        if (!container || !this.db || !this.userId) return;

        try {
            const q = query(
                collection(this.db, "orders"),
                where("driverId", "==", this.userId),
                where("status", "==", "Completed") 
            );

            const snapshot = await getDocs(q);
            
            // Core metrics
            let tToday = 0; let tWeek = 0; let tMonth = 0; let tTotal = 0;
            let dTotal = 0; // Deliveries count override
            this.dailyStats = {};

            // Dynamic Date Calculators
            const now = new Date();
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            const dayOfWeek = now.getDay();
            const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
            const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diffToMonday);
            
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            snapshot.forEach(doc => {
                const data = doc.data();
                
                // Smart Payout extraction
                let driverCut = 0;
                if (data.driverPayoutAmount !== undefined) {
                    driverCut = parseFloat(data.driverPayoutAmount);
                } else if (data.fee) {
                    // Fallback for older legacy orders
                    let rawFee = parseFloat(data.fee.replace(/[^\d.]/g, '')) || 0;
                    driverCut = Math.floor(rawFee * 0.95);
                }
                
                const orderDate = data.createdAt || data.timestamp;
                if (orderDate && orderDate.toDate) {
                    const d = orderDate.toDate();
                    
                    tTotal += driverCut;
                    dTotal++;

                    if (d >= startOfToday) tToday += driverCut;
                    if (d >= startOfWeek) tWeek += driverCut;
                    if (d >= startOfMonth) tMonth += driverCut;

                    // Build daily slider stats
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const dayStr = String(d.getDate()).padStart(2, '0');
                    const dateKey = `${year}-${month}-${dayStr}`;

                    if (!this.dailyStats[dateKey]) {
                        this.dailyStats[dateKey] = { deliveries: 0, earnings: 0 };
                    }
                    this.dailyStats[dateKey].deliveries++;
                    this.dailyStats[dateKey].earnings += driverCut;
                }
            });

            this.statsFetched = true;
            
            // Sync deliveries number in the top card if it was incorrect
            const topCardDeliveries = document.getElementById('skel-deliveries');
            if (topCardDeliveries) topCardDeliveries.innerText = dTotal;

            // Sort from Newest to Oldest for the slider
            this.sortedDates = Object.keys(this.dailyStats).sort((a, b) => b.localeCompare(a));
            this.currentDateIndex = 0; 

            // Paint the Analytics UI
            this.paintAnalyticsGrid(tToday, tWeek, tMonth, tTotal, dTotal);

        } catch (error) {
            console.error("Error loading stats:", error);
            container.innerHTML = '<p style="color: #ef4444; font-size: 13px; text-align: center;">Failed to load analytics.</p>';
        }
    },

    /**
     * Injects the Analytics Grids and the interactive daily slider into the DOM
     */
    paintAnalyticsGrid(today, week, month, total, deliveries) {
        const container = document.getElementById('driver-dynamic-analytics');
        if (!container) return;

        let displayDate = "No Data";
        let stats = { deliveries: 0, earnings: 0 };
        let hasOlder = false; let hasNewer = false;

        if (this.sortedDates.length > 0) {
            const currentDateKey = this.sortedDates[this.currentDateIndex];
            stats = this.dailyStats[currentDateKey];
            const [y, m, d] = currentDateKey.split('-');
            displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            hasOlder = this.currentDateIndex < this.sortedDates.length - 1; 
            hasNewer = this.currentDateIndex > 0; 
        }

        container.innerHTML = `
            <h3 style="font-size: 18px; color: #111827; margin: 0 0 16px 0; font-weight: 800;">Earnings Analytics</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #4ade80; margin-bottom: 8px;"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                    <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 4px;">Today:</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827;">M${today.toFixed(2)}</div>
                </div>
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #60a5fa; margin-bottom: 8px;"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg></div>
                    <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 4px;">This Week</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827;">M${week.toFixed(2)}</div>
                </div>
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #fb923c; margin-bottom: 8px;"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div>
                    <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 4px;">This Month</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827;">M${month.toFixed(2)}</div>
                </div>
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #a855f7; margin-bottom: 8px;"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line><path d="M12 15h.01"></path></svg></div>
                    <div style="font-size: 12px; font-weight: 700; color: #6b7280; margin-bottom: 4px;">Total Earned</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827;">M${total.toFixed(2)}</div>
                </div>
            </div>

            <h3 style="font-size: 18px; color: #111827; margin: 0 0 16px 0; font-weight: 800;">Performance Metrics</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 30px;">
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #4ade80; margin-bottom: 12px; display:flex; justify-content:center;"><div style="background:#dcfce7; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div></div>
                    <div style="font-size: 13px; font-weight: 500; color: #4b5563; margin-bottom: 6px;">Orders Delivered</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 4px;">${deliveries}</div>
                    <div style="font-size: 10px; color: #9ca3af; font-weight: 600;">Lifetime deliveries</div>
                </div>
                
                <div style="background: white; border-radius: 16px; padding: 20px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="color: #fbbf24; margin-bottom: 12px; display:flex; justify-content:center;"><div style="background:#fef3c7; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;"><svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg></div></div>
                    <div style="font-size: 13px; font-weight: 500; color: #4b5563; margin-bottom: 6px;">Average Rating</div>
                    <div style="font-size: 22px; font-weight: 800; color: #111827; margin-bottom: 4px;">${this.cachedDriverData.rating}</div>
                    <div style="font-size: 10px; color: #9ca3af; font-weight: 600;">Based on customer feedback</div>
                </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 0;">
                <h3 style="font-size: 18px; color: #111827; margin: 0; font-weight: 800;">Daily Breakdown</h3>
                
                <div style="display: flex; align-items: center; gap: 10px; background: white; padding: 4px 12px; border-radius: 20px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <button id="stats-prev-btn" style="background:none; border:none; color: ${hasOlder ? '#111827' : '#d1d5db'}; cursor: ${hasOlder ? 'pointer' : 'default'}; font-weight: bold; font-size: 16px; padding: 0 5px; transition: 0.2s;">&lt;</button>
                    <span style="font-size: 12px; font-weight: 700; color: #51b882; min-width: 80px; text-align: center;">${displayDate}</span>
                    <button id="stats-next-btn" style="background:none; border:none; color: ${hasNewer ? '#111827' : '#d1d5db'}; cursor: ${hasNewer ? 'pointer' : 'default'}; font-weight: bold; font-size: 16px; padding: 0 5px; transition: 0.2s;">&gt;</button>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 10px;">
                <div style="background: white; border-radius: 16px; padding: 15px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="font-size: 11px; font-weight: 700; color: #8c929c; text-transform: uppercase; margin-bottom: 5px;">Deliveries</div>
                    <div style="font-size: 24px; font-weight: 800; color: #111827;">${stats.deliveries}</div>
                </div>
                
                <div style="background: white; border-radius: 16px; padding: 15px; text-align: center; border: 1px solid #f3f4f6; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                    <div style="font-size: 11px; font-weight: 700; color: #8c929c; text-transform: uppercase; margin-bottom: 5px;">Earnings</div>
                    <div style="font-size: 24px; font-weight: 800; color: #51b882;">M${stats.earnings}</div>
                </div>
            </div>
        `;

        // Re-attach slider listeners (Only if we have dates to slide through)
        if (this.sortedDates.length > 0) {
            document.getElementById('stats-prev-btn').addEventListener('click', () => {
                if (hasOlder) {
                    this.currentDateIndex++; 
                    this.paintAnalyticsGrid(today, week, month, total, deliveries);
                }
            });

            document.getElementById('stats-next-btn').addEventListener('click', () => {
                if (hasNewer) {
                    this.currentDateIndex--; 
                    this.paintAnalyticsGrid(today, week, month, total, deliveries);
                }
            });
        }
    },

    /**
     * Handles updating core profile data securely.
     */
    async editProfile() {
        const currentData = JSON.parse(localStorage.getItem('user_profile')) || {};
        const newName = prompt("Enter your full name:", currentData.name || "");
        if (newName === null) return; 

        const newPhone = prompt("Enter your general contact number:", currentData.phone || "");
        if (newPhone === null) return; 

        if (newName.trim() && newPhone.trim()) {
            const dbData = this.userType === 'driver' ? 
                { fullName: newName.trim(), phoneNumber: newPhone.trim() } : 
                { name: newName.trim(), phone: newPhone.trim() };

            try {
                this._notify("Saving updates...");
                const docRef = doc(this.db, this.collectionPath, this.userId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) await updateDoc(docRef, dbData);
                else await setDoc(docRef, dbData);
                this._notify("Profile updated successfully!");
            } catch (e) {
                console.error("[ProfileManager] Update failed:", e);
                this._notify("Failed to save profile. Please check connection.");
            }
        }
    },

    /**
     * Attaches interactive DOM event listeners post-render.
     */
    setupEventListeners() {
        const editCard = document.getElementById('edit-profile-card');
        if (editCard) editCard.onclick = () => this.editProfile();

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.onclick = () => {
            if (this.logoutHook) this.logoutHook();
        };
    },

    _escapeHtml(unsafe) {
        if (!unsafe) return "";
        return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },

    _notify(message) {
        if (typeof window.showToast === 'function') window.showToast(message);
        else alert(message); 
    }
};

