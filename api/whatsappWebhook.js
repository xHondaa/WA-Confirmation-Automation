import db from "../firebase.js";
import axios from "axios";
import { doc, updateDoc } from "firebase/firestore";
import { updateShopifyOrderTag } from "./updateShopify.js";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Verification for WhatsApp webhook
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.sendStatus(403);
  }

  if (req.method === "POST") {
    const data = req.body;
    if (data.entry?.[0]?.changes?.[0]?.value?.messages) {
      const message = data.entry[0].changes[0].value.messages[0];
      const from = message.from;
      const buttonPayload = message.button?.payload;

      if (buttonPayload === "confirm") {
        await updateShopifyOrderTag(from, "confirmed");
      }  else if (buttonPayload === "cancel") {
			try {
				await axios.post(
				  `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
				  {
					messaging_product: "whatsapp",
					to: process.env.SUPPORT_PHONE,
					type: "text",
					text: {
					  body: `Order cancellation request from customer ${from}.` 
					  // 🔹 Placeholder – replace this with your own message
					}
				  },
				  {
					headers: {
					  Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
					  "Content-Type": "application/json"
					}
				  }
				);
			  } catch (error) {
				console.error("Error sending cancel message:", error.response?.data || error);
			  }
      }
    }
    return res.sendStatus(200);
  }
}
