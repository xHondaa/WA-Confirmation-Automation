import axios from "axios";

async function sendWhatsappTemplate(to, templateName, variables) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

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
          parameters: variables.map(v => ({ type: "text", text: v }))
        }
      ]
    }
  };

  return axios.post(url, data, {
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    }
  });
}

// 👇 THIS is the required default export for Vercel
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, templateName, variables } = req.body;

    if (!to || !templateName) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await sendWhatsappTemplate(to, templateName, variables || []);
    res.status(200).json({ success: true, response: response.data });
  } catch (error) {
    console.error("Error sending WhatsApp:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to send WhatsApp message" });
  }
}
