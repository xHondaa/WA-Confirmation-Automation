import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Webhook verification
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token && mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("Webhook verified ✅");
      res.status(200).send(challenge);
    } else {
      console.warn("Webhook verification failed ❌");
      res.status(403).end("Forbidden");
    }
  } else if (req.method === "POST") {
    console.log("=== Incoming Request ===");
    console.log("Incoming webhook event:", JSON.stringify(req.body, null, 2));

    try {
      const body = req.body;

      if (body.object) {
        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            if (change.field === "messages" && change.value?.messages) {
              for (const message of change.value.messages) {
                const waId = message.from;
                const msgBody = message.text?.body || "";
                const timestamp = message.timestamp;

                console.log(`Message from ${waId}: "${msgBody}"`);

                // Save to Firestore
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
              }
            }
          }
        }

        res.status(200).end("EVENT_RECEIVED");
      } else {
        res.status(404).end("Not Found");
      }
    } catch (error) {
      console.error("Error handling webhook:", error);
      res.status(500).end("Internal Server Error");
    }
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
