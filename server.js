const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static files
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`${req.method} ${pathname}`);

    // CORS headers for convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Proxy endpoint for Pergamum API
    // Matches /api/acervo/{id} or /api/acervo/{id}/exemplary-data
    const apiMatch = pathname.match(/^\/api\/acervo\/(\d+)(?:\/(exemplary-data))?$/);
    if (apiMatch && req.method === 'GET') {
        const acervoId = apiMatch[1];
        const subPath = apiMatch[2]; // e.g. "exemplary-data" or undefined
        
        let targetUrl = `https://pergamum.ufsc.br/api/acervo/${acervoId}`;
        if (subPath) {
            targetUrl += `/${subPath}`;
        }

        console.log(`Proxying request for acervo ${acervoId} to: ${targetUrl}`);

        // Set options to bypass self-signed certificate errors if any, and set headers
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            },
            rejectUnauthorized: false // Bypasses potential SSL/certificate issues
        };

        https.get(targetUrl, options, (apiRes) => {
            let data = '';

            apiRes.on('data', (chunk) => {
                data += chunk;
            });

            apiRes.on('end', () => {
                res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(data);
            });

        }).on('error', (err) => {
            console.error(`Error proxying request: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch from Pergamum API', details: err.message }));
        });
        return;
    }

    // Static file serving
    // Default to index.html if path is /
    const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security check: ensure path is within PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`Pergamum Graph Explorer running at http://localhost:${PORT}`);
});
