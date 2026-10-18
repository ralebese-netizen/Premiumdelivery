// driver/js/firebase-init.js
// Central Firebase bootstrap. Every other module imports from here.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getMessaging } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDEWFybj_bQMCn8QNvc5uSeriwmen-ZfWQ",
    authDomain: "agile-skyline-489209-t3.firebaseapp.com",
    projectId: "agile-skyline-489209-t3",
    storageBucket: "agile-skyline-489209-t3.firebasestorage.app",
    messagingSenderId: "490119776359",
    appId: "1:490119776359:web:c940ba8ddb2cc2fd182cc2"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const messaging = getMessaging(app);
export const storage = getStorage(app);
