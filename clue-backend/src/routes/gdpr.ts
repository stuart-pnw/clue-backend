import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import { getSupabase, getUserById } from '../db/client.js';
import { purgeUserNetworkData, auditDataRetention } from '../jobs/privacy-cleanup.js';

const gdpr = new Hono();

// Auth middleware
gdpr.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// EXPORT USER DATA (GDPR Article 20)
// ============================================

gdpr.get('/export', async (c) => {
  const userId = c.get('userId');
  const db = getSupabase();
  
  try {
    // Fetch all user data
    const [
      user,
      preferences,
      connectedAccounts,
      dailyClues,
      savedClues,
      userActions,
      userStats,
      learnConversations,
      learnMessages,
      referrals,
      achievements,
      shares,
    ] = await Promise.all([
      db.from('users').select('*').eq('id', userId).single(),
      db.from('user_preferences').select('*').eq('user_id', userId).single(),
      db.from('connected_accounts').select('platform, platform_username, connected_at').eq('user_id', userId),
      db.from('daily_clues').select('date, clues, generated_at').eq('user_id', userId),
      db.from('saved_clues').select('clue, saved_at, mastery, topic').eq('user_id', userId),
      db.from('user_actions').select('clue_id, action, created_at').eq('user_id', userId),
      db.from('user_stats').select('*').eq('user_id', userId).single(),
      db.from('learn_conversations').select('id, started_at, last_message_at').eq('user_id', userId),
      db.from('learn_messages').select('conversation_id, role, content, created_at')
        .in('conversation_id', 
          (await db.from('learn_conversations').select('id').eq('user_id', userId)).data?.map(c => c.id) || []
        ),
      db.from('referrals').select('referral_code, status, created_at, completed_at').eq('referrer_user_id', userId),
      db.from('achievements').select('achievement_id, unlocked_at').eq('user_id', userId),
      db.from('shares').select('clue_id, platform, shared_at, click_count').eq('user_id', userId),
    ]);
    
    // Remove sensitive fields
    const exportData = {
      exported_at: new Date().toISOString(),
      user: {
        email: user.data?.email,
        name: user.data?.name,
        created_at: user.data?.created_at,
        timezone: user.data?.timezone,
        delivery_time: user.data?.delivery_time,
      },
      preferences: preferences.data ? {
        goal: preferences.data.goal,
        professions: preferences.data.professions,
        push_notifications: preferences.data.push_notifications,
        network_scanning: preferences.data.network_scanning,
      } : null,
      connected_accounts: connectedAccounts.data || [],
      stats: userStats.data ? {
        streak: userStats.data.streak,
        longest_streak: userStats.data.longest_streak,
        total_clues_seen: userStats.data.total_clues_seen,
        total_saved: userStats.data.total_saved,
        score: userStats.data.score,
      } : null,
      daily_clues: dailyClues.data || [],
      saved_clues: savedClues.data || [],
      actions: userActions.data || [],
      conversations: (learnConversations.data || []).map(conv => ({
        ...conv,
        messages: (learnMessages.data || []).filter(m => m.conversation_id === conv.id),
      })),
      referrals: referrals.data || [],
      achievements: achievements.data || [],
      shares: shares.data || [],
    };
    
    // Return as downloadable JSON
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="clue-data-export-${userId}.json"`);
    
    return c.json(exportData);
    
  } catch (error) {
    console.error('[GDPR] Export error:', error);
    return c.json({ error: 'Failed to export data' }, 500);
  }
});

// ============================================
// DELETE USER ACCOUNT (GDPR Article 17)
// ============================================

gdpr.delete('/account', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ confirmation: string }>();
  
  // Require explicit confirmation
  if (body.confirmation !== 'DELETE MY ACCOUNT') {
    return c.json({ 
      error: 'Invalid confirmation',
      message: 'Please send { "confirmation": "DELETE MY ACCOUNT" } to confirm deletion',
    }, 400);
  }
  
  const db = getSupabase();
  
  try {
    // Delete all user data (cascades due to foreign keys)
    // But we'll be explicit for safety
    
    // 1. Delete dependent data first
    await Promise.all([
      db.from('learn_messages').delete()
        .in('conversation_id', 
          (await db.from('learn_conversations').select('id').eq('user_id', userId)).data?.map(c => c.id) || []
        ),
      db.from('signals').delete().eq('user_id', userId),
      db.from('shares').delete().eq('user_id', userId),
      db.from('achievements').delete().eq('user_id', userId),
      db.from('referral_rewards').delete().eq('user_id', userId),
      db.from('referrals').delete().eq('referrer_user_id', userId),
      db.from('referral_codes').delete().eq('user_id', userId),
      db.from('device_tokens').delete().eq('user_id', userId),
      db.from('saved_clues').delete().eq('user_id', userId),
      db.from('user_actions').delete().eq('user_id', userId),
      db.from('daily_clues').delete().eq('user_id', userId),
    ]);
    
    // 2. Delete learn conversations
    await db.from('learn_conversations').delete().eq('user_id', userId);
    
    // 3. Delete user-related tables
    await Promise.all([
      db.from('subscriptions').delete().eq('user_id', userId),
      db.from('user_stats').delete().eq('user_id', userId),
      db.from('connected_accounts').delete().eq('user_id', userId),
      db.from('user_preferences').delete().eq('user_id', userId),
    ]);
    
    // 4. Finally delete the user
    const { error } = await db.from('users').delete().eq('id', userId);
    
    if (error) throw error;
    
    console.log(`[GDPR] Deleted account: ${userId}`);
    
    return c.json({ 
      success: true,
      message: 'Your account and all associated data have been permanently deleted',
    });
    
  } catch (error) {
    console.error('[GDPR] Delete error:', error);
    return c.json({ error: 'Failed to delete account' }, 500);
  }
});

// ============================================
// GET DATA CATEGORIES (GDPR Article 15)
// ============================================

gdpr.get('/categories', async (c) => {
  return c.json({
    data_categories: [
      {
        category: 'Account Information',
        description: 'Your email, name, and profile settings',
        retention: 'Until account deletion',
      },
      {
        category: 'Connected Accounts',
        description: 'OAuth tokens for X and LinkedIn (encrypted)',
        retention: 'Until disconnection or account deletion',
      },
      {
        category: 'Network Data',
        description: 'Posts fetched from your social networks',
        retention: 'NEVER STORED - processed in-memory only, deleted immediately',
      },
      {
        category: 'Daily Clues',
        description: 'Generated insights from your network',
        retention: '24 hours (automatically deleted)',
      },
      {
        category: 'Source Snapshots',
        description: 'Original post text stored with clues (OPT-IN only)',
        retention: 'If enabled: stored with clue until deletion. If disabled: never stored.',
        opt_in: true,
        setting: 'store_source_snapshots',
      },
      {
        category: 'Activity',
        description: 'Actions like views, saves, shares',
        retention: '24 hours (automatically deleted)',
      },
      {
        category: 'Saved Clues',
        description: 'Clues you explicitly save to your library',
        retention: 'Until you delete them',
      },
      {
        category: 'Conversations',
        description: 'Learn tab chat history',
        retention: '30 days of inactivity, or until you delete',
      },
      {
        category: 'Subscription',
        description: 'Billing and subscription status',
        retention: 'As required by law',
      },
    ],
    rights: [
      {
        right: 'Access',
        description: 'Request a copy of your data',
        endpoint: 'GET /gdpr/export',
      },
      {
        right: 'Deletion',
        description: 'Delete your account and all data',
        endpoint: 'DELETE /gdpr/account',
      },
      {
        right: 'Rectification',
        description: 'Update your information',
        endpoint: 'PATCH /user/profile',
      },
      {
        right: 'Portability',
        description: 'Download your data in JSON format',
        endpoint: 'GET /gdpr/export',
      },
    ],
    contact: 'privacy@clue.app',
  });
});

// ============================================
// REQUEST DATA PROCESSING RESTRICTION
// ============================================

gdpr.post('/restrict', async (c) => {
  const userId = c.get('userId');
  const db = getSupabase();
  
  // Disable processing by turning off all preferences
  await db.from('user_preferences').update({
    network_scanning: false,
    personalized_insights: false,
    usage_analytics: false,
    push_notifications: false,
  }).eq('user_id', userId);
  
  return c.json({
    success: true,
    message: 'Data processing has been restricted. You can re-enable features in settings.',
  });
});

// ============================================
// PURGE NETWORK DATA (immediate)
// ============================================

gdpr.post('/purge-network-data', async (c) => {
  const userId = c.get('userId');
  
  await purgeUserNetworkData(userId);
  
  return c.json({
    success: true,
    message: 'All network-derived data has been immediately purged.',
  });
});

// ============================================
// PRIVACY AUDIT (admin/debug)
// ============================================

gdpr.get('/audit', async (c) => {
  const report = await auditDataRetention();
  
  return c.json({
    ...report,
    policy: {
      daily_clues: '24 hours',
      user_actions: '24 hours',
      signals: '24 hours',
      analytics_events: '7 days',
      learn_conversations: '30 days inactive',
      raw_network_data: 'NEVER STORED',
    },
  });
});

export default gdpr;
