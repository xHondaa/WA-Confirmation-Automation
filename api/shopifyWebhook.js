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

    // Send WhatsApp confirmation template
    await sendWhatsappTemplate(
      phone,
      "order_confirmation_test",
      [customer.first_name, String(order.order_number)],
      ["confirm", "cancel"]
    );

    res.status(200).send("OK");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error");
  }
}
