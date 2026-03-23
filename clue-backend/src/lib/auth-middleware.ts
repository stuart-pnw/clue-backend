import { Context, Next } from 'hono';
import { verifyToken, extractToken } from './jwt.js';
import { getUserById } from '../db/client.js';
import { AuthenticationError, AuthorizationError } from './errors.js';
import { getSubscription } from '../services/billing.js';

// ============================================
// REQUIRE AUTH MIDDLEWARE
// ============================================

export async function requireAuth(c: Context, next: Next) {
  const token = extractToken(c.req.header('Authorization'));
  
  if (!token) {
    throw new AuthenticationError('Missing authorization token');
  }
  
  const payload = await verifyToken(token);
  
  if (!payload) {
    throw new AuthenticationError('Invalid or expired token');
  }
  
  // Set user info on context
  c.set('userId', payload.sub);
  c.set('userEmail', payload.email);
  c.set('userName', payload.name);
  
  await next();
}

// ============================================
// OPTIONAL AUTH MIDDLEWARE
// ============================================

export async function optionalAuth(c: Context, next: Next) {
  const token = extractToken(c.req.header('Authorization'));
  
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      c.set('userId', payload.sub);
      c.set('userEmail', payload.email);
      c.set('userName', payload.name);
    }
  }
  
  await next();
}

// ============================================
// REQUIRE PRO SUBSCRIPTION
// ============================================

export async function requirePro(c: Context, next: Next) {
  const userId = c.get('userId');
  
  if (!userId) {
    throw new AuthenticationError();
  }
  
  const subscription = await getSubscription(userId);
  
  if (subscription?.tier !== 'pro') {
    throw new AuthorizationError('This feature requires a Pro subscription');
  }
  
  c.set('subscription', subscription);
  await next();
}

// ============================================
// REQUIRE ONBOARDING COMPLETE
// ============================================

export async function requireOnboarding(c: Context, next: Next) {
  const userId = c.get('userId');
  
  if (!userId) {
    throw new AuthenticationError();
  }
  
  const user = await getUserById(userId);
  
  if (!user?.onboarding_complete) {
    throw new AuthorizationError('Please complete onboarding first');
  }
  
  await next();
}

// ============================================
// TYPED CONTEXT HELPERS
// ============================================

export function getUserId(c: Context): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new AuthenticationError();
  }
  return userId;
}

export function getOptionalUserId(c: Context): string | undefined {
  return c.get('userId');
}
