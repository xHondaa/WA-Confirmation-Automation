import db from "../firebaseAdmin.js"; // ✅ Admin SDK
import axios from "axios";
import { updateShopifyOrderTag } from "./updateShopify.js";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

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
            const message = data?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

            if (!message) return res.status(200).send("No messages");

            const from = message.from;
            const buttonPayload = message.button?.payload;

            if (buttonPayload === "confirm") {
                // Update Shopify order tag
                await updateShopifyOrderTag(from, "confirmed");
                console.log(`✅ Order confirmed for customer ${from}`);
            } else if (buttonPayload === "cancel") {
                // Send alert to support
                try {
                    await axios.post(
                        `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
                        {
                            messaging_product: "whatsapp",
                            to: process.env.SUPPORT_PHONE,
                            type: "text",
                            text: {
                                body: `Order cancellation request from customer ${from}.` // 🔹 Placeholder
                            }
                        },
                        {
                            headers: {
                                Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                                "Content-Type": "application/json"
                            }
                        }
                    );
                    console.log(`📩 Sent cancel request to support for customer ${from}`);
                } catch (error) {
                    console.error("❌ Error sending cancel message:", error.response?.data || error);
                }
            }

            // Optional: log to Firestore (if you want to keep a record of button responses)
            await db.collection("whatsappInteractions").add({
                customer: from,
                button: buttonPayload,
                timestamp: new Date().toISOString()
            });

            return res.status(200).send("OK");
        } catch (error) {
            console.error("❌ Error in whatsappWebhook:", error);
            return res.status(500).send("Error");
        }
    }

    // Method not allowed
    return res.status(405).send("Method not allowed");
}
