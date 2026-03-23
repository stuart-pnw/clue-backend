import { getSupabase } from '../db/client.js';

// ============================================
// EVENT TYPES
// ============================================

export type EventName =
  // Auth events
  | 'user_signed_up'
  | 'user_logged_in'
  | 'user_logged_out'
  | 'account_connected'
  | 'account_disconnected'
  
  // Onboarding events
  | 'onboarding_started'
  | 'onboarding_step_completed'
  | 'onboarding_completed'
  | 'onboarding_skipped'
  
  // Clue events
  | 'clues_generated'
  | 'clues_viewed'
  | 'clue_seen'
  | 'clue_saved'
  | 'clue_skipped'
  | 'clue_shared'
  | 'clue_expanded'
  
  // Learn events
  | 'learn_conversation_started'
  | 'learn_message_sent'
  | 'learn_deep_dive'
  
  // Subscription events
  | 'subscription_checkout_started'
  | 'subscription_activated'
  | 'subscription_cancelled'
  | 'subscription_renewed'
  
  // Engagement events
  | 'streak_achieved'
  | 'streak_lost'
  | 'shield_used'
  | 'achievement_unlocked'
  
  // Referral events
  | 'referral_link_generated'
  | 'referral_link_shared'
  | 'referral_completed'
  | 'referral_reward_granted'
  
  // Feature usage
  | 'leaderboard_viewed'
  | 'library_viewed'
  | 'settings_updated'
  | 'notification_received'
  | 'notification_opened';

// ============================================
// EVENT TRACKING
// ============================================

interface EventProperties {
  [key: string]: string | number | boolean | null;
}

export async function trackEvent(
  userId: string | null,
  event: EventName,
  properties?: EventProperties
): Promise<void> {
  const db = getSupabase();
  
  try {
    await db.from('analytics_events').insert({
      user_id: userId,
      event_name: event,
      properties: properties || {},
      created_at: new Date().toISOString(),
      session_id: null, // Would be set from client
      device_type: null,
      app_version: '1.0.0',
    });
  } catch (error) {
    // Don't fail the request if analytics fails
    console.error('[Analytics] Failed to track event:', error);
  }
}

// ============================================
// USER PROPERTIES
// ============================================

export async function setUserProperties(
  userId: string,
  properties: EventProperties
): Promise<void> {
  const db = getSupabase();
  
  try {
    await db.from('analytics_user_properties').upsert({
      user_id: userId,
      properties,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch (error) {
    console.error('[Analytics] Failed to set user properties:', error);
  }
}

// ============================================
// CONVERSION FUNNEL TRACKING
// ============================================

export async function trackFunnelStep(
  userId: string,
  funnel: string,
  step: number,
  stepName: string
): Promise<void> {
  await trackEvent(userId, 'onboarding_step_completed', {
    funnel,
    step,
    step_name: stepName,
  });
}

// ============================================
// AGGREGATE STATS (for dashboards)
// ============================================

export async function getDailyActiveUsers(date: string): Promise<number> {
  const db = getSupabase();
  
  const { count } = await db
    .from('user_stats')
    .select('*', { count: 'exact', head: true })
    .eq('last_active_date', date);
  
  return count || 0;
}

export async function getRetentionCohort(
  cohortDate: string,
  daysAfter: number
): Promise<{ cohort_size: number; retained: number; rate: number }> {
  const db = getSupabase();
  
  // Get users who signed up on cohort date
  const { count: cohortSize } = await db
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', `${cohortDate}T00:00:00Z`)
    .lt('created_at', `${cohortDate}T23:59:59Z`);
  
  // Get those who were active X days later
  const targetDate = new Date(cohortDate);
  targetDate.setDate(targetDate.getDate() + daysAfter);
  const targetDateStr = targetDate.toISOString().split('T')[0];
  
  const { count: retained } = await db
    .from('user_stats')
    .select('user_id', { count: 'exact', head: true })
    .eq('last_active_date', targetDateStr)
    .in('user_id', 
      (await db.from('users').select('id')
        .gte('created_at', `${cohortDate}T00:00:00Z`)
        .lt('created_at', `${cohortDate}T23:59:59Z`)).data?.map(u => u.id) || []
    );
  
  const total = cohortSize || 1;
  const retainedCount = retained || 0;
  
  return {
    cohort_size: total,
    retained: retainedCount,
    rate: Math.round((retainedCount / total) * 100),
  };
}

export async function getConversionStats(): Promise<{
  signups_today: number;
  trials_started: number;
  subscriptions_active: number;
  conversion_rate: number;
}> {
  const db = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  
  const [signups, trials, active] = await Promise.all([
    db.from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${today}T00:00:00Z`),
    db.from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'trialing'),
    db.from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('tier', 'pro'),
  ]);
  
  const totalUsers = signups.count || 1;
  const proUsers = active.count || 0;
  
  return {
    signups_today: signups.count || 0,
    trials_started: trials.count || 0,
    subscriptions_active: proUsers,
    conversion_rate: Math.round((proUsers / totalUsers) * 100),
  };
}
