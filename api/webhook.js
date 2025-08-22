module.exports = (req, res) => {
  console.log('Full URL:', req.url);
  console.log('Query params:', req.query);

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED ✅');
    return res.status(200).send(challenge);
  }

  console.log('Verification failed ❌');
  return res.status(403).send('Verification failed');
};
