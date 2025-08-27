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
            console.log(data);

            const message = data?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
            if (!message) return res.status(200).send("No messages");

            const from = message.from; // WhatsApp wa_id, usually digits without +
            const phone_e164 = from?.startsWith("+") ? from : `+${from}`;

            // Support interactive quick reply buttons and plain text/buttons
            const interactive = message.interactive;
            const buttonTitle = interactive?.button_reply?.title || message.button?.text || "";
            const buttonId = interactive?.button_reply?.id || message.button?.payload || "";
            const textBody = message.text?.body || "";

            // Raw button/text for exact Arabic match (do not lowercase)
            const rawInput = (buttonTitle || buttonId || textBody || "").trim();

            // Handle Arabic language switch
            if (rawInput === "تغيير اللغة الي العربية") {
                try {
                    const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";

                    // Fetch the latest confirmation context for this user
                    const snap = await db
                        .collection(COL)
                        .where("phone_e164", "==", phone_e164)
                        .orderBy("confirmation_sent_at", "desc")
                        .limit(1)
                        .get();

                    const docData = snap.empty ? {} : (snap.docs[0].data() || {});

                    const variables = {
                        orderid: String(docData.order_number || ""),
                        name: (docData.name?.split(" ")[0] || docData.name || "Customer"),
                        address: docData.address || "",
                        price: docData.price || "",
                    };

                    await sendWhatsappTemplate(phone_e164, "order_confirmation_ar", variables);
                    console.log(`✅ Sent Arabic confirmation to ${phone_e164}`);
                } catch (err) {
                    console.error("❌ Error handling Arabic switch:", err.response?.data || err);
                }
                return res.status(200).send("OK");
            }

            // 🔹 Determine button action for English/Arabic flow (supports new button texts)
            const englishInputRaw = (buttonTitle || buttonId || textBody || "").trim();
            const userInputLower = englishInputRaw.toLowerCase();

            // English buttons
            const isConfirm =
                userInputLower === "yes, confirm order" ||
                userInputLower === "confirm" ||
                userInputLower.includes("confirm order");
            const isCancel =
                userInputLower === "no, cancel order" ||
                userInputLower === "cancel" ||
                userInputLower.includes("cancel order");

            // Arabic buttons (use rawInput for exact match)
            const isArConfirm = rawInput === "ايوه، أكد الطلب";
            const isArCancel = rawInput === "لأ، الغي الطلب";
            const isBackToEnglish = rawInput === "Change back to English"; // Arabic flow button

            // Change back to English: resend English template with same variables
            if (isBackToEnglish) {
                try {
                    const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                    const snap = await db
                        .collection(COL)
                        .where("phone_e164", "==", phone_e164)
                        .orderBy("confirmation_sent_at", "desc")
                        .limit(1)
                        .get();

                    const docData = snap.empty ? {} : (snap.docs[0].data() || {});
                    const variables = {
                        orderid: String(docData.order_number || ""),
                        name: (docData.name?.split(" ")[0] || docData.name || "Customer"),
                        address: docData.address || "",
                        price: docData.price || "",
                    };

                    await sendWhatsappTemplate(phone_e164, "order_confirmation", variables);
                    console.log(`🔄 Switched back to English template for ${phone_e164}`);
                } catch (err) {
                    console.error("❌ Error switching back to English:", err.response?.data || err);
                }
                return res.status(200).send("OK");
            }

            if (isConfirm || isArConfirm) {
                // Update Shopify order tag
                await updateShopifyOrderTag(from, "confirmed");
                console.log(`✅ Order confirmed for customer ${from}`);

                // Log a separate confirmation event with language and send shipping template
                try {
                    const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                    const snap = await db
                        .collection(COL)
                        .where("phone_e164", "==", phone_e164)
                        .orderBy("confirmation_sent_at", "desc")
                        .limit(1)
                        .get();
                    const docData = snap.empty ? {} : (snap.docs[0].data() || {});
                    const language = isArConfirm ? "ar" : "en";

                    // Record confirmation event with language
                    await db.collection("whatsappInteractions").add({
                        customer: from,
                        event: "confirmed",
                        language,
                        order_number: docData.order_number || null,
                        timestamp: new Date().toISOString(),
                    });

                    // Build variables for shipping template (reuse same fields)
                    const variables = {
                        orderid: String(docData.order_number || ""),
                        name: (docData.name?.split(" ")[0] || docData.name || "Customer"),
                        address: docData.address || "",
                        price: docData.price || "",
                    };

                    const shippingTemplate = language === "ar" ? "order_shipping_ar" : "order_shipping_en";
                    await sendWhatsappTemplate(phone_e164, shippingTemplate, variables);
                    console.log(`📦 Sent shipping template (${shippingTemplate}) to ${phone_e164}`);
                } catch (logErr) {
                    console.error("⚠️ Post-confirmation handling failed:", logErr);
                }
            } else if (isCancel || isArCancel) {
                // Send alert to support
                try {
                    await axios.post(
                        `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
                        {
                            messaging_product: "whatsapp",
                            to: process.env.SUPPORT_PHONE,
                            type: "text",
                            text: { body: `Order cancellation request from customer ${from}.` }
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
            } else {
                console.log(`ℹ️ Received message from ${from} but no recognized button clicked`);
            }

            // Optional: log button response to Firestore
            await db.collection("whatsappInteractions").add({
                customer: from,
                button: englishInputRaw || rawInput,
                rawMessage: message,
                timestamp: new Date().toISOString()
            });

            return res.status(200).send("OK");
        } catch (error) {
            console.error("❌ Error in whatsappWebhook:", error);
            return res.status(500).send("Error");
        }
    }

    return res.status(405).send("Method not allowed");
}
