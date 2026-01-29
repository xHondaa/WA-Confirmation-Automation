import fetch from "node-fetch";

export default async function proxyImage(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).send('URL parameter required');
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'WhatsApp-Business-Proxy'
            }
        });

        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch image');
        }

        const contentType = response.headers.get('content-type');
        const buffer = await response.buffer();

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(buffer);
    } catch (error) {
        console.error('Error proxying image:', error);
        res.status(500).send('Error fetching image');
    }
}