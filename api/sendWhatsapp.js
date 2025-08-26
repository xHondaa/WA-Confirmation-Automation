import axios from "axios";

export async function sendWhatsappTemplate(to, templateName, variables, buttonPayloads = []) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
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
            },
            ...(buttonPayloads.length > 0 ? [{
              type: "button",
              sub_type: "quick_reply",
              index: "0",
              parameters: buttonPayloads.map(payload => ({
                type: "payload",
                payload
              }))
            }] : [])
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error);
  }
}
