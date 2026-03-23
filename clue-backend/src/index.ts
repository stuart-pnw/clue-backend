import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

import { env, validateEnv } from './lib/env.js';
import { errorHandler } from './lib/errors.js';
import { standardLimit, authLimit, aiLimit } from './lib/rate-limit.js';
import { requestLogger } from './lib/logger.js';

// Routes
import auth from './routes/auth.js';
import user from './routes/user.js';
import clues from './routes/clues.js';
import notifications from './routes/notifications.js';
import learn from './routes/learn.js';
import subscription from './routes/subscription.js';
import referrals from './routes/referrals.js';
import leaderboard from './routes/leaderboard.js';
import achievements from './routes/achievements.js';
import shares from './routes/shares.js';
import signals from './routes/signals.js';
import gdpr from './routes/gdpr.js';
import health from './routes/health.js';
import analytics from './routes/analytics.js';

// Jobs
import { startScheduler } from './jobs/streak.js';
import { startDeliveryScheduler } from './jobs/delivery.js';
import { startPrivacyCleanupScheduler } from './jobs/privacy-cleanup.js';

// Validate environment
validateEnv();

// Create app
const app = new Hono();

// ============================================
// GLOBAL MIDDLEWARE
// ============================================

// CORS
app.use('*', cors({
  origin: [env.APP_URL, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
}));

// Request logging
app.use('*', requestLogger());

// Global rate limiting
app.use('*', standardLimit);

// ============================================
// HEALTH CHECKS (no auth)
// ============================================

app.route('/health', health);

app.get('/', (c) => c.json({ 
  status: 'ok', 
  service: 'clue-backend',
  version: '1.0.0',
}));

// ============================================
// AUTH ROUTES (stricter rate limit)
// ============================================

app.use('/auth/*', authLimit);
app.route('/auth', auth);

// ============================================
// API ROUTES
// ============================================

app.route('/user', user);
app.route('/clues', clues);
app.route('/notifications', notifications);
app.route('/subscription', subscription);
app.route('/referrals', referrals);
app.route('/leaderboard', leaderboard);
app.route('/achievements', achievements);
app.route('/shares', shares);
app.route('/signals', signals);
app.route('/gdpr', gdpr);
app.route('/analytics', analytics);

// AI routes (stricter rate limit)
app.use('/learn/*', aiLimit);
app.route('/learn', learn);

// ============================================
// ERROR HANDLING
// ============================================

app.notFound((c) => c.json({ 
  error: { code: 'NOT_FOUND', message: 'Endpoint not found' }
}, 404));

app.onError((err, c) => errorHandler(err, c));

// ============================================
// START SERVER
// ============================================

const port = Number(env.PORT);
console.log(`🚀 Clue backend starting on port ${port}`);

serve({ fetch: app.fetch, port });

// Start background jobs in production
if (env.NODE_ENV === 'production') {
  startScheduler();
  startDeliveryScheduler();
  startPrivacyCleanupScheduler(); // CRITICAL: Ensures 24-hour data deletion
  console.log('📋 Background jobs started');
}

console.log(`✅ Server running at http://localhost:${port}`);
console.log(`📊 Health check: http://localhost:${port}/health/detailed`);

export default app;

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Start server
const port = Number(env.PORT);
console.log(`🚀 Clue backend starting on port ${port}`);

serve({ fetch: app.fetch, port });

// Start background jobs
if (env.NODE_ENV === 'production') {
  startScheduler();
  startDeliveryScheduler();
}

console.log(`✅ Server running at http://localhost:${port}`);
console.log(`📊 Health check: http://localhost:${port}/health/detailed`);

export default app;
