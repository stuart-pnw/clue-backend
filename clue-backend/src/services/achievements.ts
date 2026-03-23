import { getSupabase } from '../db/client.js';

// ============================================
// ACHIEVEMENT DEFINITIONS
// ============================================

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'streak' | 'engagement' | 'social' | 'learning';
  requirement: number;
  check: (stats: UserAchievementStats) => boolean;
}

interface UserAchievementStats {
  streak: number;
  longest_streak: number;
  total_clues_seen: number;
  total_saved: number;
  total_shared: number;
  referrals_completed: number;
  learn_conversations: number;
  days_active: number;
  night_owl_count: number; // Clues viewed after 10pm
  early_bird_count: number; // Clues viewed before 7am
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Streak achievements
  {
    id: 'streak_3',
    name: 'Getting Started',
    description: '3-day streak',
    emoji: '🔥',
    category: 'streak',
    requirement: 3,
    check: (s) => s.streak >= 3,
  },
  {
    id: 'streak_7',
    name: 'Week Warrior',
    description: '7-day streak',
    emoji: '⚡',
    category: 'streak',
    requirement: 7,
    check: (s) => s.streak >= 7,
  },
  {
    id: 'streak_14',
    name: 'Fortnight Fighter',
    description: '14-day streak',
    emoji: '💎',
    category: 'streak',
    requirement: 14,
    check: (s) => s.streak >= 14,
  },
  {
    id: 'streak_30',
    name: 'Monthly Master',
    description: '30-day streak',
    emoji: '🏆',
    category: 'streak',
    requirement: 30,
    check: (s) => s.streak >= 30,
  },
  {
    id: 'streak_60',
    name: 'Legendary',
    description: '60-day streak',
    emoji: '👑',
    category: 'streak',
    requirement: 60,
    check: (s) => s.streak >= 60,
  },
  
  // Engagement achievements
  {
    id: 'saver_10',
    name: 'Collector',
    description: 'Save 10 clues',
    emoji: '📚',
    category: 'engagement',
    requirement: 10,
    check: (s) => s.total_saved >= 10,
  },
  {
    id: 'saver_50',
    name: 'Curator',
    description: 'Save 50 clues',
    emoji: '🗄️',
    category: 'engagement',
    requirement: 50,
    check: (s) => s.total_saved >= 50,
  },
  {
    id: 'saver_100',
    name: 'Archivist',
    description: 'Save 100 clues',
    emoji: '🏛️',
    category: 'engagement',
    requirement: 100,
    check: (s) => s.total_saved >= 100,
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'View clues after 10pm (5 times)',
    emoji: '🦉',
    category: 'engagement',
    requirement: 5,
    check: (s) => s.night_owl_count >= 5,
  },
  {
    id: 'early_bird',
    name: 'Early Bird',
    description: 'View clues before 7am (5 times)',
    emoji: '🐦',
    category: 'engagement',
    requirement: 5,
    check: (s) => s.early_bird_count >= 5,
  },
  
  // Social achievements
  {
    id: 'sharer_5',
    name: 'Spreader',
    description: 'Share 5 clues',
    emoji: '📤',
    category: 'social',
    requirement: 5,
    check: (s) => s.total_shared >= 5,
  },
  {
    id: 'referrer_1',
    name: 'Recruiter',
    description: 'Refer 1 friend',
    emoji: '🤝',
    category: 'social',
    requirement: 1,
    check: (s) => s.referrals_completed >= 1,
  },
  {
    id: 'referrer_5',
    name: 'Ambassador',
    description: 'Refer 5 friends',
    emoji: '🌟',
    category: 'social',
    requirement: 5,
    check: (s) => s.referrals_completed >= 5,
  },
  {
    id: 'social_butterfly',
    name: 'Social Butterfly',
    description: 'Share 20 clues',
    emoji: '🦋',
    category: 'social',
    requirement: 20,
    check: (s) => s.total_shared >= 20,
  },
  
  // Learning achievements
  {
    id: 'curious_mind',
    name: 'Curious Mind',
    description: 'Start 10 Learn conversations',
    emoji: '🔬',
    category: 'learning',
    requirement: 10,
    check: (s) => s.learn_conversations >= 10,
  },
  {
    id: 'deep_diver',
    name: 'Deep Diver',
    description: 'Start 50 Learn conversations',
    emoji: '🤿',
    category: 'learning',
    requirement: 50,
    check: (s) => s.learn_conversations >= 50,
  },
];

