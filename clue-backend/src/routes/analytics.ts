import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { trackEvent, setUserProperties, EventName } from '../services/analytics.js';

const analytics = new Hono();

// ============================================
// TRACK EVENT (authenticated)
// ============================================

analytics.post('/event', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  let userId: string | null = null;
  
  if (token) {
    const payload = await verifyToken(token);
    userId = payload?.sub || null;
  }
  
  const body = await c.req.json<{
    event: string;
    properties?: Record<string, any>;
  }>();
  
  if (!body.event) {
    return c.json({ error: 'Event name required' }, 400);
  }
  
  await trackEvent(userId, body.event as EventName, body.properties);
  
  return c.json({ success: true });
});

// ============================================
// BATCH TRACK EVENTS
// ============================================

analytics.post('/events', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  let userId: string | null = null;
  
  if (token) {
    const payload = await verifyToken(token);
    userId = payload?.sub || null;
  }
  
  const body = await c.req.json<{
    events: Array<{
      event: string;
      properties?: Record<string, any>;
      timestamp?: string;
    }>;
  }>();
  
  if (!body.events || !Array.isArray(body.events)) {
    return c.json({ error: 'Events array required' }, 400);
  }
  
  // Track all events (fire and forget)
  Promise.all(
    body.events.map(e => 
      trackEvent(userId, e.event as EventName, e.properties)
    )
  ).catch(console.error);
  
  return c.json({ success: true, count: body.events.length });
});

// ============================================
// SET USER PROPERTIES (authenticated)
// ============================================

analytics.post('/identify', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const body = await c.req.json<{
    properties: Record<string, any>;
  }>();
  
  if (!body.properties) {
    return c.json({ error: 'Properties required' }, 400);
  }
  
  await setUserProperties(payload.sub, body.properties);
  
  return c.json({ success: true });
});

export default analytics;
