// src/firebase/config.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCqpGGS80dg03Z3QcK_18Vyvg1irnDjYY8",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "menu-allergen.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "menu-allergen",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "menu-allergen.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "878342068735",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:878342068735:web:44a77138f725d986322fca"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
