// driver/js/withdrawal.js
// M-Pesa withdrawal via the AWS Lambda gateway.

import { showToast } from "./ui.js";

const WITHDRAWAL_ENDPOINT = "https://1668zaqim5.execute-api.eu-north-1.amazonaws.com/default/driverwalletwithdrawal";

export function initWithdrawal() {
    document.getElementById('withdraw-btn').addEventListener('click', requestWithdrawal);
}

export async function requestWithdrawal() {
    if (!window.currentDriverId) return showToast("Must be logged in.");

    const btn = document.getElementById('withdraw-btn');
    btn.disabled = true;
    btn.innerText = "Processing...";

    try {
        const res = await fetch(WITHDRAWAL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driverId: window.currentDriverId })
        });
        const data = await res.json();

        if (res.ok) {
            alert(`Success! M${data.amount} sent to M-Pesa. \nRef: ${data.ref}`);
        } else {
            showToast("Failed: " + (data.error || "Unknown"));
        }
    } catch (e) {
        showToast("Network Error.");
    } finally {
        btn.disabled = false;
        btn.innerText = "Withdraw Earnings";
    }
}
