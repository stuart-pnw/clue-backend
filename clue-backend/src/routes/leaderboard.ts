import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { getLeaderboard, getGlobalLeaderboard, getFriendsLeaderboard, getUserRank } from '../services/leaderboard.js';

const leaderboard = new Hono();

// Auth middleware
leaderboard.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// GET FULL LEADERBOARD
// ============================================

leaderboard.get('/', async (c) => {
  const userId = c.get('userId');
  
  try {
    const data = await getLeaderboard(userId);
    return c.json(data);
  } catch (error) {
    console.error('[Leaderboard] Error:', error);
    return c.json({ error: 'Failed to get leaderboard' }, 500);
  }
});

// ============================================
// GET GLOBAL ONLY
// ============================================

leaderboard.get('/global', async (c) => {
  const userId = c.get('userId');
  const limit = parseInt(c.req.query('limit') || '50');
  
  try {
    const entries = await getGlobalLeaderboard(userId, limit);
    return c.json({ entries });
  } catch (error) {
    console.error('[Leaderboard] Global error:', error);
    return c.json({ error: 'Failed to get global leaderboard' }, 500);
  }
});

// ============================================
// GET FRIENDS ONLY
// ============================================

leaderboard.get('/friends', async (c) => {
  const userId = c.get('userId');
  
  try {
    const entries = await getFriendsLeaderboard(userId);
    return c.json({ entries });
  } catch (error) {
    console.error('[Leaderboard] Friends error:', error);
    return c.json({ error: 'Failed to get friends leaderboard' }, 500);
  }
});

// ============================================
// GET USER RANK
// ============================================

leaderboard.get('/rank', async (c) => {
  const userId = c.get('userId');
  
  try {
    const rank = await getUserRank(userId);
    return c.json(rank);
  } catch (error) {
    console.error('[Leaderboard] Rank error:', error);
    return c.json({ error: 'Failed to get rank' }, 500);
  }
});

export default leaderboard;
