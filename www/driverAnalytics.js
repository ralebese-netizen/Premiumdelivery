// driverAnalytics.js
// Driver earnings analytics — grouped by day, computed from completed orders.

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// --- MODULE STATE ---
let dailyStats = {};
let sortedDates = [];
let currentDateIndex = 0;
let targetContainer = "";
let navBound = false;

// 60s cache so reopening the profile modal doesn't hit Firestore again
let statsCache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 60_000;

// --- HELPERS ---

// Robust date parser: handles Firestore Timestamp, Unix ms, numeric strings, Date
function toDateKey(rawDate) {
    if (rawDate === undefined || rawDate === null) return null;

    let d;
    if (typeof rawDate.toDate === 'function') {
        d = rawDate.toDate();                                  // Firestore Timestamp
    } else if (typeof rawDate.toMillis === 'function') {
        d = new Date(rawDate.toMillis());                      // Firestore Timestamp (alt)
    } else if (typeof rawDate === 'number') {
        d = new Date(rawDate);                                 // Unix ms
    } else if (typeof rawDate === 'string' && rawDate.trim() !== '' && !isNaN(rawDate)) {
        d = new Date(Number(rawDate));                         // Numeric string
    } else if (rawDate instanceof Date) {
        d = rawDate;
    } else {
        return null;
    }

    if (!d || isNaN(d.getTime())) return null;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Try completedAt → createdAt → timestamp
function getOrderDateKey(orderData) {
    if (!orderData) return null;
    return toDateKey(orderData.completedAt)
        || toDateKey(orderData.createdAt)
        || toDateKey(orderData.timestamp);
}

// NaN-safe fee parser
function parseFee(rawFee) {
    if (rawFee === undefined || rawFee === null || rawFee === '') return 0;
    if (typeof rawFee === 'number') return isFinite(rawFee) ? rawFee : 0;
    const cleaned = parseFloat(String(rawFee).replace(/[^\d.]/g, ''));
    return isFinite(cleaned) ? cleaned : 0;
}

function getDeliveryFee(data) {
    return parseFee(data.deliveryFee)
        || parseFee(data.delivery_fee)
        || parseFee(data.DeliveryFee)
        || parseFee(data.baseDeliveryFee);
}

// Single source of truth for earnings math
function calculateDriverEarnings(data) {
    // If a payout was already settled, trust it
    if (data.driverPayoutAmount !== undefined && data.driverPayoutAmount !== null) {
        const stored = parseFee(data.driverPayoutAmount);
        if (isFinite(stored)) return stored;
    }
    const fee = getDeliveryFee(data);
    const tip = parseFee(data.tipAmount);
    const adminCut = Math.ceil(fee * 0.01);
    return Math.floor(fee * 0.95) + tip - adminCut;
}

// --- PUBLIC API ---

/**
 * Load driver stats and render them into the given container.
 * @param {object} db - Firestore instance
 * @param {string} driverId - The driver's UID
 * @param {string} containerId - DOM element ID to render into
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false] - Bypass the cache
 */
export async function loadDriverStats(db, driverId, containerId, options = {}) {
    targetContainer = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Serve from cache if fresh
    const cacheFresh = statsCache.data && (Date.now() - statsCache.timestamp) < CACHE_TTL_MS;

    if (cacheFresh && !options.forceRefresh) {
        dailyStats = statsCache.data.dailyStats;
        sortedDates = statsCache.data.sortedDates;
        currentDateIndex = 0;

        if (sortedDates.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 24px;">No completed deliveries yet.</p>';
            return;
        }
        renderStatsUI();
        return;
    }

    container.innerHTML = '<p style="color: #6b7280; font-size: 13px; text-align: center;">Loading your performance stats...</p>';

    try {
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "==", "Completed")
        );

        const snapshot = await getDocs(q);
        dailyStats = {};

        snapshot.forEach(docSnap => {
            const data = docSnap.data();

            // Skip orders we can't date — no "Unknown Date" bucket
            const dateKey = getOrderDateKey(data);
            if (!dateKey) return;

            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = { deliveries: 0, earnings: 0 };
            }

            dailyStats[dateKey].deliveries++;
            dailyStats[dateKey].earnings += calculateDriverEarnings(data);
        });

        sortedDates = Object.keys(dailyStats).sort((a, b) => b.localeCompare(a));
        currentDateIndex = 0;

        // Store in cache
        statsCache = {
            data: { dailyStats, sortedDates },
            timestamp: Date.now()
        };

        if (sortedDates.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 24px;">No completed deliveries yet.</p>';
            return;
        }

        renderStatsUI();

    } catch (error) {
        console.error("[Analytics] Error loading stats:", error);
        container.innerHTML = '<p style="color: #ef4444; font-size: 13px; text-align: center;">Failed to load stats. Check connection.</p>';
    }
}

