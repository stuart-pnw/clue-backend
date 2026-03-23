import { getSupabase } from '../db/client.js';
import { nanoid } from 'nanoid';

// ============================================
// TYPES
// ============================================

export interface Share {
  id: string;
  user_id: string;
  clue_id: string;
  platform: 'x' | 'linkedin' | 'copy' | 'other';
  share_link: string;
  click_count: number;
  shared_at: string;
}

export interface ShareStats {
  total_shares: number;
  shares_this_week: number;
  total_clicks: number;
  top_clues: Array<{
    clue_id: string;
    title: string;
    shares: number;
  }>;
}

// ============================================
// CREATE SHARE
// ============================================

export async function createShare(
  userId: string,
  clueId: string,
  platform: 'x' | 'linkedin' | 'copy' | 'other'
): Promise<Share> {
  const db = getSupabase();
  
  const shareId = nanoid(10);
  const shareLink = `https://clue.app/s/${shareId}`;
  
  const { data, error } = await db
    .from('shares')
    .insert({
      user_id: userId,
      clue_id: clueId,
      platform,
      share_link: shareLink,
      share_id: shareId,
    })
    .select()
    .single();
  
  if (error) throw error;
  
  // Also record as user action
  await db.from('user_actions').insert({
    user_id: userId,
    clue_id: clueId,
    action: 'shared',
    metadata: { platform, share_id: shareId },
  });
  
  return data;
}

// ============================================
// TRACK CLICK
// ============================================

export async function trackClick(shareId: string): Promise<void> {
  const db = getSupabase();
  
  await db.rpc('increment_share_clicks', { p_share_id: shareId });
}

// ============================================
// GET SHARE STATS
// ============================================

export async function getShareStats(userId: string): Promise<ShareStats> {
  const db = getSupabase();
  
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  // Total shares
  const { count: totalShares } = await db
    .from('shares')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  
  // Shares this week
  const { count: weekShares } = await db
    .from('shares')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('shared_at', weekAgo);
  
  // Total clicks
  const { data: clickData } = await db
    .from('shares')
    .select('click_count')
    .eq('user_id', userId);
  
  const totalClicks = (clickData || []).reduce((sum, s) => sum + (s.click_count || 0), 0);
  
  // Top shared clues
  const { data: topClues } = await db
    .from('shares')
    .select('clue_id')
    .eq('user_id', userId)
    .order('shared_at', { ascending: false })
    .limit(5);
  
  return {
    total_shares: totalShares || 0,
    shares_this_week: weekShares || 0,
    total_clicks: totalClicks,
    top_clues: [], // Would need to join with clues data
  };
}

// ============================================
// GET CLUE SOCIAL PROOF
// ============================================

export async function getClueSocialProof(clueId: string): Promise<{
  saves: number;
  shares: number;
}> {
  const db = getSupabase();
  
  const [saveCount, shareCount] = await Promise.all([
    db.from('saved_clues')
      .select('*', { count: 'exact', head: true })
      .contains('clue', { id: clueId }),
    db.from('shares')
      .select('*', { count: 'exact', head: true })
      .eq('clue_id', clueId),
  ]);
  
  return {
    saves: saveCount.count || 0,
    shares: shareCount.count || 0,
  };
}

// ============================================
// SHARE TO UNLOCK BONUS
// ============================================

export async function checkShareToUnlock(userId: string): Promise<{
  eligible: boolean;
  shares_needed: number;
  bonus_clues: number;
}> {
  const db = getSupabase();
  
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  const { count: weekShares } = await db
    .from('shares')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('shared_at', weekAgo);
  
  const sharesThisWeek = weekShares || 0;
  const threshold = 3; // Share 3 times to unlock bonus
  
  return {
    eligible: sharesThisWeek >= threshold,
    shares_needed: Math.max(0, threshold - sharesThisWeek),
    bonus_clues: 3, // Bonus clues unlocked
  };
}
