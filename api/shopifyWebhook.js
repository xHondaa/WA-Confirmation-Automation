import db from "../firebaseAdmin.js";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";
import { tagShopifyOrder } from "./updateShopify.js";

// Normalize phone to E.164 format (Egypt country code: +20)
function normalizeE164(raw) {
    if (!raw) return raw;
    let s = String(raw).replace(/[^\d+]/g, "");
    // Remove leading + for processing
    if (s.startsWith("+")) s = s.slice(1);
    // Egyptian numbers: if starts with 0, replace with 20
    if (s.startsWith("0")) s = "20" + s.slice(1);
    // If doesn't start with country code, assume Egypt (20)
    if (!s.startsWith("20")) s = "20" + s;
    return "+" + s;
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    // Extract data from request immediately
    const order = req.body;
    const customer = order.customer || {};

    // Extract customer name
    const firstName =
        customer.first_name ||
        order.billing_address?.first_name ||
        order.shipping_address?.first_name ||
        "Customer";

    const lastName =
        customer.last_name ||
        order.billing_address?.last_name ||
        order.shipping_address?.last_name ||
        "";

    const fullName = `${firstName} ${lastName}`.trim();

    // Extract phone
    const phone =
        customer.phone ||
        customer.default_address?.phone ||
        order.phone ||
        order.billing_address?.phone ||
        order.shipping_address?.phone ||
        null;

    if (!phone) {
        console.warn("⚠️ No phone number found for order", order.id);
        return res.status(200).send("OK"); // Still return 200 to prevent Shopify retries
    }

    // Extract order data
    const orderNumber = order.order_number;
    const orderId = order.id;

    // Build address string
    const addrSrc = order.shipping_address || order.billing_address || {};
    const addressParts = [
        addrSrc.address1,
        addrSrc.address2,
        addrSrc.city,
        addrSrc.province || addrSrc.region,
        addrSrc.zip || addrSrc.postal_code,
        addrSrc.country
    ].filter(Boolean);
    const address = addressParts.join(", ");

    const price = String(order.current_total_price || order.total_price || "");

    // ✅ Respond to Shopify IMMEDIATELY to prevent timeout
    res.status(200).send("OK");

    // 🔄 Process everything else in the background (after response sent)
    processOrder({
        orderId,
        orderNumber,
        phone,
        firstName,
        fullName,
        address,
        price
    }).catch(err => console.error("❌ Background processing error:", err));
}

// Background processing function
async function processOrder({ orderId, orderNumber, phone, firstName, fullName, address, price }) {
    const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
    const phone_e164 = normalizeE164(phone);

    // Check if order already exists (idempotency)
    const existing = await db.collection(COL)
        .where("order_id", "==", orderId)
        .limit(1)
        .get();

    if (!existing.empty) {
        console.log(`⚠️ Order ${orderId} already processed, skipping`);
        return;
    }

    // Save to Firestore
    await db.collection(COL).add({
        phone_e164,
        order_id: orderId,
        order_number: orderNumber,
        status: "pending",
        confirmation_sent_at: new Date(),
        name: fullName,
        address: address || "N/A",
        price: price || "0",
        direction: "outbound",
        message_status: "pending",
        status_updated_at: new Date(),
    });

    // Build variables for WhatsApp template
    const variables = {
        orderid: String(orderNumber),
        name: firstName,
        address,
        price
    };

    const isProd = process.env.MODE === "production";
    const testPhone = process.env.TEST_PHONE;

    let messageId = null;
    if (isProd) {
        const result = await sendWhatsappTemplate(phone, "order_confirmation", variables);
        messageId = result?.messages?.[0]?.id;
        console.log("✅ Sent WhatsApp confirmation to", phone);
        tagShopifyOrder(orderId, "⚠ Confirmation Pending").catch(err =>
            console.warn("⚠️ Failed to tag order:", err)
        );
    } else {
        if (phone === testPhone) {
            const result = await sendWhatsappTemplate(phone, "order_confirmation", variables);
            messageId = result?.messages?.[0]?.id;
            console.log("DEV MODE: Sent test WhatsApp to", phone);
            tagShopifyOrder(orderId, "⚠ Confirmation Pending").catch(err =>
                console.warn("⚠️ Failed to tag order:", err)
            );
        } else {
            console.log("DEV MODE: Skipped sending WhatsApp to", phone);
        }
    }

    // Update confirmation with message_id
    if (messageId) {
        try {
            const snapshot = await db.collection(COL)
                .where("phone_e164", "==", phone_e164)
                .where("order_number", "==", orderNumber)
                .orderBy("confirmation_sent_at", "desc")
                .limit(1)
                .get();

            if (!snapshot.empty) {
                await snapshot.docs[0].ref.update({
                    message_id: messageId,
                    message_status: "sent"
                });
            }
        } catch (e) {
            console.warn("⚠️ Failed to update message_id in confirmation:", e);
        }
    }
}
