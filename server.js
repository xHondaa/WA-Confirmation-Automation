const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'application/json' }));

// Your WhatsApp Business API credentials
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

// Verify Shopify webhook
const verifyShopifyWebhook = (data, hmacHeader) => {
  const calculatedHmac = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(data, 'utf8')
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(calculatedHmac),
    Buffer.from(hmacHeader)
  );
};

// Format phone number for WhatsApp
const formatPhoneNumber = (phone) => {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');
  
  // Add country code if missing (assuming US +1)
  if (cleaned.length === 10) {
    return '1' + cleaned;
  }
  
  return cleaned;
};

// Send WhatsApp message
const sendWhatsAppMessage = async (to, message) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: message
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('WhatsApp message sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    throw error;
  }
};

// Create confirmation message
const createConfirmationMessage = (order) => {
  const orderNumber = order.name || order.order_number;
  const customerName = order.customer?.first_name || 'Customer';
  const total = order.total_price;
  const currency = order.currency;
  
  const items = order.line_items.map(item => 
    `• ${item.title} (${item.quantity}x)`
  ).join('\n');

  return `Hi ${customerName}! 🎉

Thank you for your order #${orderNumber}!

Items ordered:
${items}

Total: ${currency} ${total}

We'll send you updates as we prepare your order for shipment.

Questions? Just reply to this message!`;
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'WhatsApp Webhook Server Running' });
});

// Shopify webhook endpoint
app.post('/webhook/shopify/orders', (req, res) => {
  try {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    const rawBody = JSON.stringify(body);

    // Verify webhook authenticity
    if (!verifyShopifyWebhook(rawBody, hmacHeader)) {
      console.log('Webhook verification failed');
      return res.status(401).send('Unauthorized');
    }

    console.log('New order received:', body.name);

    // Check if customer has a phone number
    const customerPhone = body.customer?.phone;
    if (!customerPhone) {
      console.log('No phone number provided for order:', body.name);
      return res.status(200).send('OK - No phone number');
    }

    // Format phone number and send WhatsApp message
    const formattedPhone = formatPhoneNumber(customerPhone);
    const message = createConfirmationMessage(body);

    // Send WhatsApp message (async)
    sendWhatsAppMessage(formattedPhone, message)
      .then(() => {
        console.log(`Confirmation sent to ${formattedPhone} for order ${body.name}`);
      })
      .catch((error) => {
        console.error(`Failed to send confirmation for order ${body.name}:`, error);
      });

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// WhatsApp webhook verification (for initial setup)
app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});