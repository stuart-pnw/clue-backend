import { env } from '../lib/env.js';
import { getConnectedAccount, upsertConnectedAccount } from '../db/client.js';

// ============================================
// TYPES
// ============================================

export interface LinkedInProfile {
  id: string;
  localizedFirstName: string;
  localizedLastName: string;
  profilePicture?: {
    displayImage: string;
  };
}

export interface LinkedInConnection {
  id: string;
  firstName: string;
  lastName: string;
  headline?: string;
  profileUrl?: string;
}

export interface LinkedInPost {
  id: string;
  author: string;
  authorName: string;
  authorHeadline?: string;
  text: string;
  created: number;
  numLikes: number;
  numComments: number;
  numShares: number;
}

// ============================================
// TOKEN REFRESH
// ============================================

async function refreshAccessToken(userId: string): Promise<string | null> {
  const account = await getConnectedAccount(userId, 'linkedin');
  if (!account || !account.refresh_token) return null;
  
  try {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    
    if (!res.ok) return null;
    
    const tokens = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    
    await upsertConnectedAccount({
      user_id: userId,
      platform: 'linkedin',
      platform_user_id: account.platform_user_id,
      platform_username: account.platform_username,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: account.scopes,
    });
    
    return tokens.access_token;
  } catch (error) {
    console.error('[LinkedIn] Token refresh failed:', error);
    return null;
  }
}

async function getValidToken(userId: string): Promise<string | null> {
  const account = await getConnectedAccount(userId, 'linkedin');
  if (!account) return null;
  
  if (account.token_expires_at) {
    const expiresAt = new Date(account.token_expires_at);
    if (expiresAt < new Date()) {
      return refreshAccessToken(userId);
    }
  }
  
  return account.access_token;
}

// ============================================
// API CALLS
// ============================================

async function linkedInFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  const token = await getValidToken(userId);
  if (!token) return null;
  
  const res = await fetch(`https://api.linkedin.com/v2${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  
  if (!res.ok) {
    console.error(`[LinkedIn] API error: ${res.status}`);
    return null;
  }
  
  return res.json() as Promise<T>;
}

// ============================================
// GET PROFILE
// ============================================

export async function getProfile(userId: string): Promise<LinkedInProfile | null> {
  return linkedInFetch<LinkedInProfile>(
    userId,
    '/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))'
  );
}

// ============================================
// GET CONNECTIONS
// Note: LinkedIn API has limited access to connections
// This requires specific partnership permissions
// ============================================

export async function getConnections(userId: string): Promise<LinkedInConnection[]> {
  // LinkedIn's connections API is restricted
  // Most apps use the "Share" and "ugcPosts" APIs instead
  // This is a placeholder for when access is granted
  
  const res = await linkedInFetch<{
    elements: Array<{
      miniProfile: {
        publicIdentifier: string;
        firstName: { localized: { en_US: string } };
        lastName: { localized: { en_US: string } };
        occupation: string;
      };
    }>;
  }>(userId, '/connections?q=viewer&start=0&count=100');
  
  if (!res?.elements) return [];
  
  return res.elements.map(e => ({
    id: e.miniProfile.publicIdentifier,
    firstName: e.miniProfile.firstName?.localized?.en_US || '',
    lastName: e.miniProfile.lastName?.localized?.en_US || '',
    headline: e.miniProfile.occupation,
  }));
}

// ============================================
// GET FEED POSTS
// Uses the UGC Posts API
// ============================================

export async function getFeedPosts(userId: string, count = 50): Promise<LinkedInPost[]> {
  // Get posts from user's feed
  // Note: This requires specific API access
  const res = await linkedInFetch<{
    elements: Array<{
      id: string;
      author: string;
      created: { time: number };
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: string };
        };
      };
      socialDetail: {
        totalShareStatistics: {
          likeCount: number;
          commentCount: number;
          shareCount: number;
        };
      };
    }>;
  }>(userId, '/ugcPosts?q=authors&sortBy=LAST_MODIFIED&count=' + count);
  
  if (!res?.elements) return [];
  
  return res.elements.map(post => ({
    id: post.id,
    author: post.author,
    authorName: '', // Would need separate lookup
    text: post.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '',
    created: post.created?.time || Date.now(),
    numLikes: post.socialDetail?.totalShareStatistics?.likeCount || 0,
    numComments: post.socialDetail?.totalShareStatistics?.commentCount || 0,
    numShares: post.socialDetail?.totalShareStatistics?.shareCount || 0,
  }));
}

// ============================================
// RANK POSTS
// ============================================

export interface RankedLinkedInPost extends LinkedInPost {
  score: number;
  engagementVelocity: number;
  platform: 'linkedin';
}

export function filterAndRankPosts(
  posts: LinkedInPost[],
  hoursBack = 48
): RankedLinkedInPost[] {
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  
  return posts
    .filter(post => post.created > cutoff && post.text.length > 50)
    .map(post => {
      const hoursOld = Math.max(1, (Date.now() - post.created) / (1000 * 60 * 60));
      const totalEngagement = post.numLikes + post.numComments * 3 + post.numShares * 5;
      const engagementVelocity = totalEngagement / hoursOld;
      const score = engagementVelocity;
      
      return { ...post, score, engagementVelocity, platform: 'linkedin' as const };
    })
    .sort((a, b) => b.score - a.score);
}

// ============================================
// FULL PIPELINE
// ============================================

export async function fetchLinkedInActivity(userId: string): Promise<RankedLinkedInPost[]> {
  console.log(`[LinkedIn] Fetching activity for user ${userId}`);
  
  const posts = await getFeedPosts(userId);
  console.log(`[LinkedIn] Fetched ${posts.length} posts`);
  
  const ranked = filterAndRankPosts(posts);
  console.log(`[LinkedIn] ${ranked.length} posts after filtering`);
  
  return ranked;
}
