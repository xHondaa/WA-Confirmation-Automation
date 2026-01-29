import fetch from "node-fetch";

export default async function proxyImage(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).send('URL parameter required');
        }

        console.log('Proxying image from:', url);

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'WhatsApp-Business-Proxy'
            }
        });

        if (!response.ok) {
            console.error('Failed to fetch image:', response.status, response.statusText);
            return res.status(response.status).send('Failed to fetch image');
        }

        const contentType = response.headers.get('content-type');
        const buffer = await response.buffer();

        console.log('Image fetched successfully, content-type:', contentType, 'size:', buffer.length);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buffer);
    } catch (error) {
        console.error('Error proxying image:', error);
        res.status(500).send('Error fetching image');
    }
}