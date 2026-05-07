require('dotenv').config({ path: '../../.env' });
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db/knex');
const { attachWebSocketServer, startNotificationListener } = require('./realtime/notificationsHub');

const app = express();
const PORT = process.env.USER_SERVICE_PORT || 3001;

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'user-service', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'user-service', db: 'disconnected', error: err.message });
  }
});

// ─── Routes ──────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin', require('./routes/admin'));

// ─── 404 Handler ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || 500;
  // Log full error for server-side debugging (DB errors often hide in err.detail)
  console.error(`[user-service] ${status} Error on ${req.method} ${req.path}:`);
  console.error('  message:', err.message);
  console.error('  detail: ', err.detail || '—');
  console.error('  code:   ', err.code   || '—');
  res.status(status).json({
    error: err.message || err.detail || 'Internal Server Error',
    ...(err.code && { code: err.code }),
  });
});

// ─── Start ───────────────────────────────────────────────
if (require.main === module) {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  attachWebSocketServer(wss, db);
  startNotificationListener(db);

  server.listen(PORT, () => {
    console.log(`[user-service] Running on port ${PORT} (HTTP + WS)`);
  });
}

module.exports = app;