/**
 * Invalidate the cache — call this after a delivery completes so the next
 * profile modal open shows fresh data.
 */
export function invalidateStatsCache() {
    statsCache = { data: null, timestamp: 0 };
}

// --- RENDERING ---

function renderStatsUI() {
    const container = document.getElementById(targetContainer);
    if (!container) return;

    const currentDateKey = sortedDates[currentDateIndex];
    const stats = dailyStats[currentDateKey];
    const displayDate = formatDisplayDate(currentDateKey);

    const hasOlder = currentDateIndex < sortedDates.length - 1;
    const hasNewer = currentDateIndex > 0;

    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; margin-top: 0;">
            <div class="section-title" style="margin: 0;">Daily Earnings</div>

            <div style="display: flex; align-items: center; gap: 10px; background: white; padding: 4px 12px; border-radius: 20px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <button id="stats-prev-btn" style="background:none; border:none; color: ${hasOlder ? '#111827' : '#d1d5db'}; cursor: ${hasOlder ? 'pointer' : 'default'}; font-weight: bold; font-size: 16px; padding: 0 5px; transition: 0.2s;">&lt;</button>
                <span style="font-size: 12px; font-weight: 700; color: #51b882; min-width: 80px; text-align: center;">${displayDate}</span>
                <button id="stats-next-btn" style="background:none; border:none; color: ${hasNewer ? '#111827' : '#d1d5db'}; cursor: ${hasNewer ? 'pointer' : 'default'}; font-weight: bold; font-size: 16px; padding: 0 5px; transition: 0.2s;">&gt;</button>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 24px;">
            <div style="background: white; padding: 20px 15px; border-radius: 16px; border: 1px solid #e5e7eb; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; font-weight: 700; color: #8c929c; text-transform: uppercase; margin-bottom: 5px;">Deliveries</div>
                <div style="font-size: 28px; font-weight: 800; color: #111827; letter-spacing: -1px;">${stats.deliveries}</div>
            </div>
            <div style="background: white; padding: 20px 15px; border-radius: 16px; border: 1px solid #e5e7eb; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.02);">
                <div style="font-size: 11px; font-weight: 700; color: #8c929c; text-transform: uppercase; margin-bottom: 5px;">Earnings</div>
                <div style="font-size: 28px; font-weight: 800; color: #51b882; letter-spacing: -1px;">M${stats.earnings}</div>
            </div>
        </div>
    `;

    // Bind nav handler once via delegation — survives innerHTML rewrites
    if (!navBound) {
        container.addEventListener('click', handleNavClick);
        navBound = true;
    }
}

function handleNavClick(e) {
    const id = e.target.id;
    if (id === 'stats-prev-btn' && currentDateIndex < sortedDates.length - 1) {
        currentDateIndex++;
        renderStatsUI();
    } else if (id === 'stats-next-btn' && currentDateIndex > 0) {
        currentDateIndex--;
        renderStatsUI();
    }
}

function formatDisplayDate(dateKey) {
    if (!dateKey || dateKey === "Unknown Date") return "Unknown";
    const [y, m, d] = dateKey.split('-');
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
    });
}
