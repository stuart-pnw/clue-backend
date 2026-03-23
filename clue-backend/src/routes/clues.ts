import { Hono } from 'hono';
import { verifyToken, extractToken } from '../lib/jwt.js';
import {
  getDailyClues,
  saveDailyClues,
  recordAction,
  getUserActionsToday,
  saveClue,
  getSavedClues,
  deleteSavedClue,
  updateClueMastery,
  getUserStats,
  incrementStats,
  updateUserStats,
} from '../db/client.js';
import { fetchNetworkActivity } from '../services/x-api.js';
import { fetchLinkedInActivity } from '../services/linkedin-api.js';
import { generateDailyClues, validateClue } from '../services/clue-generator.js';
import { getSubscription, getClueLimit } from '../services/billing.js';
import type { Clue } from '../db/schema.js';

const clues = new Hono();

// Auth middleware
clues.use('*', async (c, next) => {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  
  const payload = await verifyToken(token);
  if (!payload) return c.json({ error: 'Invalid token' }, 401);
  
  c.set('userId', payload.sub);
  await next();
});

// ============================================
// GET TODAY'S CLUES
// ============================================

clues.get('/today', async (c) => {
  const userId = c.get('userId');
  const today = new Date().toISOString().split('T')[0];
  
  // Check if we already have clues for today
  let dailyClues = await getDailyClues(userId, today);
  
  if (dailyClues && dailyClues.clues.length > 0) {
    // Get actions to mark which are seen/saved
    const actions = await getUserActionsToday(userId);
    const seenIds = new Set(actions.filter(a => a.action === 'seen').map(a => a.clue_id));
    const savedIds = new Set(actions.filter(a => a.action === 'saved').map(a => a.clue_id));
    
    const cluesWithStatus = dailyClues.clues.map(clue => ({
      ...clue,
      seen: seenIds.has(clue.id),
      saved: savedIds.has(clue.id),
    }));
    
    return c.json({ 
      clues: cluesWithStatus,
      date: today,
      generated_at: dailyClues.generated_at,
    });
  }
  
  // Generate new clues
  try {
    console.log(`[Clues] Generating clues for user ${userId}`);
    
    // Fetch network activity from both platforms
    const [xTweets, linkedInPosts] = await Promise.all([
      fetchNetworkActivity(userId).catch(() => []),
      fetchLinkedInActivity(userId).catch(() => []),
    ]);
    
    // Combine and deduplicate (by similar content)
    const allContent = [
      ...xTweets.map(t => ({ ...t, platform: 'x' as const })),
      ...linkedInPosts.map(p => ({ 
        ...p, 
        text: p.text,
        author: { username: p.authorName, public_metrics: { followers_count: 0 } },
        public_metrics: { like_count: p.numLikes, retweet_count: p.numShares, reply_count: p.numComments, quote_count: 0 },
        created_at: new Date(p.created).toISOString(),
        platform: 'linkedin' as const,
      })),
    ];
    
    if (allContent.length === 0) {
      return c.json({ 
        clues: [],
        date: today,
        message: 'No recent activity from your network. Connect your accounts to get personalized clues.',
      });
    }
    
    // Get clue count based on subscription tier
    const sub = await getSubscription(userId);
    const clueCount = getClueLimit(sub?.tier || 'free');
    
    // Generate clues (pass X tweets for now, will enhance generator later)
    const generatedClues = await generateDailyClues(userId, xTweets, clueCount);
    
    // Validate all clues
    const validClues = generatedClues.filter(validateClue);
    
    if (validClues.length === 0) {
      return c.json({ 
        clues: [],
        date: today,
        message: 'Could not generate clues. Please try again later.',
      });
    }
    
    // Save to database
    dailyClues = await saveDailyClues(userId, today, validClues);
    
    return c.json({
      clues: validClues.map(clue => ({ ...clue, seen: false, saved: false })),
      date: today,
      generated_at: dailyClues.generated_at,
    });
    
  } catch (error) {
    console.error('[Clues] Generation error:', error);
    return c.json({ error: 'Failed to generate clues' }, 500);
  }
});

// ============================================
// RECORD CLUE ACTION
// ============================================

clues.post('/:clueId/action', async (c) => {
  const userId = c.get('userId');
  const clueId = c.req.param('clueId');
  const body = await c.req.json<{ action: string; clue?: Clue }>();
  
  const validActions = ['seen', 'saved', 'skipped', 'shared', 'expanded'];
  if (!validActions.includes(body.action)) {
    return c.json({ error: 'Invalid action' }, 400);
  }
  
  const action = body.action as 'seen' | 'saved' | 'skipped' | 'shared' | 'expanded';
  
  // Record the action
  await recordAction(userId, clueId, action);
  
  // Handle special actions
  if (action === 'saved' && body.clue) {
    // Save to library
    await saveClue(userId, body.clue);
    await incrementStats(userId, { total_saved: 1, score: 10 });
  }
  
  if (action === 'seen') {
    await incrementStats(userId, { total_clues_seen: 1 });
    
    // Check if user has seen all daily clues (update streak)
    const today = new Date().toISOString().split('T')[0];
    const dailyClues = await getDailyClues(userId, today);
    const actions = await getUserActionsToday(userId);
    const seenCount = new Set(actions.filter(a => a.action === 'seen').map(a => a.clue_id)).size;
    
    if (dailyClues && seenCount >= dailyClues.clues.length) {
      // User completed daily clues - update streak
      const stats = await getUserStats(userId);
      if (stats && stats.last_active_date !== today) {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        let newStreak = 1;
        if (stats.last_active_date === yesterday) {
          newStreak = stats.streak + 1;
        }
        
        await updateUserStats(userId, {
          streak: newStreak,
          longest_streak: Math.max(stats.longest_streak, newStreak),
          last_active_date: today,
        });
      }
    }
  }
  
  if (action === 'shared') {
    await incrementStats(userId, { score: 5 });
  }
  
  return c.json({ success: true });
});

// ============================================
// LIBRARY ENDPOINTS
// ============================================

clues.get('/library', async (c) => {
  const userId = c.get('userId');
  const saved = await getSavedClues(userId);
  return c.json({ clues: saved });
});

clues.delete('/library/:id', async (c) => {
  const userId = c.get('userId');
  const clueId = c.req.param('id');
  
  await deleteSavedClue(userId, clueId);
  return c.json({ success: true });
});

clues.patch('/library/:id/mastery', async (c) => {
  const userId = c.get('userId');
  const clueId = c.req.param('id');
  const body = await c.req.json<{ mastery: number }>();
  
  if (body.mastery < 0 || body.mastery > 3) {
    return c.json({ error: 'Mastery must be 0-3' }, 400);
  }
  
  const updated = await updateClueMastery(userId, clueId, body.mastery as 0 | 1 | 2 | 3);
  return c.json({ clue: updated });
});

export default clues;
