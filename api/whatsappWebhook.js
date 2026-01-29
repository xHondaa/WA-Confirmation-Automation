import db from "../firebaseAdmin.js"; // ✅ Admin SDK
import axios from "axios";
import { updateShopifyOrderTag } from "./updateShopify.js";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

// WhatsApp Graph API base
const WHATSAPP_API_URL = `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

const isBeta = () => String(process.env.BETA_TESTING || "").toLowerCase() === "true";
const getTestPhoneDigits = () => (process.env.TEST_PHONE || "").replace(/[^0-9]/g, "");
const toDigits = (s) => (s || "").replace(/[^0-9]/g, "");

async function sendTextRaw(toDigitsVal, body) {
    if (!toDigitsVal) return;
    try {
        const response = await axios.post(
            WHATSAPP_API_URL,
            {
                messaging_product: "whatsapp",
                to: toDigitsVal,
                type: "text",
                text: { body }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );
        return response.data;
    } catch (e) {
        console.warn("⚠️ Failed to send text (beta/raw):", e.response?.data || e.message);
        return null;
    }
}

async function sendTextMessageBeta(to, body, meta = {}) {
    const originalToDigits = toDigits(to);
    const response = await sendTextRaw(originalToDigits, body);

    // Log outbound text message with status tracking
    try {
        const messageId = response?.messages?.[0]?.id;
        await db.collection("whatsappMessages").add({
            customer: originalToDigits,
            message_type: "text",
            text: body,
            direction: "outbound",
            order_number: meta.order_number || null,
            message_id: messageId || null,
            status: "sent",
            status_updated_at: new Date().toISOString(),
            timestamp: new Date().toISOString(),
        });
    } catch (logErr) {
        console.warn("⚠️ Failed to log outbound text message:", logErr);
    }

    // Mirror to tester if beta
    if (isBeta()) {
        const tester = getTestPhoneDigits();
        if (tester && tester !== originalToDigits) {
            const summaryLines = [
                "[BETA OUTGOING COPY]",
                `To: +${originalToDigits}`,
                meta.name ? `Name: ${meta.name}` : null,
                meta.order_number ? `Order: ${meta.order_number}` : null,
                meta.template ? `Template: ${meta.template}` : null,
                meta.language ? `Lang: ${meta.language}` : null,
                meta.type ? `Type: ${meta.type}` : "Type: text"
            ].filter(Boolean);
            const summary = summaryLines.join("\n");
            await sendTextRaw(tester, `${summary}\n\n${body}`);
        }
    }
}

async function getLatestConfirmation(phone_e164) {
    try {
        const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
        const snap = await db
            .collection(COL)
            .where("phone_e164", "==", phone_e164)
            .orderBy("confirmation_sent_at", "desc")
            .limit(1)
            .get();
        return snap.empty ? {} : (snap.docs[0].data() || {});
    } catch (e) {
        console.warn("⚠️ Failed to fetch latest confirmation for", phone_e164, e);
        return {};
    }
}

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

            const from = message.from; // WhatsApp wa_id, usually digits without +
            const phone_e164 = from?.startsWith("+") ? from : `+${from}`;

            // Support interactive quick reply buttons and plain text/buttons
            const interactive = message.interactive;
            const buttonTitle = interactive?.button_reply?.title || message.button?.text || "";
            const buttonId = interactive?.button_reply?.id || message.button?.payload || "";
            const textBody = message.text?.body || "";

            // Raw button/text for exact Arabic match (do not lowercase)
            const rawInput = (buttonTitle || buttonId || textBody || "").trim();

            // Log every inbound message separately for analytics/traceability
            try {
                // Get order_number from latest confirmation for this customer
                let orderNumber = null;
                try {
                    const docData = await getLatestConfirmation(phone_e164);
                    orderNumber = docData.order_number || null;
                } catch (e) {
                    console.warn("⚠️ Could not fetch order_number for inbound log:", e);
                }

                await db.collection("whatsappMessages").add({
                    customer: from,
                    message_type: message.type || null,
                    text: textBody || null,
                    button_title: buttonTitle || null,
                    button_id: buttonId || null,
                    raw: message,
                    direction: "inbound",
                    order_number: orderNumber,
                    timestamp: new Date().toISOString(),
                });
            } catch (logErr) {
                console.warn("⚠️ Failed to log inbound message:", logErr);
            }

            // BETA: mirror incoming to tester
            try {
                if (isBeta()) {
                    const tester = getTestPhoneDigits();
                    const senderDigits = toDigits(from);
                    if (tester && tester !== senderDigits) {
                        const docData = await getLatestConfirmation(phone_e164);
                        const hasDoc = docData && Object.keys(docData).length > 0;
                        const lines = [
                            "[BETA INCOMING COPY]",
                            `From: ${phone_e164}`,
                            hasDoc ? null : "No Firestore entry found for this number.",
                            docData.name ? `Name: ${docData.name}` : null,
                            docData.order_number ? `Order: ${docData.order_number}` : null,
                            `Type: ${message.type || 'unknown'}`,
                            `Text/Button: ${rawInput || '(none)'}`,
                            `Timestamp: ${new Date().toISOString()}`
                        ].filter(Boolean);
                        await sendTextRaw(tester, lines.join("\n"));
                    }
                }
            } catch (e) {
                console.warn("⚠️ Failed to mirror inbound to tester:", e);
            }

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
                        address: (docData.address && String(docData.address).trim()) || "N/A",
                        price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
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

            // English cancellation and navigation buttons
            const isInitCancelEn = userInputLower === "no, cancel or edit order"; // initial cancel from confirmation template
            const isSecondaryCancelEn = userInputLower === "cancel order"; // button inside cancellation template
            const isGoBackEn = userInputLower === "go back"; // inside cancellation template to return to confirmation

            // Arabic cancel trigger (initial)
            const isConfirm =
                userInputLower === "yes, confirm order" ||
                userInputLower === "confirm" ||
                userInputLower.includes("confirm order");
            // const isCancel =
            //     userInputLower === "no, cancel order" ||
            //     userInputLower === "cancel" ||
            //     userInputLower.includes("cancel order");
            const isReschedule =
                userInputLower === "i want to reschedule" ||
                userInputLower.includes("reschedule");
            const isTalkHuman =
                userInputLower === "i want to talk to a human" ||
                userInputLower.includes("talk to a human");

// Arabic buttons (use rawInput for exact match)
            const isArConfirm = rawInput === "ايوه، أكد الطلب";
            // Initial Arabic cancel/edit trigger from confirmation template
            const isInitCancelAr = rawInput === "لأ، عدل او الغي الطلب";
            // Inside Arabic cancellation template buttons
            const isArCancelProceed = rawInput === "الغي الاوردر";
            const isArEdit = rawInput === "اعدل الاوردر";
            const isArBack = rawInput === "الرجوع";
            const isArReschedule = rawInput === "عايز اأجل الطلب";
            const isArTalkHuman = rawInput === "عايز اكلم بني ادم";
            const isBackToEnglish = rawInput === "Change back to English"; // Arabic flow button

            // Go back (EN): resend original confirmation template
            if (isGoBackEn) {
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
                        address: (docData.address && String(docData.address).trim()) || "N/A",
                        price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
                    };

                    await sendWhatsappTemplate(phone_e164, "order_confirmation", variables);
                } catch (err) {
                    console.error("❌ Error sending order_confirmation on Go back:", err.response?.data || err);
                }
                return res.status(200).send("OK");
            }

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
                        address: (docData.address && String(docData.address).trim()) || "N/A",
                        price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
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
                        address: (docData.address && String(docData.address).trim()) || "N/A",
                        price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
                    };

                    const shippingTemplate = language === "ar" ? "order_shipping_ar" : "order_shipping_en";
                    await sendWhatsappTemplate(phone_e164, shippingTemplate, variables);
                    console.log(`📦 Sent shipping template (${shippingTemplate}) to ${phone_e164}`);
                } catch (logErr) {
                    console.error("⚠️ Post-confirmation handling failed:", logErr);
                }
            } else if (isInitCancelEn || isInitCancelAr) {
                // Step 1: send the cancellation template (EN/AR)
                try {
                    const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                    const snap = await db
                        .collection(COL)
                        .where("phone_e164", "==", phone_e164)
                        .orderBy("confirmation_sent_at", "desc")
                        .limit(1)
                        .get();

                    if (!snap.empty) {
                        const docData = snap.docs[0].data();

                        const variables = {
                            orderid: String(docData.order_number || ""),
                            name: (docData.name?.split(" ")[0] || docData.name || "Customer"),
                            address: (docData.address && String(docData.address).trim()) || "N/A",
                            price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
                        };

                        const tmpl = isInitCancelEn ? "order_cancellation_en" : "order_cancellation_ar";
                        await sendWhatsappTemplate(phone_e164, tmpl, variables);
                        console.log(`🛑 Sent cancellation template (${tmpl}) to ${phone_e164} for order ${variables.orderid}`);
                    } else {
                        console.log(`⚠️ No order found for ${phone_e164} to cancel`);
                    }

                } catch (error) {
                    console.error("❌ Error sending cancellation template:", error.response?.data || error);
                }
            } else if (isSecondaryCancelEn) {
                // Step 2 (EN): Cancel Order button inside the cancellation template
                try {
                    // Pull latest confirmation for metadata
                    const docData = await getLatestConfirmation(phone_e164);
                    const orderId = docData.order_id;
                    const orderNumber = docData.order_number ? String(docData.order_number) : "";

                    const shop = `${process.env.SHOPIFY_STORE}.myshopify.com`;
                    const token = process.env.SHOPIFY_API_KEY;
                    let fulfilled = false;
                    if (orderId && shop && token) {
                        try {
                            const getRes = await axios.get(
                                `https://${shop}/admin/api/2024-07/orders/${orderId}.json?fields=id,fulfillment_status,fulfillments`,
                                { headers: { "X-Shopify-Access-Token": token } }
                            );
                            const ord = getRes.data?.order;
                            const status = ord?.fulfillment_status || null;
                            fulfilled = status === 'fulfilled' || status === 'partially_fulfilled';
                        } catch (e) {
                            console.warn("⚠️ Could not fetch Shopify order for cancel decision:", e.response?.data || e.message);
                        }
                    }

                    if (fulfilled) {
                        const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                        const txt = `I want to cancel my order#${orderNumber}`;
                        const link = supportDigits ? `https://wa.me/${supportDigits}?text=${encodeURIComponent(txt)}` : `https://wa.me/201113315213?text=${encodeURIComponent(txt)}`;
                        const body = `Unfortunately your order has already been shipped and can't be automatically cancelled, if you still wish to cancel your order please contact our customer support from here ${link}`;
                        await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });
                    } else {
                        // Not fulfilled → mark cancelled, notify support, and inform the customer
                        await updateShopifyOrderTag(from, "cancelled");
                        const body = "Your order has been canceled";
                        await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });

                        // Existing support message
                        try {
                            const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                            const supportBody = `Order cancellation request from customer ${from}.`;
                            await sendTextMessageBeta(supportDigits, supportBody, { type: 'text', order_number: orderNumber });
                            console.log(`📩 Notified support of cancellation for customer ${from}`);
                        } catch (e) {
                            console.error("❌ Error notifying support:", e.response?.data || e);
                        }
                    }
                } catch (error) {
                    console.error("❌ Error handling secondary cancel:", error.response?.data || error);
                }
            } else if (isArBack) {
                // AR: Back inside cancellation → resend Arabic confirmation
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
                        address: (docData.address && String(docData.address).trim()) || "N/A",
                        price: (docData.price != null && String(docData.price).trim() !== "" ? String(docData.price) : "0"),
                    };
                    await sendWhatsappTemplate(phone_e164, "order_confirmation_ar", variables);
                } catch (error) {
                    console.error("❌ Error resending Arabic confirmation:", error.response?.data || error);
                }
            } else if (isArCancelProceed) {
                // AR: Cancel proceed inside cancellation template
                try {
                    const docData = await getLatestConfirmation(phone_e164);
                    const orderId = docData.order_id;
                    const orderNumber = docData.order_number ? String(docData.order_number) : "";

                    const shop = `${process.env.SHOPIFY_STORE}.myshopify.com`;
                    const token = process.env.SHOPIFY_API_KEY;
                    let fulfilled = false;
                    if (orderId && shop && token) {
                        try {
                            const getRes = await axios.get(
                                `https://${shop}/admin/api/2024-07/orders/${orderId}.json?fields=id,fulfillment_status,fulfillments`,
                                { headers: { "X-Shopify-Access-Token": token } }
                            );
                            const ord = getRes.data?.order;
                            const status = ord?.fulfillment_status || null;
                            fulfilled = status === 'fulfilled' || status === 'partially_fulfilled';
                        } catch (e) {
                            console.warn("⚠️ Could not fetch Shopify order for AR cancel decision:", e.response?.data || e.message);
                        }
                    }

                    if (fulfilled) {
                        const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                        const txt = `عايز الغي الاوردر، رقم الاوردر ${orderNumber}`;
                        const link = supportDigits ? `https://wa.me/${supportDigits}?text=${encodeURIComponent(txt)}` : `https://wa.me/201113315213?text=${encodeURIComponent(txt)}`;
                        const body = `للأسف طلبك اتشحن خلاص ومش بيتلغي أوتوماتيك، لو لسه حابب تلغي الطلب كلم خدمة العملاء من هنا.\n${link}`;
                        await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });
                    } else {
                        await updateShopifyOrderTag(from, "Cancelled_Order");
                        const body = "الاوردر اتلغى";
                        await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });
                        // Notify support with current cancellation message
                        try {
                            const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                            const supportBody = `Order cancellation request from customer ${from}.`;
                            await sendTextMessageBeta(supportDigits, supportBody, { type: 'text', order_number: orderNumber });
                        } catch (e) {
                            console.error("❌ Error notifying support (AR):", e.response?.data || e);
                        }
                    }
                } catch (error) {
                    console.error("❌ Error handling AR cancel proceed:", error.response?.data || error);
                }
            } else if (isArEdit) {
                // AR: Edit inside cancellation template
                try {
                    const docData = await getLatestConfirmation(phone_e164);
                    const orderNumber = docData.order_number ? String(docData.order_number) : "";
                    const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                    const txt = `عايز اعدل الطلب ${orderNumber ? `#${orderNumber}` : ""}`.trim();
                    const link = supportDigits ? `https://wa.me/${supportDigits}?text=${encodeURIComponent(txt)}` : `https://wa.me/201113315213?text=${encodeURIComponent(txt)}`;
                    const body = `لو حابب تعدل على طلبك كلم خدمة العملاء من هنا وقولهم التعديل.\n${link}`;
                    await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });
                } catch (error) {
                    console.error("❌ Error sending AR edit link:", error.response?.data || error);
                }
            } else if (userInputLower === "edit order") {
                // Edit Order: send link with prefilled text including order number
                try {
                    const docData = await getLatestConfirmation(phone_e164);
                    const orderNumber = docData.order_number ? String(docData.order_number) : "";
                    const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                    const txt = `I want to edit Order #${orderNumber}`.trim();
                    const link = supportDigits ? `https://wa.me/${supportDigits}?text=${encodeURIComponent(txt)}` : `https://wa.me/201113315213?text=${encodeURIComponent(txt)}`;
                    const body = `If you wish to edit your order please contact the customer support from here with your edit ${link}`;
                    await sendTextMessageBeta(phone_e164, body, { type: 'text', order_number: orderNumber });
                } catch (error) {
                    console.error("❌ Error sending edit order link:", error.response?.data || error);
                }
            } else if (isReschedule || isArReschedule) {
                // Send reschedule link (dynamic SUPPORT_PHONE and include order number in text) with EN/AR variants
                try {
                    const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");

                    // Fetch the latest order_number for this customer
                    let orderNumber = "";
                    try {
                        const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                        const snap = await db
                            .collection(COL)
                            .where("phone_e164", "==", phone_e164)
                            .orderBy("confirmation_sent_at", "desc")
                            .limit(1)
                            .get();
                        const docData = snap.empty ? {} : (snap.docs[0].data() || {});
                        orderNumber = docData.order_number ? String(docData.order_number) : "";
                    } catch (e) {
                        console.warn("⚠️ Could not fetch order_number for reschedule:", e);
                    }

                    const isArabic = !!isArReschedule;
                    const text = isArabic
                        ? `عايز اأجل الطلب${orderNumber ? ` رقم #${orderNumber}` : ""}`
                        : `I want to reschedule${orderNumber ? ` Order #${orderNumber}` : ""}`;
                    const link = supportDigits ? `https://wa.me/${supportDigits}?text=${encodeURIComponent(text)}` : null;
                    const body = link
                        ? (isArabic
                            ? `أجل طلبك من هنا:\n${link}`
                            : `Reschedule your delivery:\n${link}`)
                        : (isArabic
                            ? "اتواصل معانا على الرقم ده 01113331259."
                            : "Contact us through this number 01113331259.");

                    await sendTextMessageBeta(phone_e164, body, { type: 'text' });

                    // Log reschedule event separately
                    try {
                        await db.collection("whatsappInteractions").add({
                            customer: from,
                            event: "reschedule",
                            language: isArabic ? "ar" : "en",
                            order_number: orderNumber || null,
                            timestamp: new Date().toISOString(),
                        });
                    } catch (e) {
                        console.warn("⚠️ Failed to log reschedule event:", e);
                    }

                    console.log(`🗓️ Sent reschedule link to ${phone_e164}`);
                } catch (err) {
                    console.error("❌ Error sending reschedule link:", err.response?.data || err);
                }
            } else if (isTalkHuman || isArTalkHuman) {
                // Send contact human link (dynamic SUPPORT_PHONE) with EN/AR variants
                try {
                    const supportDigits = (process.env.SUPPORT_PHONE || "").replace(/[^0-9]/g, "");
                    const isArabic = !!isArTalkHuman;

                    // Optionally include order number in the event log (not needed in the link)
                    let orderNumber = "";
                    try {
                        const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
                        const snap = await db
                            .collection(COL)
                            .where("phone_e164", "==", phone_e164)
                            .orderBy("confirmation_sent_at", "desc")
                            .limit(1)
                            .get();
                        const docData = snap.empty ? {} : (snap.docs[0].data() || {});
                        orderNumber = docData.order_number ? String(docData.order_number) : "";
                    } catch (e) {
                        console.warn("⚠️ Could not fetch order_number for talk-to-human:", e);
                    }

                    const link = supportDigits ? `https://wa.me/${supportDigits}` : null;
                    const body = link
                        ? (isArabic
                            ? `كلم خدمة العملاء:\n${link}`
                            : `Contact Customer Support:\n${link}\n\nTap the link to start a chat with our team.`)
                        : (isArabic
                            ? "اتواصل معانا على الرقم ده 01113331259."
                            : "Contact us through this number 01113331259.");

                    await sendTextMessageBeta(phone_e164, body, { type: 'text' });

                    // Log talk_to_human event separately
                    try {
                        await db.collection("whatsappInteractions").add({
                            customer: from,
                            event: "talk_to_human",
                            language: isArabic ? "ar" : "en",
                            order_number: orderNumber || null,
                            timestamp: new Date().toISOString(),
                        });
                    } catch (e) {
                        console.warn("⚠️ Failed to log talk_to_human event:", e);
                    }

                    console.log(`👤 Sent contact support link to ${phone_e164}`);
                } catch (err) {
                    console.error("❌ Error sending support link:", err.response?.data || err);
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
