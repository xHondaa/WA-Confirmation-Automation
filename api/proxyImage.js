import fetch from "node-fetch";

export default async function proxyImage(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).send('URL parameter required');
        }

        console.log('Proxying media from:', url);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                'User-Agent': 'WhatsApp-Business-Proxy'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch media:', response.status, response.statusText);
            return res.status(response.status).send(`Failed to fetch media: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        const buffer = await response.buffer();

        console.log('Media fetched successfully, content-type:', contentType, 'size:', buffer.length);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS
        res.send(buffer);
    } catch (error) {
        console.error('Error proxying media:', error);
        res.status(500).send('Error fetching media');
    }
}