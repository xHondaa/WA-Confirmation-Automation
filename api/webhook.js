// api/webhook.js
export default function handler(req, res) {
  console.log("=== Incoming Request ===");
  console.log("Method:", req.method);
  console.log("Full URL:", req.url);
  console.log("Query params:", req.query);
  console.log("Headers:", req.headers);

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "WhatsappTokenVercel"; // fallback for testing

  if (req.method === "GET") {
    // Webhook verification
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("Mode:", mode);
    console.log("Received token:", token);
    console.log("Expected token:", VERIFY_TOKEN);
    console.log("Challenge:", challenge);

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED ✅");
      res.status(200).send(challenge);
    } else {
      console.error("WEBHOOK_VERIFICATION_FAILED ❌");
      res.sendStatus(403);
    }
  } else if (req.method === "POST") {
    // Incoming WhatsApp messages/events
    console.log("Incoming webhook body:", JSON.stringify(req.body, null, 2));
    res.sendStatus(200); // Always respond quickly to acknowledge receipt
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
