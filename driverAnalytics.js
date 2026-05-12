// driverAnalytics.js
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// We store the data globally inside the module so the slider buttons can access it
let dailyStats = {};
let sortedDates = [];
let currentDateIndex = 0; 
let targetContainer = "";

export async function loadDriverStats(db, driverId, containerId) {
    targetContainer = containerId;
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '<p style="color: #6b7280; font-size: 13px; text-align: center;">Loading your performance stats...</p>';

    try {
        const q = query(
            collection(db, "orders"),
            where("driverId", "==", driverId),
            where("status", "==", "Completed") 
        );

        const snapshot = await getDocs(q);

        // Reset our data
        dailyStats = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // 1. Get the Date
                        // 1. Get the Date
            let dateKey = "Unknown Date";
            // Check for createdAt (new app) or timestamp (older tests)
            const orderDate = data.createdAt || data.timestamp;
            
            if (orderDate && orderDate.toDate) {
                const d = orderDate.toDate();

                // Format as YYYY-MM-DD so it sorts correctly (e.g. 2026-04-03)
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                dateKey = `${year}-${month}-${day}`;
            }

            // 2. Create the date entry if it doesn't exist yet
            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = { deliveries: 0, earnings: 0 };
            }

            // 3. Add the stats to that specific date
            dailyStats[dateKey].deliveries++;
            
            if (data.fee) {
                let rawFee = parseFloat(data.fee.replace(/[^\d.]/g, '')) || 0;
                dailyStats[dateKey].earnings += Math.floor(rawFee * 0.95);
            }
        });

        // Sort the dates from Newest to Oldest
        sortedDates = Object.keys(dailyStats).sort((a, b) => b.localeCompare(a));
        currentDateIndex = 0; // Start at the newest date

        if (sortedDates.length === 0) {
            container.innerHTML = '<p style="color: #6b7280; font-size: 13px; text-align: center; margin-bottom: 24px;">No completed deliveries yet.</p>';
            return;
        }

        // Draw the UI
        renderStatsUI();

    } catch (error) {
        console.error("Error loading stats:", error);
        container.innerHTML = '<p style="color: #ef4444; font-size: 13px; text-align: center;">Failed to load stats. Check connection.</p>';
    }
}

// Function to draw the slider and the stats
function renderStatsUI() {
    const container = document.getElementById(targetContainer);
    if (!container) return;

    const currentDateKey = sortedDates[currentDateIndex];
    const stats = dailyStats[currentDateKey];

    // Make the date look pretty (e.g. "Fri, Apr 3")
    let displayDate = "Unknown";
    if (currentDateKey !== "Unknown Date") {
        const [y, m, d] = currentDateKey.split('-');
        displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    // Check if we have older or newer dates to enable/disable the arrows
    const hasOlder = currentDateIndex < sortedDates.length - 1; 
    const hasNewer = currentDateIndex > 0; 

    const html = `
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

    container.innerHTML = html;

    // Attach click listeners to the arrows
    document.getElementById('stats-prev-btn').addEventListener('click', () => {
        if (hasOlder) {
            currentDateIndex++; // Move one day older
            renderStatsUI();
        }
    });

    document.getElementById('stats-next-btn').addEventListener('click', () => {
        if (hasNewer) {
            currentDateIndex--; // Move one day newer
            renderStatsUI();
        }
    });
}
