import { Hono } from 'hono';
import { env } from '../lib/env.js';
import { signToken, verifyToken, extractToken } from '../lib/jwt.js';
import { 
  createUser, 
  getUserByEmail, 
  getUserById,
  upsertConnectedAccount 
} from '../db/client.js';

const auth = new Hono();

// ============================================
// GOOGLE OAUTH
// ============================================

auth.get('/google', (c) => {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.CALLBACK_URL}/google`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });
  
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get('/callback/google', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }
  
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: `${env.CALLBACK_URL}/google`,
        grant_type: 'authorization_code',
      }),
    });
    
    const tokens = await tokenRes.json() as { access_token: string };
    
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    
    const googleUser = await userRes.json() as { 
      id: string; email: string; name: string; picture: string;
    };
    
    let user = await getUserByEmail(googleUser.email);
    
    if (!user) {
      user = await createUser({
        email: googleUser.email,
        name: googleUser.name,
        avatar_url: googleUser.picture,
        auth_provider: 'google',
      });
    }
    
    const jwt = await signToken(user);
    return c.redirect(`${env.APP_URL}/auth/success?token=${jwt}`);
    
  } catch (error) {
    console.error('Google auth error:', error);
    return c.redirect(`${env.APP_URL}/auth/error?message=google_auth_failed`);
  }
});

// ============================================
// X (TWITTER) OAUTH 2.0
// ============================================

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const codeVerifiers = new Map<string, string>();
const xConnectVerifiers = new Map<string, string>();

auth.get('/x', async (c) => {
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  
  codeVerifiers.set(state, codeVerifier);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID,
    redirect_uri: `${env.CALLBACK_URL}/x`,
    scope: 'tweet.read users.read follows.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  return c.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

auth.get('/callback/x', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  
  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400);
  
  const codeVerifier = codeVerifiers.get(state);
  if (!codeVerifier) return c.json({ error: 'Invalid state' }, 400);
  
  codeVerifiers.delete(state);
  
  try {
    const basicAuth = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
    
    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${env.CALLBACK_URL}/x`,
        code_verifier: codeVerifier,
      }),
    });
    
    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token: string; expires_in: number;
    };
    
    const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    
    const { data: xUser } = await userRes.json() as {
      data: { id: string; name: string; username: string; profile_image_url: string };
    };
    
    const email = `${xUser.username}@x.clue.app`;
    let user = await getUserByEmail(email);
    
    if (!user) {
      user = await createUser({
        email,
        name: xUser.name,
        avatar_url: xUser.profile_image_url,
        auth_provider: 'x',
      });
    }
    
    await upsertConnectedAccount({
      user_id: user.id,
      platform: 'x',
      platform_user_id: xUser.id,
      platform_username: xUser.username,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
    });
    
    const jwt = await signToken(user);
    return c.redirect(`${env.APP_URL}/auth/success?token=${jwt}`);
    
  } catch (error) {
    console.error('X auth error:', error);
    return c.redirect(`${env.APP_URL}/auth/error?message=x_auth_failed`);
  }
});

// ============================================
// SESSION ENDPOINTS
// ============================================

auth.get('/me', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const user = await getUserById(payload.sub);
  if (!user) return c.json({ error: 'User not found' }, 404);
  
  return c.json({ user });
});

auth.post('/logout', (c) => c.json({ success: true }));

auth.post('/refresh', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const user = await getUserById(payload.sub);
  if (!user) return c.json({ error: 'User not found' }, 404);
  
  const newToken = await signToken(user);
  return c.json({ token: newToken });
});

// ============================================
// LINKEDIN OAUTH
// ============================================

auth.get('/linkedin', (c) => {
  const state = crypto.randomUUID();
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: `${env.CALLBACK_URL}/linkedin`,
    scope: 'openid profile email',
    state,
  });
  
  return c.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

