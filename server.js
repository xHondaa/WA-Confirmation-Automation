import express from "express";
import cors from "cors";

// Import existing handlers (default exports)
import sendWhatsapp from "./api/sendWhatsapp.js";
import whatsappWebhook from "./api/whatsappWebhook.js";
import shopifyWebhook from "./api/shopifyWebhook.js";

const app = express();

// If you later add HMAC verification for Shopify, switch this route to express.raw
// app.use("/api/shopifyWebhook", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Routes
app.post("/api/sendWhatsapp", (req, res) => sendWhatsapp(req, res));
app.get("/api/whatsappWebhook", (req, res) => whatsappWebhook(req, res)); // GET verification (hub.challenge)
app.post("/api/whatsappWebhook", (req, res) => whatsappWebhook(req, res));
app.post("/api/shopifyWebhook", (req, res) => shopifyWebhook(req, res));

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

