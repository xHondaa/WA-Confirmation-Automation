// api/whatsapp.js
export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // WhatsApp webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
      } else {
        res.status(403).send('Verification failed');
      }
    } else {
      res.status(400).send('Missing mode or token');
    }
    return;
  }

  // Handle incoming messages
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Make sure it's a WhatsApp message
      if (
        body.object === 'whatsapp_business_account' &&
        body.entry &&
        body.entry.length > 0
      ) {
        body.entry.forEach((entry) => {
          const changes = entry.changes;
          changes.forEach((change) => {
            const messages = change.value.messages;
            if (messages) {
              messages.forEach((message) => {
                const from = message.from; // phone number of sender
                const msgBody = message.text?.body || '';
                console.log(`Received message from ${from}: ${msgBody}`);
                // You can add your logic here to respond or process the message
              });
            }
          });
        });
      }

      res.sendStatus(200); // Acknowledge receipt
    } catch (error) {
      console.error('Error handling webhook:', error);
      res.sendStatus(500);
    }
    return;
  }

  // Reject other methods
  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
