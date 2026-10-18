// authManager/register.js
//
// Driver registration.
//
// Flow:
//   1. Create the Firebase Auth user
//   2. Upload the ID photo to Storage
//   3. Upload the selfie to Storage
//   4. Write the driver profile to Firestore
//
// 🔒 Cleanup guarantee:
//
//   If we create an auth user and any subsequent step fails, we delete
//   the auth user so the email isn't orphaned. Without this, retrying
//   registration with the same email hits auth/email-already-in-use and
//   the driver is permanently locked out.

import {
    createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
    doc, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

/**
 * Registers a new driver.
 */
export async function registerDriver(
    auth, db, storage,
    email, password, driverDetails,
    idPhotoFile, selfieFile, statusEl,
) {
    let createdAuthUser = false;

    const setStatus = (text) => {
        if (!statusEl) return;
        statusEl.style.display = 'block';
        statusEl.innerText = text;
    };

    const clearStatus = (delayMs = 0) => {
        if (!statusEl) return;
        if (delayMs > 0) {
            setTimeout(() => { statusEl.style.display = 'none'; }, delayMs);
        } else {
            statusEl.style.display = 'none';
        }
    };

    try {
        // A. Create the auth user
        setStatus("Creating account...");
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const user = credential.user;
        createdAuthUser = true;

        // B. Upload the ID photo
        let idPhotoUrl = "";
        if (idPhotoFile) {
            setStatus("Uploading ID Photo...");
            const idRef = ref(storage, `driver_docs/${user.uid}_ID_${idPhotoFile.name}`);
            await uploadBytes(idRef, idPhotoFile);
            idPhotoUrl = await getDownloadURL(idRef);
        }

        // C. Upload the selfie
        let selfieUrl = "";
        if (selfieFile) {
            setStatus("Uploading Selfie...");
            const selfieRef = ref(storage, `driver_docs/${user.uid}_Selfie_${selfieFile.name}`);
            await uploadBytes(selfieRef, selfieFile);
            selfieUrl = await getDownloadURL(selfieRef);
        }

        // D. Write the driver profile to Firestore
        setStatus("Saving profile details...");
        await setDoc(doc(db, "drivers", user.uid), {
            ...driverDetails,
            email,
            documents: { idPhotoUrl, selfieUrl },
            isPriority: false,
            createdAt: serverTimestamp(),
        });

        clearStatus();
        return { success: true, user };

    } catch (error) {
        console.error("Registration failed:", error);

        // 🟢 Roll back the orphaned auth user, if we created one
        if (createdAuthUser) {
            try {
                const currentUser = auth.currentUser;
                if (currentUser && currentUser.email === email) {
                    await currentUser.delete();
                    console.log("[Auth] Cleaned up orphaned auth user:", email);
                }
            } catch (cleanupErr) {
                console.error("[Auth] Could not clean up orphaned user:", cleanupErr);
            }
        }

        if (statusEl) {
            statusEl.innerText = "Error: " + error.message;
            clearStatus(4000);
        }

        return { success: false, error: error.message };
    }
}
