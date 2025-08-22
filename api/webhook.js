import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Helper to open the DB
async function openDB() {
  return open({
    filename: './whatsapp.db', // SQLite DB in project root
    driver: sqlite3.Database
  });
}

export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

  // === Webhook verification (GET) ===
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

  // === Handle incoming messages (POST) ===
  if (req.method === 'POST') {
    try {
      const body = req.body;
      const db = await openDB();

      // Create table if it doesn't exist
      await db.run(
        'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, message TEXT, timestamp TEXT)'
      );

      if (body.object === 'whatsapp_business_account' && body.entry?.length) {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            for (const message of change.value.messages || []) {
              const from = message.from;
              const msgBody = message.text?.body || '';
              const timestamp = new Date().toISOString();

              // Insert into DB
              await db.run(
                'INSERT INTO messages (sender, message, timestamp) VALUES (?, ?, ?)',
                [from, msgBody, timestamp]
              );

              console.log(`Saved message from ${from}: ${msgBody}`);
            }
          }
        }
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error('Error handling webhook:', error);
      return res.sendStatus(500);
    }
  }

  // === Optional: GET endpoint to view stored messages ===
  if (req.method === 'GET' && req.query.showMessages) {
    try {
      const db = await openDB();
      await db.run(
        'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, message TEXT, timestamp TEXT)'
      );

      const messages = await db.all('SELECT * FROM messages ORDER BY id DESC');
      return res.status(200).json(messages);
    } catch (error) {
      console.error('Error fetching messages:', error);
      return res.sendStatus(500);
    }
  }

  // Reject other methods
  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
