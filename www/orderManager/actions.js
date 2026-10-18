import { doc, updateDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { env, state } from "./state.js";
import { mergeAndProcessQueue } from "./queue.js";
import { computeDriverPayout } from "./helpers.js";
import { creditStoreForOrder } from "../driver/js/store-credit.js";
import { getDeviceToken } from "../notificationManager.js";
import { messaging } from "../driver/js/firebase-init.js";
export async function acceptOrder(orderId) { if (state.hasActiveOrder) return; state.hasActiveOrder = true; try { let freshToken = ""; try { freshToken = await getDeviceToken(messaging) || ""; } catch (e) {} const tokenToUse = freshToken || env.driverToken || ""; await updateDoc(doc(env.db, "orders", orderId), { status: 'Accepted', driverId: env.driverId, driverFcmToken: tokenToUse, driverFcmTokenUpdatedAt: new Date().toISOString() }); if (freshToken) env.driverToken = freshToken; } catch (err) { state.hasActiveOrder = false; } }
export function declineOrder(orderId) { state.declinedIds.add(orderId); mergeAndProcessQueue(); }
export async function completeDelivery(orderId) {
    const enteredPin = prompt("Enter the 4-digit PIN provided by the customer:"); if (!enteredPin) return;
    try { const orderSnap = await getDoc(doc(env.db, "orders", orderId)); if (!orderSnap.exists()) return env.onToast("Order not found."); const oData = orderSnap.data(); if (oData.deliveryPin && oData.deliveryPin !== enteredPin) return env.onToast("Incorrect PIN."); const payout = computeDriverPayout(oData); await creditDriverWallet(payout.totalToAdd); await updateDoc(doc(env.db, "orders", orderId), { status: 'Completed', completedAt: new Date().toISOString(), adminCommissionDeducted: payout.adminCommission, driverPayoutAmount: payout.totalToAdd }); const creditResult = await creditStoreForOrder(orderId); env.onToast(payout.totalToAdd > 0 ? `Delivery Complete! M${payout.totalToAdd} added.` : "Delivery Complete!"); } catch (error) { env.onToast("Network error verifying PIN."); }
}
async function creditDriverWallet(totalToAdd) { const ref = doc(env.db, "drivers", env.driverId); if (totalToAdd > 0) await updateDoc(ref, { walletBalance: increment(totalToAdd), deliveriesCount: increment(1) }); else await updateDoc(ref, { deliveriesCount: increment(1) }); }
