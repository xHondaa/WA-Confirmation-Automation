import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';

const file = path.join(process.cwd(), 'whatsapp.json'); // JSON file in project root
const adapter = new JSONFile(file);
const db = new Low(adapter);

// Initialize DB if empty
await db.read();
db.data ||= { messages: [] };
await db.write();

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // Webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  // Receive messages
  if (req.method === 'POST') {
    const body = req.body;

    if (body.object === 'whatsapp_business_account' && body.entry?.length) {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          for (const message of change.value.messages || []) {
            const from = message.from;
            const msgBody = message.text?.body || '';
            const timestamp = new Date().toISOString();

            db.data.messages.push({ from, msgBody, timestamp });
            console.log(`Saved message from ${from}: ${msgBody}`);
          }
        }
      }
      await db.write();
    }
    return res.sendStatus(200);
  }

  // GET messages
  if (req.method === 'GET' && req.query.showMessages) {
    await db.read();
    return res.status(200).json(db.data.messages.reverse());
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
