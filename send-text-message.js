app.post('/send-text-message', async (req, res) => {
    try {
        const { phone, message, order_number } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ error: 'Phone and message required' });
        }

        // Send message via WhatsApp API
        const response = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
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
});