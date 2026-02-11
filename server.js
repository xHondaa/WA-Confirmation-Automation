import express from "express";
import cors from "cors";

// Import existing handlers (default exports)
import sendWhatsapp from "./api/sendWhatsapp.js";
import whatsappWebhook from "./api/whatsappWebhook.js";
import whatsappStatusWebhook from "./api/whatsappStatusWebhook.js";
import shopifyWebhook from "./api/shopifyWebhook.js";
import sendTextMessage from "./api/sendTextMessage.js";
import proxyImage from "./api/proxyImage.js";
import sendTemplate from "./api/sendTemplate.js";

const app = express();

// If you later add HMAC verification for Shopify, switch this route to express.raw
// app.use("/api/shopifyWebhook", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Routes
app.post("/api/sendWhatsapp", (req, res) => sendWhatsapp(req, res));
app.get("/api/whatsappWebhook", (req, res) => whatsappWebhook(req, res)); // GET verification (hub.challenge)
app.post("/api/whatsappWebhook", (req, res) => whatsappWebhook(req, res));
app.get("/api/whatsappStatusWebhook", (req, res) => whatsappStatusWebhook(req, res)); // GET verification
app.post("/api/whatsappStatusWebhook", (req, res) => whatsappStatusWebhook(req, res)); // Status updates
app.post("/api/shopifyWebhook", (req, res) => shopifyWebhook(req, res));
app.post("/api/sendTextMessage", (req, res) => sendTextMessage(req, res)); // Add this
app.get("/api/proxyImage", (req, res) => proxyImage(req, res));
app.post("/api/send-template", (req, res) => sendTemplate(req, res));

// Health check
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Error handler - suppress "request aborted" errors (Shopify timeout during cold start)
app.use((err, req, res, next) => {
  if (err.type === 'request.aborted') {
    console.log('ℹ️ Request aborted by client (likely Shopify timeout) - processing continues in background');
    return;
  }
  console.error('Server error:', err);
  if (!res.headersSent) {
    res.status(500).send('Internal Server Error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

