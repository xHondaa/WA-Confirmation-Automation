import fetch from "node-fetch";
import db from "../firebaseAdmin.js";

// Normalize phone to E.164 format (Egypt country code: +20)
function normalizeE164(raw) {
    if (!raw) return raw;
    let s = String(raw).replace(/[^\d+]/g, "");
    if (s.startsWith("+")) s = s.slice(1);
    if (s.startsWith("0")) s = "20" + s.slice(1);
    if (!s.startsWith("20")) s = "20" + s;
    return "+" + s;
}

// Update last_message_at timestamp on orders collection for pagination/sorting
async function updateOrderLastMessageAt(orderNumber) {
    if (!orderNumber) return;
    try {
        const snapshot = await db.collection("orders")
            .where("order_number", "==", orderNumber)
            .limit(1)
            .get();
        if (!snapshot.empty) {
            await snapshot.docs[0].ref.update({
                last_message_at: new Date()
            });
        }
    } catch (err) {
        console.warn("⚠️ Failed to update last_message_at:", err);
    }
}

export default async function sendTextMessage(req, res) {
    try {
        const { phone, message, order_number } = req.body;

        console.log('Send message request:', { phone, message, order_number });

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone and message required' });
        }

        const normalizedPhone = normalizeE164(phone);
        const phoneDigits = normalizedPhone.replace(/[^0-9]/g, "");

        // Send message via WhatsApp API
        const response = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phoneDigits,
                type: 'text',
                text: {
                    body: message
                }
            })
        });

        const data = await response.json();

        console.log('WhatsApp API response:', data);

        if (!response.ok) {
            throw new Error(data.error?.message || 'WhatsApp API error');
        }

        // Save to Firebase
        const orderNum = order_number ? Number(order_number) : null;
        await db.collection("whatsappMessages").add({
            customer: normalizedPhone,
            message_type: "text",
            text: message,
            direction: "outbound",
            order_number: orderNum,
            message_id: data.messages?.[0]?.id || null,
            status: "sent",
            status_updated_at: new Date().toISOString(),
            timestamp: new Date().toISOString(),
        });

        // Update last_message_at on orders collection
        await updateOrderLastMessageAt(orderNum);

        res.json({ success: true, messageId: data.messages?.[0]?.id });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
}