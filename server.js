const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

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

// Cabeçalhos de segurança aplicados a toda resposta
function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://capas.bu.ufsc.br; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
    );
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    console.log(`${req.method} ${pathname}`);

    setSecurityHeaders(res);

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

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };

        const apiReq = https.get(targetUrl, options, (apiRes) => {
            let data = '';

            apiRes.on('data', (chunk) => {
                data += chunk;
            });

            apiRes.on('end', () => {
                res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(data);
            });
        });
        apiReq.setTimeout(10000, () => {
            apiReq.destroy(new Error('Pergamum API request timed out'));
        });
        apiReq.on('error', (err) => {
            if (res.headersSent) return;
            console.error(`Error proxying request: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch from Pergamum API', details: err.message }));
        });
        return;
    }

    // Proxy endpoint for Pergamum search
    if (pathname === '/api/pesquisa' && req.method === 'GET') {
        const termo = requestUrl.searchParams.get('termo') || '';
        const indice = requestUrl.searchParams.get('indice') || '';
        const coluna = requestUrl.searchParams.get('coluna') || 'INDICE_2';

        const targetUrl = `https://pergamum.ufsc.br/api/v2/consulta/pesquisa_geral/pergamum_graph?termo_pesquisa=${encodeURIComponent(termo)}&coluna_um=${encodeURIComponent(coluna)}&indice=${encodeURIComponent(indice)}&page=1&perPage=20&orderBy=obra&direction=C`;

        console.log(`Proxying search request for '${termo}' (ID ${indice}, Coluna ${coluna}) to: ${targetUrl}`);

        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };

        const apiReq = https.get(targetUrl, options, (apiRes) => {
            let data = '';

            apiRes.on('data', (chunk) => {
                data += chunk;
            });

            apiRes.on('end', () => {
                res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(data);
            });
        });
        apiReq.setTimeout(10000, () => {
            apiReq.destroy(new Error('Pergamum API search timed out'));
        });
        apiReq.on('error', (err) => {
            if (res.headersSent) return;
            console.error(`Error proxying search request: ${err.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to fetch search from Pergamum API', details: err.message }));
        });
        return;
    }

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Direct /acervo/:id or /acervo route to index.html (SPA routing)
    if (pathname.match(/^\/acervo(?:\/\d+)?\/?$/)) {
        const filePath = path.join(PUBLIC_DIR, 'index.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
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
