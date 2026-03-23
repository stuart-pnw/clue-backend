import { getSupabase } from '../db/client.js';
import { nanoid } from 'nanoid';

// ============================================
// TYPES
// ============================================

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string | null;
  referral_code: string;
  status: 'pending' | 'completed';
  reward_granted: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface ReferralReward {
  id: string;
  user_id: string;
  reward_type: 'bonus_clues' | 'unlimited_week' | 'free_month';
  granted_at: string;
  expires_at: string | null;
  used: boolean;
}

export interface ReferralStats {
  total_referrals: number;
  completed_referrals: number;
  pending_referrals: number;
  rewards_earned: ReferralReward[];
  referral_code: string;
  referral_link: string;
}

// ============================================
// GENERATE REFERRAL CODE
// ============================================

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const db = getSupabase();
  
  // Check for existing code
  const { data: existing } = await db
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .single();
  
  if (existing?.code) return existing.code;
  
  // Generate new code
  const code = nanoid(8).toUpperCase();
  
  await db.from('referral_codes').insert({
    user_id: userId,
    code,
  });
  
  return code;
}

// ============================================
// TRACK REFERRAL ON SIGNUP
// ============================================

export async function trackReferral(
  referredUserId: string,
  referralCode: string
): Promise<boolean> {
  const db = getSupabase();
  
  // Find referrer by code
  const { data: codeData } = await db
    .from('referral_codes')
    .select('user_id')
    .eq('code', referralCode.toUpperCase())
    .single();
  
  if (!codeData) {
    console.log(`[Referral] Invalid code: ${referralCode}`);
    return false;
  }
  
  const referrerUserId = codeData.user_id;
  
  // Don't allow self-referral
  if (referrerUserId === referredUserId) {
    return false;
  }
  
  // Create referral record
  await db.from('referrals').insert({
    referrer_user_id: referrerUserId,
    referred_user_id: referredUserId,
    referral_code: referralCode.toUpperCase(),
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
  
  // Check if referrer earned a reward
  await checkAndGrantReward(referrerUserId);
  
  console.log(`[Referral] ${referredUserId} referred by ${referrerUserId}`);
  return true;
}

// ============================================
// CHECK AND GRANT REWARDS
// ============================================

const REWARD_TIERS = [
  { count: 1, reward: 'bonus_clues', value: 3 },
  { count: 3, reward: 'unlimited_week', value: 7 },
  { count: 5, reward: 'bonus_clues', value: 10 },
  { count: 10, reward: 'free_month', value: 30 },
];

async function checkAndGrantReward(userId: string): Promise<void> {
  const db = getSupabase();
  
  // Count completed referrals
  const { count } = await db
    .from('referrals')
    .select('*', { count: 'exact', head: true })
    .eq('referrer_user_id', userId)
    .eq('status', 'completed');
  
  const referralCount = count || 0;
  
  // Check which rewards they've earned
  const { data: existingRewards } = await db
    .from('referral_rewards')
    .select('reward_type')
    .eq('user_id', userId);
  
  const earnedTypes = new Set(existingRewards?.map(r => r.reward_type) || []);
  
  // Grant new rewards
  for (const tier of REWARD_TIERS) {
    if (referralCount >= tier.count) {
      const rewardKey = `${tier.reward}_${tier.count}`;
      
      // Check if this specific tier reward was granted
      const { data: hasThisTier } = await db
        .from('referral_rewards')
        .select('id')
        .eq('user_id', userId)
        .eq('reward_type', tier.reward)
        .gte('granted_at', getRewardCutoffDate(tier.count))
        .single();
      
      if (!hasThisTier) {
        // Grant reward
        let expiresAt = null;
        if (tier.reward === 'unlimited_week') {
          expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (tier.reward === 'free_month') {
          expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        }
        
        await db.from('referral_rewards').insert({
          user_id: userId,
          reward_type: tier.reward,
          expires_at: expiresAt,
        });
        
        console.log(`[Referral] Granted ${tier.reward} to user ${userId}`);
        
        // Apply bonus clues immediately
        if (tier.reward === 'bonus_clues') {
          await db.rpc('increment_bonus_clues', {
            p_user_id: userId,
            p_amount: tier.value,
          });
        }
      }
    }
  }
}

function getRewardCutoffDate(tierCount: number): string {
  // Used to prevent duplicate rewards for same tier
  return new Date(0).toISOString();
}

// ============================================
// GET REFERRAL STATS
// ============================================

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const db = getSupabase();
  
  const code = await getOrCreateReferralCode(userId);
  
  // Get referral counts
  const { data: referrals } = await db
    .from('referrals')
    .select('status')
    .eq('referrer_user_id', userId);
  
  const completed = referrals?.filter(r => r.status === 'completed').length || 0;
  const pending = referrals?.filter(r => r.status === 'pending').length || 0;
  
  // Get rewards
  const { data: rewards } = await db
    .from('referral_rewards')
    .select('*')
    .eq('user_id', userId)
    .order('granted_at', { ascending: false });
  
  return {
    total_referrals: completed + pending,
    completed_referrals: completed,
    pending_referrals: pending,
    rewards_earned: rewards || [],
    referral_code: code,
    referral_link: `https://clue.app/join?ref=${code}`,
  };
}

// ============================================
// GET REFERRAL ACTIVITY
// ============================================

export async function getReferralActivity(userId: string): Promise<Array<{
  type: 'joined' | 'streak' | 'saved';
  user_name: string;
  timestamp: string;
}>> {
  const db = getSupabase();
  
  // Get recent referral completions
  const { data: referrals } = await db
    .from('referrals')
    .select(`
      completed_at,
      referred_user:users!referred_user_id (name)
    `)
    .eq('referrer_user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(10);
  
  return (referrals || []).map(r => ({
    type: 'joined' as const,
    user_name: (r.referred_user as any)?.name || 'Someone',
    timestamp: r.completed_at,
  }));
}
