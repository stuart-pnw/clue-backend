import { env } from '../lib/env.js';

// ============================================
// PUSH NOTIFICATION SERVICE
// Uses Firebase Cloud Messaging
// ============================================

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
}

let firebaseAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getFirebaseAccessToken(): Promise<string | null> {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_CLIENT_EMAIL) {
    console.log('[Push] Firebase not configured');
    return null;
  }
  
  // Return cached token if valid
  if (firebaseAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return firebaseAccessToken;
  }
  
  try {
    // Create JWT for service account
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: env.FIREBASE_CLIENT_EMAIL,
      sub: env.FIREBASE_CLIENT_EMAIL,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    };
    
    // Note: In production, use proper JWT signing with the private key
    // This is a simplified version - use google-auth-library in production
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: 'YOUR_JWT_HERE', // Would be signed JWT in production
      }),
    });
    
    if (!response.ok) {
      console.error('[Push] Failed to get Firebase token');
      return null;
    }
    
    const data = await response.json() as { access_token: string; expires_in: number };
    firebaseAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    
    return firebaseAccessToken;
    
  } catch (error) {
    console.error('[Push] Token error:', error);
    return null;
  }
}

// ============================================
// SEND PUSH NOTIFICATION
// ============================================

export async function sendPushNotification(
  deviceToken: string,
  payload: PushPayload
): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  
  if (!accessToken) {
    console.log('[Push] Skipping - no access token');
    return false;
  }
  
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data: payload.data,
            apns: {
              payload: {
                aps: {
                  badge: payload.badge,
                  sound: 'default',
                },
              },
            },
            android: {
              priority: 'high',
              notification: {
                sound: 'default',
                channelId: 'clue_notifications',
              },
            },
          },
        }),
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.error('[Push] Send failed:', error);
      return false;
    }
    
    console.log('[Push] Sent to', deviceToken.slice(0, 20) + '...');
    return true;
    
  } catch (error) {
    console.error('[Push] Error:', error);
    return false;
  }
}

// ============================================
// SEND TO MULTIPLE DEVICES
// ============================================

export async function sendPushToMultiple(
  deviceTokens: string[],
  payload: PushPayload
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  // Send in parallel batches of 10
  const batchSize = 10;
  for (let i = 0; i < deviceTokens.length; i += batchSize) {
    const batch = deviceTokens.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(token => sendPushNotification(token, payload))
    );
    
    success += results.filter(r => r).length;
    failed += results.filter(r => !r).length;
  }
  
  return { success, failed };
}

// ============================================
// NOTIFICATION TYPES
// ============================================

export async function sendDailyCluesNotification(
  deviceToken: string,
  clueCount: number
): Promise<boolean> {
  return sendPushNotification(deviceToken, {
    title: 'Your clues are ready ☀️',
    body: `${clueCount} insights from your network`,
    data: { type: 'daily_clues', screen: 'daily' },
  });
}

export async function sendStreakRiskNotification(
  deviceToken: string,
  currentStreak: number
): Promise<boolean> {
  return sendPushNotification(deviceToken, {
    title: `Don't lose your ${currentStreak}-day streak! 🔥`,
    body: 'Review your clues before midnight',
    data: { type: 'streak_risk', screen: 'daily' },
  });
}

export async function sendFriendJoinedNotification(
  deviceToken: string,
  friendName: string,
  source: string
): Promise<boolean> {
  return sendPushNotification(deviceToken, {
    title: `${friendName} joined Clue`,
    body: `Your ${source} connection is now on Clue`,
    data: { type: 'friend_joined', screen: 'leaderboard' },
  });
}
