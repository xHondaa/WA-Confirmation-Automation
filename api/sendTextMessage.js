import fetch from "node-fetch";
import db from "../firebaseAdmin.js";

export default async function sendTextMessage(req, res) {
    try {
        const { phone, message, order_number } = req.body;

        console.log('Send message request:', { phone, message, order_number });

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone and message required' });
        }

        // Send message via WhatsApp API
        const response = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
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
        await db.collection("whatsappMessages").add({
            customer: phone,
            message_type: "text",
            text: message,
            direction: "outbound",
            order_number: order_number ? Number(order_number) : null,
            message_id: data.messages?.[0]?.id || null,
            status: "sent",
            status_updated_at: new Date().toISOString(),
            timestamp: new Date().toISOString(),
        });

        res.json({ success: true, messageId: data.messages?.[0]?.id });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
}