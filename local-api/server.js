const http = require('http');
const { URL } = require('url');

const HOST = process.env.AIMM_LOCAL_API_HOST || '127.0.0.1';
const PORT = Number(process.env.AIMM_LOCAL_API_PORT || 3001);

function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 2 * 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch (error) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

async function proxyKeepworkChat(payload) {
    const { systemPrompt, userMessage, apiBase, token, apiKey } = payload || {};
    if (!systemPrompt || !userMessage) {
        throw new Error('systemPrompt and userMessage are required');
    }
    if (!apiBase) {
        throw new Error('apiBase is required');
    }
    if (!token) {
        throw new Error('Keepwork token is required');
    }

    const endpoint = `${String(apiBase).replace(/\/+$/, '')}/chat`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
    if (apiKey) headers.API_KEY = apiKey;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Keepwork chat failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Keepwork chat returned empty content');
    }

    try {
        return JSON.parse(content);
    } catch (error) {
        throw new Error(`Keepwork chat returned non-JSON content: ${error.message}`);
    }
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end();
        return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { ok: true, service: 'aimm-local-api' });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze-script') {
        try {
            const payload = await readJsonBody(req);
            const result = await proxyKeepworkChat(payload);
            writeJson(res, 200, result);
        } catch (error) {
            writeJson(res, 400, { error: error.message || String(error) });
        }
        return;
    }

    writeJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
    console.log(`[aimm-local-api] listening on http://${HOST}:${PORT}`);
});
