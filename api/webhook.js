const crypto = require('crypto');

// Your WhatsApp Business API credentials (set in Vercel dashboard)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to,
          type: "text",
          text: {
            body: message
          }
        })
      }
    );
    
    const data = await response.json();
    console.log('WhatsApp message sent:', data);
    return data;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
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

// Main serverless function handler
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Shopify-Hmac-Sha256');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET request - health check OR WhatsApp webhook verification
  if (req.method === 'GET') {
    // Check if this is WhatsApp webhook verification
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WhatsApp webhook verified successfully');
      res.status(200).send(challenge);
      return;
    }

    // Regular health check
    res.status(200).json({ 
      status: 'WhatsApp Webhook Server Running on Vercel',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // POST request - handle Shopify webhook
  if (req.method === 'POST') {
    try {
      const hmacHeader = req.headers['x-shopify-hmac-sha256'];
      const body = req.body;
      const rawBody = JSON.stringify(body);

      console.log('=== WEBHOOK RECEIVED ===');
      console.log('Order:', body.name);
      console.log('Customer:', body.customer?.first_name, body.customer?.last_name);
      console.log('Phone:', body.customer?.phone);
      console.log('Total:', body.total_price, body.currency);
      console.log('Headers:', JSON.stringify(req.headers, null, 2));

      // Verify webhook authenticity
      if (SHOPIFY_WEBHOOK_SECRET && !verifyShopifyWebhook(rawBody, hmacHeader)) {
        console.log('Webhook verification failed');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Check if customer has a phone number
      const customerPhone = body.customer?.phone;
      if (!customerPhone) {
        console.log('No phone number provided for order:', body.name);
        return res.status(200).json({ message: 'OK - No phone number' });
      }

      // Format phone number and send WhatsApp message
      const formattedPhone = formatPhoneNumber(customerPhone);
      const message = createConfirmationMessage(body);

      // Send WhatsApp message
      console.log('=== SENDING WHATSAPP MESSAGE ===');
      console.log('To:', formattedPhone);
      console.log('Message preview:', message.substring(0, 100) + '...');
      
      await sendWhatsAppMessage(formattedPhone, message);
      
      console.log('=== SUCCESS ===');
      console.log(`Confirmation sent to ${formattedPhone} for order ${body.name}`);
      
      res.status(200).json({ 
        message: 'Confirmation sent successfully',
        order: body.name,
        phone: formattedPhone,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('=== ERROR ===');
      console.error('Webhook processing error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      res.status(500).json({ 
        error: 'Internal Server Error',
        timestamp: new Date().toISOString()
      });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}