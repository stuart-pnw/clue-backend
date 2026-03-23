import { getSupabase } from '../db/client.js';

// ============================================
// STREAK CHECK JOB
// Runs at midnight for each timezone cohort
// ============================================

export async function checkStreaksForTimezone(timezone: string): Promise<void> {
  const db = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  console.log(`[Streak Job] Checking streaks for timezone: ${timezone}`);
  
  // Get all users in this timezone who haven't been active today
  const { data: users, error } = await db
    .from('user_stats')
    .select('user_id, streak, shields, last_active_date')
    .eq('users.timezone', timezone)
    .neq('last_active_date', today);
  
  if (error) {
    console.error('[Streak Job] Error fetching users:', error);
    return;
  }
  
  if (!users || users.length === 0) {
    console.log('[Streak Job] No users to process');
    return;
  }
  
  console.log(`[Streak Job] Processing ${users.length} users`);
  
  for (const userStats of users) {
    const { user_id, streak, shields, last_active_date } = userStats;
    
    // If last active was yesterday, they just need to be active today
    // If last active was before yesterday, they've broken streak
    if (last_active_date && last_active_date < yesterday) {
      if (shields > 0) {
        // Use shield to protect streak
        await db
          .from('user_stats')
          .update({ shields: shields - 1 })
          .eq('user_id', user_id);
        
        console.log(`[Streak Job] User ${user_id} used shield, streak protected`);
      } else {
        // Reset streak
        await db
          .from('user_stats')
          .update({ streak: 0 })
          .eq('user_id', user_id);
        
        console.log(`[Streak Job] User ${user_id} streak reset to 0`);
      }
    }
  }
  
  console.log('[Streak Job] Complete');
}

// ============================================
// DATA CLEANUP JOB
// Runs daily to delete network data > 24 hours old
// ============================================

export async function cleanupOldData(): Promise<void> {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  
  console.log(`[Cleanup Job] Deleting data older than ${cutoff}`);
  
  // Delete old user actions (keep only last 30 days for analytics)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const { error: actionsError, count: actionsDeleted } = await db
    .from('user_actions')
    .delete()
    .lt('created_at', thirtyDaysAgo)
    .select('*', { count: 'exact', head: true });
  
  if (actionsError) {
    console.error('[Cleanup Job] Error deleting actions:', actionsError);
  } else {
    console.log(`[Cleanup Job] Deleted ${actionsDeleted} old actions`);
  }
  
  // Delete old daily clues (keep only last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  const { error: cluesError, count: cluesDeleted } = await db
    .from('daily_clues')
    .delete()
    .lt('date', sevenDaysAgo)
    .select('*', { count: 'exact', head: true });
  
  if (cluesError) {
    console.error('[Cleanup Job] Error deleting clues:', cluesError);
  } else {
    console.log(`[Cleanup Job] Deleted ${cluesDeleted} old daily clues`);
  }
  
  console.log('[Cleanup Job] Complete');
}

// ============================================
// TIMEZONE COHORTS
// ============================================

const TIMEZONE_COHORTS = [
  'America/Los_Angeles',  // PT
  'America/Denver',       // MT
  'America/Chicago',      // CT
  'America/New_York',     // ET
  'Europe/London',        // GMT
  'Europe/Paris',         // CET
  'Asia/Tokyo',           // JST
  'Asia/Shanghai',        // CST
  'Australia/Sydney',     // AEST
];

// Get current hour in a timezone
function getHourInTimezone(timezone: string): number {
  return new Date().toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).split(' ')[0] as unknown as number;
}

// ============================================
// SCHEDULER
// In production, use a proper job scheduler like BullMQ
// ============================================

export function startScheduler(): void {
  console.log('[Scheduler] Starting...');
  
  // Check every hour
  setInterval(async () => {
    // Run streak checks at midnight for each timezone
    for (const timezone of TIMEZONE_COHORTS) {
      const hour = getHourInTimezone(timezone);
      if (hour === 0) {
        await checkStreaksForTimezone(timezone);
      }
    }
    
    // Run cleanup once per day (at 3am PT)
    const ptHour = getHourInTimezone('America/Los_Angeles');
    if (ptHour === 3) {
      await cleanupOldData();
    }
  }, 60 * 60 * 1000); // Every hour
  
  console.log('[Scheduler] Started');
}
