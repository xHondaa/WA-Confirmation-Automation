import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";

if (!getApps().length) {
  initializeApp({
    credential: require("firebase-admin").credential.applicationDefault(),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const snapshot = await db.collection("messages").get();
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json(data);
    } catch (error) {
      console.error("Error fetching messages:", error);
      return res.status(500).send("Error fetching messages");
    }
  } else {
    return res.status(405).send("Method Not Allowed");
  }
}
