import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import {
  getOrCreateReferralCode,
  getReferralStats,
  getReferralActivity,
  trackReferral,
} from '../services/referrals.js';

const referrals = new Hono();

// Auth middleware
referrals.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// GET REFERRAL STATS
// ============================================

referrals.get('/', async (c) => {
  const userId = c.get('userId');
  
  try {
    const stats = await getReferralStats(userId);
    return c.json(stats);
  } catch (error) {
    console.error('[Referrals] Stats error:', error);
    return c.json({ error: 'Failed to get referral stats' }, 500);
  }
});

// ============================================
// GET REFERRAL CODE
// ============================================

referrals.get('/code', async (c) => {
  const userId = c.get('userId');
  
  try {
    const code = await getOrCreateReferralCode(userId);
    return c.json({ 
      code,
      link: `https://clue.app/join?ref=${code}`,
    });
  } catch (error) {
    console.error('[Referrals] Code error:', error);
    return c.json({ error: 'Failed to get referral code' }, 500);
  }
});

// ============================================
// GET REFERRAL ACTIVITY
// ============================================

referrals.get('/activity', async (c) => {
  const userId = c.get('userId');
  
  try {
    const activity = await getReferralActivity(userId);
    return c.json({ activity });
  } catch (error) {
    console.error('[Referrals] Activity error:', error);
    return c.json({ error: 'Failed to get activity' }, 500);
  }
});

// ============================================
// SEND INVITE (track intent)
// ============================================

referrals.post('/invite', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ 
    method: 'sms' | 'email' | 'share';
    recipient?: string;
  }>();
  
  // Just track the intent - actual sending happens client-side
  console.log(`[Referrals] User ${userId} sent invite via ${body.method}`);
  
  const code = await getOrCreateReferralCode(userId);
  
  return c.json({ 
    success: true,
    code,
    link: `https://clue.app/join?ref=${code}`,
  });
});

// ============================================
// VALIDATE REFERRAL CODE (public endpoint)
// ============================================

referrals.get('/validate/:code', async (c) => {
  const code = c.req.param('code');
  
  // This would be called during signup to validate a referral code
  // For now, just check if the code format is valid
  if (!code || code.length !== 8) {
    return c.json({ valid: false });
  }
  
  return c.json({ valid: true, code: code.toUpperCase() });
});

export default referrals;
