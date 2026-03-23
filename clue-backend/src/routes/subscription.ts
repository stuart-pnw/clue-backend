import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { getUserById } from '../db/client.js';
import {
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  handleWebhookEvent,
  TIER_LIMITS,
} from '../services/billing.js';

const subscription = new Hono();

// ============================================
// GET SUBSCRIPTION STATUS
// ============================================

subscription.get('/', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const sub = await getSubscription(payload.sub);
  
  return c.json({
    subscription: sub,
    limits: TIER_LIMITS[sub?.tier || 'free'],
  });
});

// ============================================
// CREATE CHECKOUT SESSION
// ============================================

subscription.post('/checkout', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const user = await getUserById(payload.sub);
  if (!user) return c.json({ error: 'User not found' }, 404);
  
  try {
    const url = await createCheckoutSession(user.id, user.email, user.name);
    return c.json({ url });
  } catch (error) {
    console.error('[Subscription] Checkout error:', error);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
});

// ============================================
// CREATE PORTAL SESSION
// ============================================

subscription.post('/portal', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  try {
    const url = await createPortalSession(payload.sub);
    return c.json({ url });
  } catch (error) {
    console.error('[Subscription] Portal error:', error);
    return c.json({ error: 'Failed to create portal session' }, 500);
  }
});

// ============================================
// STRIPE WEBHOOK
// ============================================

subscription.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }
  
  try {
    const payload = await c.req.text();
    await handleWebhookEvent(payload, signature);
    return c.json({ received: true });
  } catch (error) {
    console.error('[Subscription] Webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 400);
  }
});

export default subscription;
