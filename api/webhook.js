import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Webhook verification from Meta
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("Webhook verified ✅");
      res.status(200).send(challenge);
    } else {
      console.warn("Webhook verification failed ❌");
      res.sendStatus(403);
    }
  } else if (req.method === "POST") {
    // Incoming webhook event
    console.log("=== Incoming Request ===");
    console.log("Method:", req.method);
    console.log("Full URL:", req.url);
    console.log("Headers:", req.headers);
    console.log("Incoming webhook event:", JSON.stringify(req.body, null, 2));

    try {
      const body = req.body;

      if (body.object) {
        body.entry.forEach((entry) => {
          const changes = entry.changes || [];
          changes.forEach((change) => {
            if (change.field === "messages" && change.value?.messages) {
              change.value.messages.forEach(async (message) => {
                const waId = message.from;
                const msgBody = message.text?.body || "";
                const timestamp = message.timestamp;

                console.log(`Message from ${waId}: "${msgBody}"`);

                // Save to Firebase Firestore (if configured)
                if (admin.apps.length === 0) {
                  admin.initializeApp({
                    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
                  });
                }
                const db = admin.firestore();
                await db.collection("messages").add({
                  waId,
                  msgBody,
                  timestamp,
                  raw: message,
                });
                console.log("Message saved to Firestore ✅");
              });
            }
          });
        });

        res.sendStatus(200);
      } else {
        res.sendStatus(404);
      }
    } catch (error) {
      console.error("Error handling webhook:", error);
      res.sendStatus(500);
    }
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
