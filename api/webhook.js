const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  // === GET: Webhook verification ===
  if (req.method === 'GET') {
    console.log('Received GET request for verification');
    console.log('Query parameters:', req.query);

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED ✅');
      return res.status(200).send(challenge); // must return plain text
    } else {
      console.log('WEBHOOK_VERIFICATION_FAILED ❌');
      return res.status(403).send('Verification failed');
    }
  }

  // === POST: Receive messages ===
  if (req.method === 'POST') {
    console.log('Received POST request (message)');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const body = req.body;

    if (body.object === 'whatsapp_business_account' && body.entry?.length) {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          for (const message of change.value.messages || []) {
            const from = message.from;
            const msgBody = message.text?.body || '';
            const timestamp = new Date().toISOString();

            console.log(`Saving message from ${from}: ${msgBody}`);

            // Save message to Firebase
            await db.collection('whatsappMessages').add({
              from,
              msgBody,
              timestamp
            });

            // === Optional: auto-reply ===
            if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
              try {
                await axios.post(
                  `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                  {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: `Received your message: "${msgBody}"` }
                  },
                  {
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
                  }
                );
                console.log(`Auto-replied to ${from}`);
              } catch (err) {
                console.error('Failed to send reply:', err.response?.data || err.message);
              }
            }
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  // === Optional: View stored messages (debugging) ===
  if (req.method === 'GET' && req.query.showMessages) {
    const snapshot = await db.collection('whatsappMessages')
      .orderBy('timestamp', 'desc')
      .get();

    const messages = snapshot.docs.map(doc => doc.data());
    return res.status(200).json(messages);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
};
