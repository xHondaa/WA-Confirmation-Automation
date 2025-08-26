import db from "../firebase.js";
import { collection, addDoc } from "firebase/firestore";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    try {
        const order = req.body; // Shopify sends JSON
        const customer = order.customer || {};

        // Extract customer name
        const firstName = customer.first_name || order.name || "Customer";
        const lastName = customer.last_name || "";
        const fullName = `${firstName} ${lastName}`.trim();

        // Extract phone (from customer.phone OR default_address.phone OR order.phone)
        const phone =
            customer.phone ||
            customer.default_address?.phone ||
            order.phone ||
            null;

        if (!phone) {
            console.warn("⚠️ No phone number found for order", order.id);
            return res.status(400).send("Missing customer phone number");
        }

        // Extract order number
        const orderNumber = order.order_number || order.id;

        // Save to Firebase
        await addDoc(collection(db, "orders"), {
            orderId: order.id,
            name: fullName,
            phone,
            status: "pending",
        });

        // Build variables for WhatsApp template
        const variables = {
            name: firstName,
            orderid: String(orderNumber),
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
