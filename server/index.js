/**
 * Layers Server
 * Minimal server - just static file serving
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '127.0.0.1';

// =========================================================================
// Security Middleware
// =========================================================================

/**
 * Content Security Policy
 */
function cspMiddleware(req, res, next) {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "font-src 'self' data: https://fonts.noisedeck.app",
        "connect-src 'self' http://localhost:* https://sharing.noisedeck.app",
        "worker-src 'self' blob:"
    ];

    res.setHeader('Content-Security-Policy', csp.join('; '));
    next();
}

/**
 * Additional security headers
 */
function securityHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
}

// =========================================================================
// Middleware Stack
// =========================================================================

app.use(cspMiddleware);
app.use(securityHeadersMiddleware);

// Static files from public directory
app.use(express.static(join(__dirname, '../public'), {
    maxAge: '1h',
    etag: true
}));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'layers' });
});

// =========================================================================
// Start Server
// =========================================================================

app.listen(PORT, HOST, () => {
    console.log(`
+-----------------------------------------------------------+
|                                                           |
|   Layers                                                  |
|   Layer-based Media Editor                                |
|   http://${HOST}:${PORT}                                      |
|                                                           |
+-----------------------------------------------------------+
    `);
});