// ============================================
// GET USER ACHIEVEMENTS
// ============================================

export interface UserAchievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number; // 0-100
  requirement: number;
  current: number;
}

export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  const db = getSupabase();
  
  // Get user stats
  const { data: stats } = await db
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  // Get additional stats
  const [shareCount, referralCount, conversationCount, timeStats] = await Promise.all([
    db.from('user_actions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action', 'shared'),
    db.from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_user_id', userId)
      .eq('status', 'completed'),
    db.from('learn_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),
    getTimeBasedStats(userId),
  ]);
  
  const userStats: UserAchievementStats = {
    streak: stats?.streak || 0,
    longest_streak: stats?.longest_streak || 0,
    total_clues_seen: stats?.total_clues_seen || 0,
    total_saved: stats?.total_saved || 0,
    total_shared: shareCount.count || 0,
    referrals_completed: referralCount.count || 0,
    learn_conversations: conversationCount.count || 0,
    days_active: 0, // Would need to calculate
    night_owl_count: timeStats.night_owl,
    early_bird_count: timeStats.early_bird,
  };
  
  // Get already unlocked achievements
  const { data: unlocked } = await db
    .from('achievements')
    .select('achievement_id, unlocked_at')
    .eq('user_id', userId);
  
  const unlockedMap = new Map(
    (unlocked || []).map(a => [a.achievement_id, a.unlocked_at])
  );
  
  // Check all achievements
  const achievements: UserAchievement[] = [];
  
  for (const def of ACHIEVEMENTS) {
    const isUnlocked = unlockedMap.has(def.id) || def.check(userStats);
    const current = getCurrentValue(def, userStats);
    
    // If newly unlocked, save to database
    if (isUnlocked && !unlockedMap.has(def.id)) {
      await db.from('achievements').insert({
        user_id: userId,
        achievement_id: def.id,
      });
      unlockedMap.set(def.id, new Date().toISOString());
    }
    
    achievements.push({
      id: def.id,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      category: def.category,
      unlocked: isUnlocked,
      unlocked_at: unlockedMap.get(def.id) || null,
      progress: Math.min(100, Math.round((current / def.requirement) * 100)),
      requirement: def.requirement,
      current,
    });
  }
  
  return achievements;
}

function getCurrentValue(def: AchievementDef, stats: UserAchievementStats): number {
  switch (def.id) {
    case 'streak_3':
    case 'streak_7':
    case 'streak_14':
    case 'streak_30':
    case 'streak_60':
      return stats.streak;
    case 'saver_10':
    case 'saver_50':
    case 'saver_100':
      return stats.total_saved;
    case 'night_owl':
      return stats.night_owl_count;
    case 'early_bird':
      return stats.early_bird_count;
    case 'sharer_5':
    case 'social_butterfly':
      return stats.total_shared;
    case 'referrer_1':
    case 'referrer_5':
      return stats.referrals_completed;
    case 'curious_mind':
    case 'deep_diver':
      return stats.learn_conversations;
    default:
      return 0;
  }
}

async function getTimeBasedStats(userId: string): Promise<{
  night_owl: number;
  early_bird: number;
}> {
  const db = getSupabase();
  
  // This would need timezone-aware queries in production
  // For now, return placeholder
  const { data: actions } = await db
    .from('user_actions')
    .select('created_at')
    .eq('user_id', userId)
    .eq('action', 'seen')
    .limit(100);
  
  let nightOwl = 0;
  let earlyBird = 0;
  
  for (const action of actions || []) {
    const hour = new Date(action.created_at).getHours();
    if (hour >= 22 || hour < 4) nightOwl++;
    if (hour >= 5 && hour < 7) earlyBird++;
  }
  
  return { night_owl: nightOwl, early_bird: earlyBird };
}

// ============================================
// CHECK FOR NEW ACHIEVEMENTS
// ============================================

export async function checkNewAchievements(userId: string): Promise<UserAchievement[]> {
  const achievements = await getUserAchievements(userId);
  
  // Return only newly unlocked (unlocked within last minute)
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
  
  return achievements.filter(a => 
    a.unlocked && 
    a.unlocked_at && 
    a.unlocked_at > oneMinuteAgo
  );
}
