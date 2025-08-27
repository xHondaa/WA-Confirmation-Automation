import db from "../firebaseAdmin.js";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

// Normalize phone to E.164-like format: keep leading + and digits only
function normalizeE164(raw) {
    if (!raw) return raw;
    const s = String(raw).replace(/[^\d+]/g, "");
    return s.startsWith("+") ? s : `+${s}`;
}

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    try {
        const order = req.body; // Shopify sends JSON
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

        // Extract phone (from customer.phone OR default_address.phone OR order.phone)
        const phone =
            customer.phone ||
            customer.default_address?.phone ||
            order.phone ||
            order.billing_address?.phone ||
            order.shipping_address?.phone ||
            null;


        if (!phone) {
            console.warn("⚠️ No phone number found for order", order.id);
            return res.status(400).send("Missing customer phone number");
        }

        // Extract order number
        const orderNumber = order.order_number;

        // Build address string (fallback to billing if shipping is missing)
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

        // Total price as a string (template already appends "EGP")
        const price = String(order.current_total_price || order.total_price || "");



// ✅ Save to Firestore with Admin SDK (confirmations collection)
const COL = process.env.CONFIRMATIONS_COLLECTION || "confirmations";
const phone_e164 = normalizeE164(phone);
await db.collection(COL).add({
    phone_e164,
    order_id: order.id,
    status: "pending",
    confirmation_sent_at: new Date(),
    name: fullName,
    order_number: orderNumber,
});

        // Build variables for WhatsApp template
        const variables = {
            orderid: String(orderNumber),   // used in "#BUT{{orderid}}" and "Order: #BUT{{orderid}}"
            name: firstName,                // used in "Hello {{name}}!"
            address,                        // used in "Shipping Address: {{address}}"
            price                           // used in "Total Price: {{price}} EGP"
        };

        const isProd = process.env.MODE === "production";
        const testPhone = process.env.TEST_PHONE; // your number in E.164 format e.g. +201234567890

        if (isProd) {
            // ✅ Live mode: send to all customers
            await sendWhatsappTemplate(phone, "order_confirmation", variables);
            console.log("✅ Sent WhatsApp confirmation to", phone);
        } else {
            // 🚧 Dev mode: only send to your test phone
            if (phone === testPhone) {
                await sendWhatsappTemplate(phone, "order_confirmation", variables);
                console.log("DEV MODE: Sent test WhatsApp to", phone);
            } else {
                console.log("DEV MODE: Skipped sending WhatsApp to", phone);
            }
        }

        res.status(200).send("OK");
    } catch (error) {
        console.error("❌ Error in shopifyWebhook:", error);
        res.status(500).send("Error");
    }
}
