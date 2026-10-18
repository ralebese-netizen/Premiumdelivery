import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
export async function registerDriver(auth, db, storage, email, password, driverDetails, idPhotoFile, selfieFile, statusEl) {
    let createdAuthUser = false;
    const setStatus = (text) => { if (!statusEl) return; statusEl.style.display = 'block'; statusEl.innerText = text; };
    const clearStatus = (delayMs = 0) => { if (!statusEl) return; if (delayMs > 0) setTimeout(() => { statusEl.style.display = 'none'; }, delayMs); else statusEl.style.display = 'none'; };
    try {
        setStatus("Creating account..."); const credential = await createUserWithEmailAndPassword(auth, email, password); const user = credential.user; createdAuthUser = true;
        let idPhotoUrl = ""; if (idPhotoFile) { setStatus("Uploading ID Photo..."); const idRef = ref(storage, `driver_docs/${user.uid}_ID_${idPhotoFile.name}`); await uploadBytes(idRef, idPhotoFile); idPhotoUrl = await getDownloadURL(idRef); }
        let selfieUrl = ""; if (selfieFile) { setStatus("Uploading Selfie..."); const selfieRef = ref(storage, `driver_docs/${user.uid}_Selfie_${selfieFile.name}`); await uploadBytes(selfieRef, selfieFile); selfieUrl = await getDownloadURL(selfieRef); }
        setStatus("Saving profile details..."); await setDoc(doc(db, "drivers", user.uid), { ...driverDetails, email, documents: { idPhotoUrl, selfieUrl }, isPriority: false, createdAt: serverTimestamp() });
        clearStatus(); return { success: true, user };
    } catch (error) {
        if (createdAuthUser) { try { const currentUser = auth.currentUser; if (currentUser && currentUser.email === email) await currentUser.delete(); } catch (cleanupErr) {} }
        if (statusEl) { statusEl.innerText = "Error: " + error.message; clearStatus(4000); }
        return { success: false, error: error.message };
    }
}
