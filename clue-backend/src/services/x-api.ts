import { env } from '../lib/env.js';
import { getConnectedAccount, upsertConnectedAccount } from '../db/client.js';

// ============================================
// TYPES
// ============================================

export interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  description?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
}

export interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count: number;
  };
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }>;
  entities?: {
    urls?: Array<{ expanded_url: string; title?: string }>;
    mentions?: Array<{ username: string }>;
    hashtags?: Array<{ tag: string }>;
  };
}

// ============================================
// TOKEN REFRESH
// ============================================

async function refreshAccessToken(userId: string): Promise<string | null> {
  const account = await getConnectedAccount(userId, 'x');
  if (!account || !account.refresh_token) return null;
  
  try {
    const basicAuth = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
    
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token,
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
      platform: 'x',
      platform_user_id: account.platform_user_id,
      platform_username: account.platform_username,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: account.scopes,
    });
    
    return tokens.access_token;
    
  } catch (error) {
    console.error('Token refresh failed:', error);
    return null;
  }
}

async function getValidToken(userId: string): Promise<string | null> {
  const account = await getConnectedAccount(userId, 'x');
  if (!account) return null;
  
  // Check if token is expired
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

async function xFetch<T>(
  userId: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  const token = await getValidToken(userId);
  if (!token) return null;
  
  const url = new URL(`https://api.twitter.com/2${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  
  if (!res.ok) {
    console.error(`X API error: ${res.status} ${await res.text()}`);
    return null;
  }
  
  return res.json() as Promise<T>;
}

// ============================================
// GET FOLLOWING
// ============================================

export async function getFollowing(
  userId: string,
  maxResults = 1000
): Promise<XUser[]> {
  const account = await getConnectedAccount(userId, 'x');
  if (!account) return [];
  
  const users: XUser[] = [];
  let paginationToken: string | undefined;
  
  do {
    const params: Record<string, string> = {
      'max_results': '1000',
      'user.fields': 'description,profile_image_url,public_metrics',
    };
    if (paginationToken) params['pagination_token'] = paginationToken;
    
    const res = await xFetch<{
      data: XUser[];
      meta: { next_token?: string };
    }>(userId, `/users/${account.platform_user_id}/following`, params);
    
    if (!res?.data) break;
    
    users.push(...res.data);
    paginationToken = res.meta.next_token;
    
  } while (paginationToken && users.length < maxResults);
  
  return users;
}

// ============================================
// GET RECENT TWEETS FROM USER
// ============================================

export async function getUserTweets(
  userId: string,
  targetUserId: string,
  maxResults = 10
): Promise<XTweet[]> {
  const res = await xFetch<{ data: XTweet[] }>(
    userId,
    `/users/${targetUserId}/tweets`,
    {
      'max_results': String(maxResults),
      'tweet.fields': 'created_at,public_metrics,referenced_tweets,entities',
      'exclude': 'replies,retweets',
    }
  );
  
  return res?.data || [];
}

// ============================================
// GET TWEETS FROM MULTIPLE USERS
// ============================================

export async function getTweetsFromFollowing(
  userId: string,
  following: XUser[],
  tweetsPerUser = 5,
  maxUsers = 100
): Promise<Array<XTweet & { author: XUser }>> {
  const tweets: Array<XTweet & { author: XUser }> = [];
  
  // Sort by follower count (prioritize influential follows)
  const sortedFollowing = [...following]
    .sort((a, b) => (b.public_metrics?.followers_count || 0) - (a.public_metrics?.followers_count || 0))
    .slice(0, maxUsers);
  
  // Fetch tweets in parallel batches
  const batchSize = 10;
  for (let i = 0; i < sortedFollowing.length; i += batchSize) {
    const batch = sortedFollowing.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (user) => {
        const userTweets = await getUserTweets(userId, user.id, tweetsPerUser);
        return userTweets.map(tweet => ({ ...tweet, author: user }));
      })
    );
    
    tweets.push(...batchResults.flat());
  }
  
  return tweets;
}

// ============================================
// FILTER & RANK TWEETS
// ============================================

export interface RankedTweet extends XTweet {
  author: XUser;
  score: number;
  engagementVelocity: number;
}

export function filterAndRankTweets(
  tweets: Array<XTweet & { author: XUser }>,
  hoursBack = 24
): RankedTweet[] {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  
  return tweets
    // Filter out old tweets, replies, and retweets
    .filter(tweet => {
      const createdAt = new Date(tweet.created_at);
      if (createdAt < cutoff) return false;
      if (tweet.referenced_tweets?.some(rt => rt.type === 'retweeted')) return false;
      if (tweet.text.startsWith('RT @')) return false;
      return true;
    })
    // Calculate engagement score
    .map(tweet => {
      const metrics = tweet.public_metrics || {
        like_count: 0,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        impression_count: 1,
      };
      
      // Engagement velocity (engagement per hour since posted)
      const hoursOld = Math.max(1, (Date.now() - new Date(tweet.created_at).getTime()) / (1000 * 60 * 60));
      const totalEngagement = metrics.like_count + metrics.retweet_count * 2 + metrics.reply_count * 3 + metrics.quote_count * 4;
      const engagementVelocity = totalEngagement / hoursOld;
      
      // Score combines velocity with author influence
      const authorInfluence = Math.log10(tweet.author.public_metrics?.followers_count || 1000);
      const score = engagementVelocity * authorInfluence;
      
      return { ...tweet, score, engagementVelocity };
    })
    // Sort by score
    .sort((a, b) => b.score - a.score);
}

// ============================================
// FULL PIPELINE: FETCH & PROCESS
// ============================================

export async function fetchNetworkActivity(userId: string): Promise<RankedTweet[]> {
  console.log(`[X] Fetching network activity for user ${userId}`);
  
  // Get who user follows
  const following = await getFollowing(userId);
  console.log(`[X] Found ${following.length} following`);
  
  if (following.length === 0) return [];
  
  // Get recent tweets from those users
  const tweets = await getTweetsFromFollowing(userId, following);
  console.log(`[X] Fetched ${tweets.length} tweets`);
  
  // Filter and rank
  const ranked = filterAndRankTweets(tweets);
  console.log(`[X] ${ranked.length} tweets after filtering`);
  
  return ranked;
}
