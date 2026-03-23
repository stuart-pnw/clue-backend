import { Context, Next } from 'hono';

// ============================================
// IN-MEMORY RATE LIMITER
// In production, use Redis for distributed rate limiting
// ============================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 60000); // Every minute

// ============================================
// RATE LIMIT CONFIG
// ============================================

export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (c: Context) => string;
  skip?: (c: Context) => boolean;
  onLimit?: (c: Context) => Response;
}

const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 60,       // 60 requests per minute
};

// ============================================
// RATE LIMIT MIDDLEWARE
// ============================================

export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  const opts = { ...defaultConfig, ...config };
  
  return async (c: Context, next: Next) => {
    // Skip if configured
    if (opts.skip?.(c)) {
      return next();
    }
    
    // Generate key (default: IP + path)
    const key = opts.keyGenerator?.(c) || getDefaultKey(c);
    const now = Date.now();
    
    // Get or create entry
    let entry = store.get(key);
    
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + opts.windowMs,
      };
    }
    
    entry.count++;
    store.set(key, entry);
    
    // Set rate limit headers
    const remaining = Math.max(0, opts.maxRequests - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    
    c.header('X-RateLimit-Limit', String(opts.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetSeconds));
    
    // Check if over limit
    if (entry.count > opts.maxRequests) {
      c.header('Retry-After', String(resetSeconds));
      
      if (opts.onLimit) {
        return opts.onLimit(c);
      }
      
      return c.json({
        error: 'Too many requests',
        retry_after: resetSeconds,
      }, 429);
    }
    
    return next();
  };
}

function getDefaultKey(c: Context): string {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0] || 
             c.req.header('x-real-ip') || 
             'unknown';
  const path = new URL(c.req.url).pathname;
  return `${ip}:${path}`;
}

// ============================================
// PRESET RATE LIMITERS
// ============================================

// Standard API rate limit
export const standardLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
});

// Auth endpoints (stricter)
export const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,          // 10 attempts
});

// AI endpoints (expensive)
export const aiLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

// Webhook endpoints (lenient)
export const webhookLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100,
});

// Per-user rate limit (requires auth)
export function userRateLimit(maxRequests: number, windowMs: number = 60000) {
  return rateLimit({
    windowMs,
    maxRequests,
    keyGenerator: (c) => {
      const userId = c.get('userId');
      const path = new URL(c.req.url).pathname;
      return userId ? `user:${userId}:${path}` : getDefaultKey(c);
    },
  });
}
