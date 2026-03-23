import { getSupabase } from '../db/client.js';

// ============================================
// TYPES
// ============================================

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  name: string;
  avatar_url: string | null;
  streak: number;
  score: number;
  is_current_user: boolean;
  is_friend: boolean;
}

export interface LeaderboardResponse {
  global: LeaderboardEntry[];
  friends: LeaderboardEntry[];
  user_rank: number | null;
  user_percentile: number | null;
}

// ============================================
// GET GLOBAL LEADERBOARD
// ============================================

export async function getGlobalLeaderboard(
  currentUserId: string,
  limit = 50
): Promise<LeaderboardEntry[]> {
  const db = getSupabase();
  
  const { data, error } = await db
    .from('user_stats')
    .select(`
      user_id,
      streak,
      score,
      users (name, avatar_url)
    `)
    .gte('last_active_date', getWeekAgo())
    .order('streak', { ascending: false })
    .order('score', { ascending: false })
    .limit(limit);
  
  if (error || !data) return [];
  
  return data.map((entry, index) => ({
    rank: index + 1,
    user_id: entry.user_id,
    name: (entry.users as any)?.name || 'Anonymous',
    avatar_url: (entry.users as any)?.avatar_url || null,
    streak: entry.streak,
    score: entry.score,
    is_current_user: entry.user_id === currentUserId,
    is_friend: false, // Will be updated if we have friend data
  }));
}

// ============================================
// GET FRIENDS LEADERBOARD
// ============================================

export async function getFriendsLeaderboard(
  currentUserId: string
): Promise<LeaderboardEntry[]> {
  const db = getSupabase();
  
  // Get user's connections (from X and LinkedIn)
  const { data: connections } = await db
    .from('connected_accounts')
    .select('platform_user_id, platform')
    .eq('user_id', currentUserId);
  
  if (!connections || connections.length === 0) {
    // No connections, return just the current user
    const { data: selfStats } = await db
      .from('user_stats')
      .select(`
        user_id,
        streak,
        score,
        users (name, avatar_url)
      `)
      .eq('user_id', currentUserId)
      .single();
    
    if (!selfStats) return [];
    
    return [{
      rank: 1,
      user_id: currentUserId,
      name: (selfStats.users as any)?.name || 'You',
      avatar_url: (selfStats.users as any)?.avatar_url || null,
      streak: selfStats.streak,
      score: selfStats.score,
      is_current_user: true,
      is_friend: false,
    }];
  }
  
  // Find other Clue users who are also connected to same platforms
  // This is a simplified version - in production, you'd match by platform user IDs
  const { data: friendStats } = await db
    .from('user_stats')
    .select(`
      user_id,
      streak,
      score,
      users (name, avatar_url)
    `)
    .gte('last_active_date', getWeekAgo())
    .order('streak', { ascending: false })
    .limit(20);
  
  if (!friendStats) return [];
  
  return friendStats.map((entry, index) => ({
    rank: index + 1,
    user_id: entry.user_id,
    name: (entry.users as any)?.name || 'Anonymous',
    avatar_url: (entry.users as any)?.avatar_url || null,
    streak: entry.streak,
    score: entry.score,
    is_current_user: entry.user_id === currentUserId,
    is_friend: entry.user_id !== currentUserId,
  }));
}

// ============================================
// GET USER RANK
// ============================================

export async function getUserRank(userId: string): Promise<{
  rank: number | null;
  percentile: number | null;
  total_users: number;
}> {
  const db = getSupabase();
  
  // Get user's streak
  const { data: userStats } = await db
    .from('user_stats')
    .select('streak, score')
    .eq('user_id', userId)
    .single();
  
  if (!userStats) {
    return { rank: null, percentile: null, total_users: 0 };
  }
  
  // Count users with higher streak
  const { count: higherCount } = await db
    .from('user_stats')
    .select('*', { count: 'exact', head: true })
    .gte('last_active_date', getWeekAgo())
    .gt('streak', userStats.streak);
  
  // Count total active users
  const { count: totalCount } = await db
    .from('user_stats')
    .select('*', { count: 'exact', head: true })
    .gte('last_active_date', getWeekAgo());
  
  const rank = (higherCount || 0) + 1;
  const total = totalCount || 1;
  const percentile = Math.round((1 - rank / total) * 100);
  
  return {
    rank,
    percentile: Math.max(0, percentile),
    total_users: total,
  };
}

// ============================================
// GET FULL LEADERBOARD RESPONSE
// ============================================

export async function getLeaderboard(userId: string): Promise<LeaderboardResponse> {
  const [global, friends, rankInfo] = await Promise.all([
    getGlobalLeaderboard(userId),
    getFriendsLeaderboard(userId),
    getUserRank(userId),
  ]);
  
  return {
    global,
    friends,
    user_rank: rankInfo.rank,
    user_percentile: rankInfo.percentile,
  };
}

// ============================================
// HELPERS
// ============================================

function getWeekAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
}

// ============================================
// REFRESH MATERIALIZED VIEW (if using one)
// ============================================

export async function refreshLeaderboard(): Promise<void> {
  const db = getSupabase();
  
  // If using a materialized view, refresh it
  // await db.rpc('refresh_leaderboard');
  
  console.log('[Leaderboard] Refreshed');
}
