import db from "../firebaseAdmin.js";

/**
 * Handles WhatsApp status updates for sent messages
 * Webhook receives: sent, delivered, read, failed statuses
 */
export default async function handler(req, res) {
    if (req.method === "GET") {
        // Verification for WhatsApp webhook
        const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
        return res.status(403).send("Forbidden");
    }

    if (req.method === "POST") {
        try {
            const data = req.body;
            
            // WhatsApp sends status updates in the statuses array
            const statuses = data?.entry?.[0]?.changes?.[0]?.value?.statuses;
            
            if (!statuses || statuses.length === 0) {
                return res.status(200).send("No status updates");
            }

            // Process each status update
            for (const status of statuses) {
                const messageId = status.id;
                const statusType = status.status; // "sent", "delivered", "read", "failed"
                const timestamp = status.timestamp;
                const recipientId = status.recipient_id;

                console.log(`📊 Status update: ${statusType} for message ${messageId} to ${recipientId}`);

                // Update the message status in Firebase
                try {
                    const messagesRef = db.collection("whatsappMessages");
                    const snapshot = await messagesRef
                        .where("message_id", "==", messageId)
                        .limit(1)
                        .get();

                    if (!snapshot.empty) {
                        const docRef = snapshot.docs[0].ref;
                        await docRef.update({
                            status: statusType,
                            status_updated_at: new Date(parseInt(timestamp) * 1000).toISOString(),
                        });
                        console.log(`✅ Updated message ${messageId} status to ${statusType}`);
                    } else {
                        console.warn(`⚠️ Message ${messageId} not found in database`);
                    }
                } catch (updateErr) {
                    console.error(`❌ Failed to update status for message ${messageId}:`, updateErr);
                }

                // Also update the confirmations collection if this was an order confirmation
                try {
                    const confirmationsCol = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                    const confirmSnapshot = await db.collection(confirmationsCol)
                        .where("message_status", "!=", null)
                        .get();

                    // We need to find by customer phone since message_id might not be stored there
                    // This is a limitation - ideally store message_id in confirmations too
                    for (const doc of confirmSnapshot.docs) {
                        const data = doc.data();
                        const phone = data.phone_e164?.replace(/[^0-9]/g, "");
                        if (phone === recipientId) {
                            await doc.ref.update({
                                message_status: statusType,
                                status_updated_at: new Date(parseInt(timestamp) * 1000),
                            });
                        }
                    }
                } catch (confirmErr) {
                    console.warn("⚠️ Failed to update confirmation status:", confirmErr);
                }
            }

            return res.status(200).send("OK");
        } catch (error) {
            console.error("❌ Error in whatsappStatusWebhook:", error);
            return res.status(500).send("Error");
        }
    }

    return res.status(405).send("Method not allowed");
}
