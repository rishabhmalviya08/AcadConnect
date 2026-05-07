const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const WS_OPEN = 1;

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const socketsByUser = new Map();

function getPgClientConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT) || 5432,
    user: process.env.POSTGRES_USER || 'acadconnect',
    password: process.env.POSTGRES_PASSWORD || 'yourStrongPassword',
    database: process.env.POSTGRES_DB || 'acadconnect',
  };
}

async function buildNotificationPayload(db, userId) {
  const [notifications, unreadRow] = await Promise.all([
    db('notifications')
      .select('id', 'type', 'title', 'message', 'metadata', 'is_read', 'created_at')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(5),
    db('notifications').where({ user_id: userId, is_read: false }).count('id as count').first(),
  ]);

  return {
    notifications,
    unread_count: Number(unreadRow?.count || 0),
  };
}

/**
 * Push latest notifications to all sockets for a user (after DB NOTIFY or on connect).
 */
async function pushToUser(db, userId) {
  const set = socketsByUser.get(userId);
  if (!set || set.size === 0) return;

  let payload;
  try {
    payload = await buildNotificationPayload(db, userId);
  } catch (err) {
    console.error('[notificationsHub] pushToUser fetch failed:', err.message);
    return;
  }

  const message = JSON.stringify({
    type: 'notifications:update',
    payload,
  });

  for (const ws of set) {
    if (ws.readyState === WS_OPEN) {
      try {
        ws.send(message);
      } catch (e) {
        /* ignore send errors */
      }
    }
  }
}

function addSocket(userId, ws) {
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(ws);
}

function removeSocket(userId, ws) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) socketsByUser.delete(userId);
}

/**
 * Attach WebSocket auth + registry; initial snapshot only (no polling).
 */
function attachWebSocketServer(wss, db) {
  wss.on('connection', (ws, req) => {
    let userId;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(1008, 'Missing token');
        return;
      }

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      userId = payload.id;
      if (!userId) {
        ws.close(1008, 'Invalid token');
        return;
      }

      addSocket(userId, ws);
      pushToUser(db, userId).catch(() => {});

      ws.on('close', () => removeSocket(userId, ws));
      ws.on('error', () => removeSocket(userId, ws));
    } catch {
      ws.close(1008, 'Unauthorized');
    }
  });
}

/**
 * LISTEN for pg_notify from notification insert trigger; push to affected user sockets.
 */
function startNotificationListener(db) {
  let reconnectTimer = null;

  const connectListen = async () => {
    const client = new Client(getPgClientConfig());

    client.on('notification', (msg) => {
      if (msg.channel !== 'acadconnect_notifications') return;
      try {
        const data = JSON.parse(msg.payload);
        const userId = data.user_id;
        if (userId) pushToUser(db, userId).catch(() => {});
      } catch {
        /* ignore malformed NOTIFY payloads */
      }
    });

    try {
      await client.connect();
      await client.query('LISTEN acadconnect_notifications');
      console.log('[notificationsHub] LISTEN acadconnect_notifications active');

      await new Promise((resolve) => {
        client.once('error', resolve);
        client.once('end', resolve);
      });
    } catch (err) {
      console.error('[notificationsHub] LISTEN session ended:', err?.message || err);
    } finally {
      try {
        client.removeAllListeners();
        await client.end();
      } catch {
        /* ignore */
      }

      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectListen();
        }, 2500);
      }
    }
  };

  connectListen();
}

module.exports = {
  attachWebSocketServer,
  startNotificationListener,
  pushToUser,
};
