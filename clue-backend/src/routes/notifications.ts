import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { saveDeviceToken, deleteDeviceToken, getDeviceTokens } from '../db/client.js';

const notifications = new Hono();

// Auth middleware
notifications.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// Register device token
notifications.post('/register', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ token: string; platform: 'ios' | 'android' | 'web' }>();
  
  if (!body.token || !body.platform) {
    return c.json({ error: 'Missing token or platform' }, 400);
  }
  
  const deviceToken = await saveDeviceToken(userId, body.token, body.platform);
  return c.json({ success: true, id: deviceToken.id });
});

// Unregister device token
notifications.delete('/unregister', async (c) => {
  const body = await c.req.json<{ token: string }>();
  
  if (!body.token) {
    return c.json({ error: 'Missing token' }, 400);
  }
  
  await deleteDeviceToken(body.token);
  return c.json({ success: true });
});

// Get registered devices
notifications.get('/devices', async (c) => {
  const userId = c.get('userId');
  const tokens = await getDeviceTokens(userId);
  
  return c.json({
    devices: tokens.map(t => ({
      id: t.id,
      platform: t.platform,
      registered_at: t.created_at,
      last_used: t.last_used_at,
    })),
  });
});

export default notifications;
