export default function handler(req, res) {
  console.log("=== Incoming Request ===");
  console.log("Method:", req.method);
  console.log("Full URL:", req.url);
  console.log("Query params:", req.query);
  console.log("Headers:", req.headers);

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    console.log("Mode:", mode);
    console.log("Received token:", token);
    console.log("Expected token:", VERIFY_TOKEN);
    console.log("Challenge:", challenge);

    if (mode && token) {
      if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("WEBHOOK_VERIFIED ✅");
        return res.status(200).send(challenge);
      } else {
        console.error("WEBHOOK_VERIFICATION_FAILED ❌");
        return res.status(403).send("Forbidden");
      }
    }
  } else if (req.method === "POST") {
    console.log("Incoming webhook event:", JSON.stringify(req.body, null, 2));
    return res.status(200).send("EVENT_RECEIVED");
  } else {
    return res.status(405).send("Method Not Allowed");
  }
}