auth.get('/callback/linkedin', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'Missing code' }, 400);
  
  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.CALLBACK_URL}/linkedin`,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    
    const tokens = await tokenRes.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };
    
    // Get user info using OpenID Connect userinfo endpoint
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    
    const linkedInUser = await userRes.json() as {
      sub: string;
      name: string;
      given_name: string;
      family_name: string;
      picture?: string;
      email: string;
      email_verified: boolean;
    };
    
    // Find or create user
    let user = await getUserByEmail(linkedInUser.email);
    
    if (!user) {
      user = await createUser({
        email: linkedInUser.email,
        name: linkedInUser.name,
        avatar_url: linkedInUser.picture || null,
        auth_provider: 'linkedin',
      });
    }
    
    // Save connected account
    await upsertConnectedAccount({
      user_id: user.id,
      platform: 'linkedin',
      platform_user_id: linkedInUser.sub,
      platform_username: linkedInUser.email.split('@')[0],
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: ['openid', 'profile', 'email'],
    });
    
    const jwt = await signToken(user);
    return c.redirect(`${env.APP_URL}/auth/success?token=${jwt}`);
    
  } catch (error) {
    console.error('LinkedIn auth error:', error);
    return c.redirect(`${env.APP_URL}/auth/error?message=linkedin_auth_failed`);
  }
});

// Connect LinkedIn (for existing users)

auth.get('/connect/x', async (c) => {
  const token = c.req.query('token') || extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);

  const state = `connect:${payload.sub}:${crypto.randomUUID()}`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  xConnectVerifiers.set(state, codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID,
    redirect_uri: `${env.CALLBACK_URL}/x/connect`,
    scope: 'tweet.read users.read follows.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return c.redirect(`https://twitter.com/i/oauth2/authorize?${params}`);
});

auth.get('/callback/x/connect', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) return c.json({ error: 'Missing code or state' }, 400);

  const codeVerifier = xConnectVerifiers.get(state);
  if (!codeVerifier) return c.json({ error: 'Invalid state' }, 400);

  xConnectVerifiers.delete(state);

  const [, userId] = state.split(':');
  if (!userId) return c.json({ error: 'Invalid state format' }, 400);

  try {
    const basicAuth = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: env.X_CLIENT_ID,
        redirect_uri: `${env.CALLBACK_URL}/x/connect`,
        code_verifier: codeVerifier,
      }),
    });

    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token: string; expires_in: number;
    };

    const userRes = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const { data: xUser } = await userRes.json() as {
      data: { id: string; name: string; username: string; profile_image_url: string };
    };

    await upsertConnectedAccount({
      user_id: userId,
      platform: 'x',
      platform_user_id: xUser.id,
      platform_username: xUser.username,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: ['tweet.read', 'users.read', 'follows.read', 'offline.access'],
    });

    return c.redirect(`${env.APP_URL}/auth/success`);
  } catch (error) {
    console.error('X connect callback error:', error);
    return c.json({ error: 'Failed to connect X account' }, 500);
  }
});

auth.get('/connect/linkedin', async (c) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  const state = `connect:${payload.sub}:${crypto.randomUUID()}`;
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: `${env.CALLBACK_URL}/linkedin/connect`,
    scope: 'openid profile email',
    state,
  });
  
  return c.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

auth.get('/callback/linkedin/connect', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  
  if (!code || !state || !state.startsWith('connect:')) {
    return c.json({ error: 'Invalid request' }, 400);
  }
  
  const [, userId] = state.split(':');
  
  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${env.CALLBACK_URL}/linkedin/connect`,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    
    const tokens = await tokenRes.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    
    const linkedInUser = await userRes.json() as {
      sub: string;
      email: string;
    };
    
    await upsertConnectedAccount({
      user_id: userId,
      platform: 'linkedin',
      platform_user_id: linkedInUser.sub,
      platform_username: linkedInUser.email.split('@')[0],
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: ['openid', 'profile', 'email'],
    });
    
    return c.redirect(`${env.APP_URL}/settings?connected=linkedin`);
    
  } catch (error) {
    console.error('LinkedIn connect error:', error);
    return c.redirect(`${env.APP_URL}/settings?error=linkedin_connect_failed`);
  }
});

export default auth;
