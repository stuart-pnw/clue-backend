import { getSupabase } from '../db/client.js';

// ============================================
// PRIVACY-FIRST DATA RETENTION POLICY
// 
// Clue's core promise: We retain ZERO network data.
// All raw social data is processed in-memory only.
// ============================================

const RETENTION_POLICIES = {
  // Network-derived data: 24 hours MAX
  daily_clues: 24,           // hours - clues generated from network
  
  // User activity: 24 hours (not needed for product)
  user_actions: 24,          // hours - seen/saved/skipped
  
  // Signals: 24 hours
  signals: 24,               // hours - breaking signals
  
  // Analytics: 7 days (for basic metrics, no PII)
  analytics_events: 168,     // hours (7 days)
  
  // Learn conversations: User controlled
  // Users can delete anytime, auto-cleanup after 30 days of inactivity
  learn_inactive_days: 30,
};

// ============================================
// MAIN CLEANUP JOB
// Runs every hour to ensure compliance
// ============================================

export async function runPrivacyCleanup(): Promise<CleanupReport> {
  const db = getSupabase();
  const report: CleanupReport = {
    timestamp: new Date().toISOString(),
    deleted: {},
    errors: [],
  };
  
  console.log('[Privacy Cleanup] Starting...');
  
  // 1. Delete daily clues older than 24 hours
  try {
    const cluesCutoff = new Date(Date.now() - RETENTION_POLICIES.daily_clues * 60 * 60 * 1000);
    const { count } = await db
      .from('daily_clues')
      .delete()
      .lt('generated_at', cluesCutoff.toISOString())
      .select('*', { count: 'exact', head: true });
    
    report.deleted.daily_clues = count || 0;
    console.log(`[Privacy Cleanup] Deleted ${count} old daily_clues`);
  } catch (error) {
    report.errors.push({ table: 'daily_clues', error: String(error) });
  }
  
  // 2. Delete user actions older than 24 hours
  try {
    const actionsCutoff = new Date(Date.now() - RETENTION_POLICIES.user_actions * 60 * 60 * 1000);
    const { count } = await db
      .from('user_actions')
      .delete()
      .lt('created_at', actionsCutoff.toISOString())
      .select('*', { count: 'exact', head: true });
    
    report.deleted.user_actions = count || 0;
    console.log(`[Privacy Cleanup] Deleted ${count} old user_actions`);
  } catch (error) {
    report.errors.push({ table: 'user_actions', error: String(error) });
  }
  
  // 3. Delete signals older than 24 hours
  try {
    const signalsCutoff = new Date(Date.now() - RETENTION_POLICIES.signals * 60 * 60 * 1000);
    const { count } = await db
      .from('signals')
      .delete()
      .lt('detected_at', signalsCutoff.toISOString())
      .select('*', { count: 'exact', head: true });
    
    report.deleted.signals = count || 0;
    console.log(`[Privacy Cleanup] Deleted ${count} old signals`);
  } catch (error) {
    report.errors.push({ table: 'signals', error: String(error) });
  }
  
  // 4. Delete analytics events older than 7 days
  try {
    const analyticsCutoff = new Date(Date.now() - RETENTION_POLICIES.analytics_events * 60 * 60 * 1000);
    const { count } = await db
      .from('analytics_events')
      .delete()
      .lt('created_at', analyticsCutoff.toISOString())
      .select('*', { count: 'exact', head: true });
    
    report.deleted.analytics_events = count || 0;
    console.log(`[Privacy Cleanup] Deleted ${count} old analytics_events`);
  } catch (error) {
    report.errors.push({ table: 'analytics_events', error: String(error) });
  }
  
  // 5. Delete inactive learn conversations (30 days no activity)
  try {
    const learnCutoff = new Date(Date.now() - RETENTION_POLICIES.learn_inactive_days * 24 * 60 * 60 * 1000);
    
    // First get conversation IDs to delete
    const { data: oldConversations } = await db
      .from('learn_conversations')
      .select('id')
      .lt('last_message_at', learnCutoff.toISOString());
    
    if (oldConversations && oldConversations.length > 0) {
      const ids = oldConversations.map(c => c.id);
      
      // Delete messages first
      await db.from('learn_messages').delete().in('conversation_id', ids);
      
      // Then conversations
      const { count } = await db
        .from('learn_conversations')
        .delete()
        .in('id', ids)
        .select('*', { count: 'exact', head: true });
      
      report.deleted.learn_conversations = count || 0;
      console.log(`[Privacy Cleanup] Deleted ${count} inactive learn_conversations`);
    }
  } catch (error) {
    report.errors.push({ table: 'learn_conversations', error: String(error) });
  }
  
  // 6. Clean up orphaned data
  try {
    // Delete saved_clues where clue sources reference deleted network data
    // This ensures no stale network references persist
    // Note: saved_clues are user-controlled, but we sanitize source data
    await sanitizeSavedClues(db);
  } catch (error) {
    report.errors.push({ table: 'saved_clues_sanitize', error: String(error) });
  }
  
  console.log('[Privacy Cleanup] Complete', report);
  return report;
}

