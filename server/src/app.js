const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const apiRoutes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// `trust proxy: true` would trust an X-Forwarded-For header from ANY client, letting an
// attacker spoof req.ip at will - which would defeat both rate limiting and the
// network-authentication subnet check (Section 3.2.5), since both key off req.ip. Left
// disabled (direct-connection IP only) for local dev; if this is deployed behind a real
// reverse proxy, set TRUST_PROXY_HOPS to the exact number of trusted hops in front of it
// instead of re-enabling blanket trust.
if (env.trustProxyHops > 0) {
  app.set('trust proxy', env.trustProxyHops);
}

app.use(
  helmet({
    // The SPA is served from this same origin, and helmet's default CSP would block its own
    // bundle and the inline QR data: URIs. Scoped explicitly rather than disabled.
    contentSecurityPolicy: env.serveClient
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            connectSrc: ["'self'"],
            mediaSrc: ["'self'", 'blob:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    // Camera and geolocation are same-origin features of the student page; the browser needs
    // the document served over HTTPS, which the platform terminates in front of us.
    crossOriginEmbedderPolicy: false,
  })
);

// Only meaningful when the SPA is served from somewhere else (local dev, where Vite is on
// :5173). Same-origin deployments never issue a cross-origin request at all.
if (!env.serveClient) {
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/v1/health', (req, res) =>
  res.json({ status: 'ok', env: env.nodeEnv, uptimeSeconds: Math.round(process.uptime()) })
);
app.use('/api/v1', apiRoutes);

if (env.serveClient) {
  const clientDist = path.resolve(__dirname, '../../client/dist');

  // Hashed asset filenames can be cached hard; index.html must not be, or a returning student
  // keeps running the previous build against a newer API.
  app.use(express.static(clientDist, {
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // SPA history fallback. Registered after the API router, so an unknown /api/v1/* path still
  // returns the JSON 404 from notFoundHandler rather than being answered with the HTML shell -
  // an API client receiving a page of markup is far harder to diagnose than a 404.
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => (err ? next(err) : undefined));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
