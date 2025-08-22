const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  // === GET verification (WhatsApp sends hub.challenge) ===
  if (req.method === 'GET') {
    console.log('Received GET request for verification');
    console.log('Query parameters:', req.query);

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('Mode:', mode);
    console.log('Received token:', token);
    console.log('Expected token:', VERIFY_TOKEN);

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED ✅');
      return res.status(200).send(challenge); // must return plain text
    } else {
      console.log('WEBHOOK_VERIFICATION_FAILED ❌');
      return res.status(403).send('Verification failed');
    }
  }

  // === POST messages from WhatsApp ===
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

            // Optional: auto-reply
            /*
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

            await axios.post(
              `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
              {
                messaging_product: "whatsapp",
                to: from,
                text: { body: "Received your message!" }
              },
              {
                headers: { Authorization: `Bearer ${token}` }
              }
            );
            */
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  // === Optional: view stored messages for debugging ===
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
