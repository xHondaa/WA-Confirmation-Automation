const admin = require('firebase-admin');

// Initialize Firebase Admin once
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // === Webhook verification ===
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  // === Receive messages ===
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'whatsapp_business_account' && body.entry?.length) {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          for (const message of change.value.messages || []) {
            const from = message.from;
            const msgBody = message.text?.body || '';
            const timestamp = new Date().toISOString();

            // Save message to Firestore
            await db.collection('whatsappMessages').add({
              from,
              msgBody,
              timestamp
            });

            console.log(`Saved message from ${from}: ${msgBody}`);
          }
        }
      }
    }

    return res.sendStatus(200);
  }

  // === View stored messages (for debugging) ===
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
