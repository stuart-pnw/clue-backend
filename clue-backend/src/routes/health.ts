import { Hono } from 'hono';
import { getSupabase } from '../db/client.js';
import { env } from '../lib/env.js';

const health = new Hono();

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: CheckResult;
    external_apis: CheckResult;
  };
}

interface CheckResult {
  status: 'pass' | 'fail' | 'warn';
  latency_ms?: number;
  message?: string;
}

const startTime = Date.now();

// ============================================
// BASIC HEALTH CHECK
// ============================================

health.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// DETAILED HEALTH CHECK
// ============================================

health.get('/detailed', async (c) => {
  const checks: HealthCheck['checks'] = {
    database: { status: 'pass' },
    external_apis: { status: 'pass' },
  };
  
  // Check database
  try {
    const start = Date.now();
    const db = getSupabase();
    await db.from('users').select('id').limit(1);
    checks.database = {
      status: 'pass',
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    checks.database = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Database error',
    };
  }
  
  // Check external APIs (just verify config exists)
  const missingConfigs: string[] = [];
  
  if (!env.ANTHROPIC_API_KEY) missingConfigs.push('ANTHROPIC_API_KEY');
  if (!env.X_CLIENT_ID) missingConfigs.push('X_CLIENT_ID');
  if (!env.STRIPE_SECRET_KEY) missingConfigs.push('STRIPE_SECRET_KEY');
  
  if (missingConfigs.length > 0) {
    checks.external_apis = {
      status: 'warn',
      message: `Missing config: ${missingConfigs.join(', ')}`,
    };
  }
  
  // Determine overall status
  let status: HealthCheck['status'] = 'healthy';
  
  if (checks.database.status === 'fail') {
    status = 'unhealthy';
  } else if (checks.database.status === 'warn' || checks.external_apis.status === 'warn') {
    status = 'degraded';
  }
  
  const healthCheck: HealthCheck = {
    status,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };
  
  const statusCode = status === 'unhealthy' ? 503 : 200;
  
  return c.json(healthCheck, statusCode as any);
});

// ============================================
// READINESS CHECK (for k8s)
// ============================================

health.get('/ready', async (c) => {
  try {
    const db = getSupabase();
    await db.from('users').select('id').limit(1);
    return c.json({ ready: true });
  } catch {
    return c.json({ ready: false }, 503);
  }
});

// ============================================
// LIVENESS CHECK (for k8s)
// ============================================

health.get('/live', (c) => {
  return c.json({ live: true });
});

export default health;
