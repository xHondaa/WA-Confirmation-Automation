import { openDB } from '../../lib/db.js';


export default async function handler(req, res) {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    if (req.method === 'GET' && req.query.showMessages) {
    const db = await openDB();
    await db.run(
      'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, message TEXT, timestamp TEXT)'
    );
    const messages = await db.all('SELECT * FROM messages ORDER BY id DESC');
    return res.status(200).json(messages);
  }

  res.status(405).end('Method Not Allowed');


  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode && token && mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Verification failed');
  }

  if (req.method === 'POST') {
    try {
      const body = req.body;
      const db = await openDB();
      await db.run(
        'CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, message TEXT, timestamp TEXT)'
      );

      if (body.object === 'whatsapp_business_account' && body.entry?.length) {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            for (const message of change.value.messages || []) {
              const from = message.from;
              const msgBody = message.text?.body || '';
              await db.run('INSERT INTO messages (sender, message, timestamp) VALUES (?, ?, ?)', [
                from,
                msgBody,
                new Date().toISOString()
              ]);
              console.log(`Saved message from ${from}`);
            }
          }
        }
      }

      return res.sendStatus(200);
    } catch (error) {
      console.error(error);
      return res.sendStatus(500);
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
