/**
 * walletManager.js
 * Handles secure driver withdrawals and financial transactions.
 */
export async function requestWithdrawal(driverId) {
    if (!driverId) {
        if (window.showToast) window.showToast("You must be logged in to withdraw funds.");
        return;
    }

    const withdrawBtn = document.getElementById('withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.disabled = true;
        withdrawBtn.innerText = "Processing...";
    }

    try {
        const awsApiUrl = "https://u9o1zxrb58.execute-api.eu-north-1.amazonaws.com/default/ctobopenaip";

        const response = await fetch(awsApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ driverId: driverId })
        });

        const data = await response.json();

        if (response.ok) {
            alert(`Success! M${data.amount} has been sent to your M-Pesa account. \nRef: ${data.ref}`);
        } else {
            if (window.showToast) window.showToast("Withdrawal Failed: " + (data.error || "Unknown error"));
            console.error("M-Pesa Error Details:", data.details);
        }
    } catch (error) {
        if (window.showToast) window.showToast("Network Error. Please try again.");
        console.error(error);
    } finally {
        if (withdrawBtn) {
            withdrawBtn.disabled = false;
            withdrawBtn.innerText = "Withdraw Earnings";
        }
    }
}

