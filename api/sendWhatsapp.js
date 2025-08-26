import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, templateName, variables = [] } = req.body;

    if (!to || !templateName) {
      return res.status(400).json({ error: "Missing required fields: 'to' or 'templateName'" });
    }

    // ✅ Just log the variables to Vercel logs
    console.log("Template:", templateName);
    console.log("Variables received:", variables);

    const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`;

    const data = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: variables.map((v) => ({ type: "text", text: v })),
          },
        ],
      },
    };

    // ✅ Log the final payload being sent
    console.log("Outgoing WhatsApp Payload:", JSON.stringify(data, null, 2));

    const response = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    return res.status(200).json({
      success: true,
      messageId: response.data.messages[0].id,
      sentTo: to,
      templateUsed: templateName,
      variablesSent: variables,
    });
  } catch (error) {
    console.error("Error sending WhatsApp:", error.response?.data || error.message);
    return res.status(500).json({ error: "Failed to send WhatsApp message" });
  }
}
