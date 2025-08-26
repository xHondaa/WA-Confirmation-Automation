import db from "../firebase.js";
import { collection, addDoc } from "firebase/firestore";
import { sendWhatsappTemplate } from "./sendWhatsapp.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const order = req.body; // Shopify sends JSON
    const customer = order.customer;
    const phone = customer.phone || customer.default_address?.phone;



    // Save to Firebase
    await addDoc(collection(db, "orders"), {
      orderId: order.id,
      name: customer.first_name,
      phone,
      status: "pending"
    });
    const isProd = process.env.MODE === "production";
    const testPhone = process.env.TEST_PHONE; // your number in E.164 format e.g. +201234567890

    if (isProd) {
      // ✅ Live mode: send to all customers
      await sendWhatsappTemplate(
        phone,
        "order_confirmation_test",
        [customer.first_name, String(order.order_number)]
      );
      console.log("Sent WhatsApp confirmation to", phone);

    } else {
      // 🚧 Dev mode: only send to your test phone
      if (phone === testPhone) {
        await sendWhatsappTemplate(
          phone,
          "order_confirmation_test",
          [customer.first_name, String(order.order_number)]
        );
        console.log("DEV MODE: Sent test WhatsApp to", phone);
      } else {
        console.log("DEV MODE: Skipped sending WhatsApp to", phone);
      }
    }
    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
}
