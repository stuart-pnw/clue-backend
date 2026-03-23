import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import {
  getUserById,
  updateUser,
  getUserPreferences,
  updateUserPreferences,
  getUserStats,
  getConnectedAccounts,
} from '../db/client.js';

const user = new Hono();

// Auth middleware
user.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// GET /user/profile
user.get('/profile', async (c) => {
  const userId = c.get('userId');
  
  const [profile, preferences, stats, accounts] = await Promise.all([
    getUserById(userId),
    getUserPreferences(userId),
    getUserStats(userId),
    getConnectedAccounts(userId),
  ]);
  
  if (!profile) return c.json({ error: 'User not found' }, 404);
  
  return c.json({
    user: profile,
    preferences,
    stats,
    connected_accounts: accounts.map(a => ({
      platform: a.platform,
      username: a.platform_username,
      connected_at: a.connected_at,
    })),
  });
});

// PATCH /user/profile
user.patch('/profile', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  
  const allowedFields = ['name', 'timezone', 'delivery_time', 'onboarding_complete'];
  const updates: Record<string, any> = {};
  
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }
  
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }
  
  const updated = await updateUser(userId, updates);
  return c.json({ user: updated });
});

// PATCH /user/preferences
user.patch('/preferences', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  
  const allowedFields = ['goal', 'professions', 'push_notifications', 'network_scanning', 'personalized_insights', 'usage_analytics', 'store_source_snapshots'];
  const updates: Record<string, any> = {};
  
  for (const field of allowedFields) {
    if (field in body) updates[field] = body[field];
  }
  
  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }
  
  const updated = await updateUserPreferences(userId, updates);
  return c.json({ preferences: updated });
});

// GET /user/stats
user.get('/stats', async (c) => {
  const userId = c.get('userId');
  const stats = await getUserStats(userId);
  
  if (!stats) return c.json({ error: 'Stats not found' }, 404);
  return c.json({ stats });
});

export default user;