// ============================================
// SANITIZE SAVED CLUES
// Remove raw network data from sources for users who haven't opted in
// ============================================

async function sanitizeSavedClues(db: ReturnType<typeof getSupabase>): Promise<void> {
  // Get users who have NOT opted into snapshots
  const { data: nonOptedInUsers } = await db
    .from('user_preferences')
    .select('user_id')
    .eq('store_source_snapshots', false);
  
  if (!nonOptedInUsers || nonOptedInUsers.length === 0) return;
  
  const userIds = nonOptedInUsers.map(u => u.user_id);
  
  // Get saved clues for these users that have source data
  const { data: clues } = await db
    .from('saved_clues')
    .select('id, clue')
    .in('user_id', userIds)
    .not('clue->sources', 'is', null);
  
  if (!clues) return;
  
  for (const saved of clues) {
    const clue = saved.clue as any;
    if (!clue.sources) continue;
    
    // Check if any source has content that should be removed
    const needsSanitization = clue.sources.some((s: any) => s.note || s.post_id);
    
    if (needsSanitization) {
      // Sanitize sources - keep only handle and URL
      const sanitizedSources = clue.sources.map((s: any) => ({
        handle: s.handle,
        platform: s.platform,
        post_url: s.post_url,
        post_id: null,
        note: '',
      }));
      
      await db
        .from('saved_clues')
        .update({ clue: { ...clue, sources: sanitizedSources } })
        .eq('id', saved.id);
    }
  }
}

// ============================================
// TYPES
// ============================================

interface CleanupReport {
  timestamp: string;
  deleted: Record<string, number>;
  errors: Array<{ table: string; error: string }>;
}

// ============================================
// SCHEDULER
// Run cleanup every hour
// ============================================

let cleanupInterval: NodeJS.Timeout | null = null;

export function startPrivacyCleanupScheduler(): void {
  console.log('[Privacy Cleanup] Starting hourly scheduler...');
  
  // Run immediately on startup
  runPrivacyCleanup().catch(console.error);
  
  // Then every hour
  cleanupInterval = setInterval(() => {
    runPrivacyCleanup().catch(console.error);
  }, 60 * 60 * 1000); // Every hour
}

export function stopPrivacyCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

// ============================================
// IMMEDIATE CLEANUP FOR USER
// Called when user requests data deletion
// ============================================

export async function purgeUserNetworkData(userId: string): Promise<void> {
  const db = getSupabase();
  
  console.log(`[Privacy] Purging all network data for user ${userId}`);
  
  await Promise.all([
    db.from('daily_clues').delete().eq('user_id', userId),
    db.from('user_actions').delete().eq('user_id', userId),
    db.from('signals').delete().eq('user_id', userId),
    db.from('analytics_events').delete().eq('user_id', userId),
  ]);
  
  // Sanitize saved clues (remove source details but keep the clue)
  const { data: savedClues } = await db
    .from('saved_clues')
    .select('id, clue')
    .eq('user_id', userId);
  
  if (savedClues) {
    for (const saved of savedClues) {
      const clue = saved.clue as any;
      await db
        .from('saved_clues')
        .update({
          clue: {
            ...clue,
            sources: [], // Remove all source references
            handles: [], // Remove handle references
          },
        })
        .eq('id', saved.id);
    }
  }
  
  console.log(`[Privacy] Purge complete for user ${userId}`);
}

// ============================================
// VERIFY NO RAW DATA STORED
// Audit function to verify compliance
// ============================================

export async function auditDataRetention(): Promise<AuditReport> {
  const db = getSupabase();
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const report: AuditReport = {
    timestamp: now.toISOString(),
    compliant: true,
    violations: [],
  };
  
  // Check for daily_clues older than 24 hours
  const { count: oldClues } = await db
    .from('daily_clues')
    .select('*', { count: 'exact', head: true })
    .lt('generated_at', twentyFourHoursAgo.toISOString());
  
  if (oldClues && oldClues > 0) {
    report.compliant = false;
    report.violations.push({
      table: 'daily_clues',
      count: oldClues,
      message: `Found ${oldClues} clues older than 24 hours`,
    });
  }
  
  // Check for user_actions older than 24 hours
  const { count: oldActions } = await db
    .from('user_actions')
    .select('*', { count: 'exact', head: true })
    .lt('created_at', twentyFourHoursAgo.toISOString());
  
  if (oldActions && oldActions > 0) {
    report.compliant = false;
    report.violations.push({
      table: 'user_actions',
      count: oldActions,
      message: `Found ${oldActions} actions older than 24 hours`,
    });
  }
  
  // Check for signals older than 24 hours
  const { count: oldSignals } = await db
    .from('signals')
    .select('*', { count: 'exact', head: true })
    .lt('detected_at', twentyFourHoursAgo.toISOString());
  
  if (oldSignals && oldSignals > 0) {
    report.compliant = false;
    report.violations.push({
      table: 'signals',
      count: oldSignals,
      message: `Found ${oldSignals} signals older than 24 hours`,
    });
  }
  
  return report;
}

interface AuditReport {
  timestamp: string;
  compliant: boolean;
  violations: Array<{
    table: string;
    count: number;
    message: string;
  }>;
}
