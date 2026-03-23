import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import {
  detectBreakingSignals,
  getPendingSignals,
  markSignalSeen,
  generateClueFromSignal,
} from '../services/signals.js';
import { getSubscription } from '../services/billing.js';

const signals = new Hono();

// Auth middleware
signals.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// GET PENDING SIGNALS
// ============================================

signals.get('/', async (c) => {
  const userId = c.get('userId');
  
  // Check if Pro
  const sub = await getSubscription(userId);
  if (sub?.tier !== 'pro') {
    return c.json({ 
      signals: [],
      is_pro: false,
      message: 'Real-time signals require Pro subscription',
    });
  }
  
  try {
    const pending = await getPendingSignals(userId);
    return c.json({ 
      signals: pending,
      is_pro: true,
    });
  } catch (error) {
    console.error('[Signals] Get error:', error);
    return c.json({ error: 'Failed to get signals' }, 500);
  }
});

// ============================================
// CHECK FOR NEW SIGNALS
// ============================================

signals.post('/check', async (c) => {
  const userId = c.get('userId');
  
  const sub = await getSubscription(userId);
  if (sub?.tier !== 'pro') {
    return c.json({ 
      signals: [],
      is_pro: false,
    });
  }
  
  try {
    const newSignals = await detectBreakingSignals(userId);
    return c.json({ 
      signals: newSignals,
      is_pro: true,
    });
  } catch (error) {
    console.error('[Signals] Check error:', error);
    return c.json({ error: 'Failed to check signals' }, 500);
  }
});

// ============================================
// MARK SIGNAL AS SEEN
// ============================================

signals.post('/:signalId/seen', async (c) => {
  const userId = c.get('userId');
  const signalId = c.req.param('signalId');
  
  try {
    await markSignalSeen(userId, signalId);
    return c.json({ success: true });
  } catch (error) {
    console.error('[Signals] Mark seen error:', error);
    return c.json({ error: 'Failed to mark signal seen' }, 500);
  }
});

// ============================================
// GENERATE CLUE FROM SIGNAL (On-demand)
// ============================================

signals.post('/:signalId/clue', async (c) => {
  const userId = c.get('userId');
  const signalId = c.req.param('signalId');
  
  const sub = await getSubscription(userId);
  if (sub?.tier !== 'pro') {
    return c.json({ 
      error: 'On-demand clues require Pro subscription',
      upgrade_url: '/subscription/checkout',
    }, 403);
  }
  
  try {
    const signal = { id: signalId } as any; // Would fetch from DB
    const clue = await generateClueFromSignal(userId, signal);
    
    return c.json({ clue });
  } catch (error) {
    console.error('[Signals] Generate clue error:', error);
    return c.json({ error: 'Failed to generate clue' }, 500);
  }
});

export default signals;
