import admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
}

const db = admin.firestore();
const storage = admin.storage();

export default db;
export { storage };
