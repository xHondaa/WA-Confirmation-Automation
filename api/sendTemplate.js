import axios from "axios";
import db from "../firebaseAdmin.js";

export default async function sendTemplate(req, res) {
    try {
        const { phone, templateName, variables, order_number } = req.body;

        if (!phone || !templateName) {
            return res.status(400).json({ error: 'Phone and templateName required' });
        }

        console.log(`📤 Sending template "${templateName}" to ${phone}`);

        // Build WhatsApp API request
        const messagePayload = {
            messaging_product: 'whatsapp',
            to: phone,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'en' }
            }
        };

        // Add components if variables exist
        if (variables && Object.keys(variables).length > 0) {
            messagePayload.template.components = [
                {
                    type: 'body',
                    parameters: Object.values(variables).map(value => ({
                        type: 'text',
                        text: String(value)
                    }))
                }
            ];
        }

        // Send via WhatsApp API
        const response = await axios.post(
            `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
            messagePayload,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const messageId = response.data.messages?.[0]?.id;

        // Save to Firebase
        await db.collection("whatsappMessages").add({
            customer: phone,
            message_type: "template",
            template_name: templateName,
            variables: variables || {},
            direction: "outbound",
            order_number: order_number ? Number(order_number) : null,
            message_id: messageId || null,
            status: "sent",
            status_updated_at: new Date().toISOString(),
            timestamp: new Date().toISOString(),
        });

        console.log(`✅ Template sent successfully (${messageId})`);

        res.json({ success: true, messageId });
    } catch (error) {
        console.error('❌ Error sending template:', error.response?.data || error.message);
        res.status(500).json({
            error: error.response?.data?.error?.message || error.message
        });
    }
}