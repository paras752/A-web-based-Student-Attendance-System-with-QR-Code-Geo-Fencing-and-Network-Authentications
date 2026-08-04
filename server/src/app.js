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
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

app.use(helmet());
app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/v1/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/v1', apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
