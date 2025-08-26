import axios from "axios";

// ✅ Exported function for sending WhatsApp templates
export async function sendWhatsappTemplate(to, templateName, variables = {}) {
    const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: templateName,
            language: { code: "en" },
            components: [
                {
                    type: "body",
                    parameters: Object.entries(variables).map(([key, value]) => ({
                        type: "text",
                        parameter_name: key, // ✅ named params ("name", "orderid")
                        text: value,
                    })),
                },
            ],
        },
    };

    console.log("Outgoing WhatsApp Payload:", JSON.stringify(data, null, 2));

    const response = await axios.post(url, data, {
        headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
        },
    });

    return response.data;
}

// ✅ Default API handler (keeps Vercel happy)
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { to, templateName, variables = {} } = req.body;

        if (!to || !templateName) {
            return res
                .status(400)
                .json({ error: "Missing required fields: 'to' or 'templateName'" });
        }

        const result = await sendWhatsappTemplate(to, templateName, variables);

        return res.status(200).json({
            success: true,
            messageId: result.messages?.[0]?.id,
            sentTo: to,
            templateUsed: templateName,
            variablesSent: variables,
        });
    } catch (error) {
        console.error("Error sending WhatsApp:", error.response?.data || error.message);
        return res
            .status(500)
            .json({ error: "Failed to send WhatsApp message" });
    }
}
