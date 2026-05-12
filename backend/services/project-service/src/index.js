require('dotenv').config({ path: '../../.env' });
const express = require('express');
const cors = require('cors');
const db = require('./db/knex');
const { syncDevSampleProjects } = require('./lib/syncDevSampleProjects');

const app = express();
const PORT = process.env.PROJECT_SERVICE_PORT || 3002;

// ─── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.status(200).json({ status: 'ok', service: 'project-service', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', service: 'project-service', db: 'disconnected', error: err.message });
  }
});

// ─── Routes ──────────────────────────────────────────────
app.use('/api/projects',  require('./routes/projects'));
app.use('/api/groups',    require('./routes/groups'));
app.use('/api/requests',  require('./routes/requests'));
app.use('/api/faculty',  require('./routes/faculty'));
app.use('/api/recommend', require('./routes/recommend'));
app.use('/api', require('./routes/progress'));

// ─── 404 Handler ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global Error Handler ────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || 500;
  console.error(`[project-service] ${status} Error on ${req.method} ${req.path}:`);
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
  (async () => {
    try {
      const r = await syncDevSampleProjects(db);
      if (r.skipped) {
        if (r.reason && r.reason.startsWith('no student user')) {
          console.log(`[project-service] Demo projects not seeded: ${r.reason}`);
        }
      } else if (r.inserted > 0) {
        console.log(`[project-service] Seeded ${r.inserted} demo SE/CS project(s)`);
      } else {
        console.log('[project-service] Demo SE/CS projects already present');
      }
    } catch (err) {
      console.error('[project-service] Demo project seed failed:', err.message);
    }
    app.listen(PORT, () => {
      console.log(`[project-service] Running on port ${PORT}`);
    });
  })();
}

module.exports = app;

