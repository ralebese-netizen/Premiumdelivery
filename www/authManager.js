/**
 * authManager.js
 * Handles secure authentication, session monitoring, driver registration, and auth UI.
 */
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

export const AuthState = { isProcessingRegistration: false };

export function monitorAuthState(auth, onLoginCallback, onLogoutCallback) {
    onAuthStateChanged(auth, (user) => {
        if (AuthState.isProcessingRegistration) return;
        if (user) onLoginCallback(user);
        else onLogoutCallback();
    });
}

export async function logoutDriver(auth) {
    await signOut(auth);
    localStorage.removeItem('user_profile');
    window.location.reload();
}

export async function loginUser(auth, email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        let errorMsg = error.message;
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            errorMsg = "Incorrect email or password.";
        } else if (error.code === 'auth/network-request-failed') {
            errorMsg = "Network error. Please check your internet connection.";
        } else {
            errorMsg = error.message.replace("Firebase: ", "");
        }
        return { success: false, error: errorMsg };
    }
}

export async function registerDriver(auth, db, storage, email, password, driverDetails, idPhotoFile, selfieFile, statusEl = null) {
    let createdUser = null;
    const updateStatus = (msg) => { if (statusEl) statusEl.innerText = msg; };

    try {
        AuthState.isProcessingRegistration = true;
        updateStatus("Validating documents...");
        updateStatus("Creating secure credentials...");
        
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        createdUser = userCredential.user;

        updateStatus("Initializing driver profile...");
        await setDoc(doc(db, "drivers", createdUser.uid), {
            ...driverDetails, 
            email: email, 
            isPriority: false, 
            createdAt: serverTimestamp(),
            documents: { idPhotoUrl: "pending", selfieUrl: "pending" }
        });

        updateStatus("Uploading documents...");
        const uploadTask = async (file, prefix) => {
            const r = ref(storage, `driver_docs/${createdUser.uid}_${prefix}_${file.name}`);
            await uploadBytes(r, file); 
            return await getDownloadURL(r);
        };

        const [idPhotoUrl, selfieUrl] = await Promise.all([ 
            uploadTask(idPhotoFile, "ID"), 
            uploadTask(selfieFile, "Selfie") 
        ]);

        updateStatus("Finalizing profile...");
        await setDoc(doc(db, "drivers", createdUser.uid), { documents: { idPhotoUrl, selfieUrl } }, { merge: true });

        await signOut(auth); 
        AuthState.isProcessingRegistration = false;
        return { success: true, user: createdUser };
        
    } catch (error) {
        if (createdUser) await deleteUser(createdUser).catch(()=>{});
        AuthState.isProcessingRegistration = false;
        return { success: false, error: error.message };
    }
}

export function setupAuthUI(auth, db, storage) {
    document.getElementById('login-btn')?.addEventListener('click', async () => {
        try { await Notification.requestPermission(); } catch(e) { console.warn(e); }
        
        const email = document.getElementById('email')?.value?.trim();
        const pass = document.getElementById('password')?.value;
        const btn = document.getElementById('login-btn');
        
        if (!email || !pass) return window.showToast ? window.showToast("Please enter email and password.") : alert("Missing credentials");

        btn.disabled = true;
        btn.innerText = "Authenticating...";

        const result = await loginUser(auth, email, pass);
        
        if (!result.success) {
            if (window.showToast) window.showToast(result.error);
            btn.disabled = false;
            btn.innerText = "Secure Login";
        }
    });

    document.getElementById('register-btn')?.addEventListener('click', async () => {
        const email = document.getElementById('reg-email')?.value?.trim();
        const pass = document.getElementById('reg-password')?.value;
        const idPhotoFile = document.getElementById('reg-id-photo')?.files?.[0];
        const selfieFile = document.getElementById('reg-selfie-photo')?.files?.[0];
        const statusEl = document.getElementById('reg-status');
        const registerBtn = document.getElementById('register-btn');

        if (!email || !pass || !idPhotoFile || !selfieFile) {
            if (window.showToast) window.showToast("Please fill in all required fields and upload both photos.");
            return;
        }

        registerBtn.disabled = true;
        registerBtn.innerText = "Uploading Documents...";
        registerBtn.style.opacity = "0.7";
        
        if (statusEl) {
            statusEl.style.display = "block";
            statusEl.style.color = "var(--login-blue)";
            statusEl.innerText = "Creating secure profile...";
        }

        const driverData = {
            fullName: document.getElementById('reg-name')?.value?.trim() || "",
            phoneNumber: document.getElementById('reg-phone')?.value?.trim() || "",
            homeAddress: document.getElementById('reg-address')?.value?.trim() || "",
            emergencyContact: { 
                name: document.getElementById('reg-kin-name')?.value?.trim() || "", 
                phone: document.getElementById('reg-kin-phone')?.value?.trim() || "" 
            },
            vehicle: { 
                type: document.getElementById('reg-vehicle-type')?.value || "N/A", 
                plateNumber: document.getElementById('reg-plate')?.value?.trim() || "N/A"
            },
            status: 'pending'
        };

        const result = await registerDriver(auth, db, storage, email, pass, driverData, idPhotoFile, selfieFile, statusEl);

        registerBtn.disabled = false;
        registerBtn.innerText = "Submit Registration";
        registerBtn.style.opacity = "1";

        if (result.success) {
            if (window.showToast) window.showToast("Account created successfully! Please login.");
            document.getElementById('signup-screen').style.display = 'none'; 
            document.getElementById('login-screen').style.display = 'flex';
            if (statusEl) statusEl.style.display = "none";
        } else {
            if (statusEl) { statusEl.style.color = "#ef4444"; statusEl.innerText = "Error: " + result.error; }
            if (window.showToast) window.showToast("Registration Failed: " + result.error);
        }
    });
}
