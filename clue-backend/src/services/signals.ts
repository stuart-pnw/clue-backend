import { getSupabase } from '../db/client.js';
import { fetchNetworkActivity, RankedTweet } from './x-api.js';
import { generateDailyClues } from './clue-generator.js';
import { sendPushNotification } from './push.js';
import { getDeviceTokens } from '../db/client.js';
import { getSubscription } from './billing.js';

// ============================================
// TYPES
// ============================================

export interface Signal {
  id: string;
  type: 'breaking' | 'trending' | 'mention';
  title: string;
  preview: string;
  source_count: number;
  detected_at: string;
  clue_id?: string;
}

// ============================================
// DETECT BREAKING SIGNALS
// For Pro users, detect high-velocity content in real-time
// ============================================

export async function detectBreakingSignals(userId: string): Promise<Signal[]> {
  const sub = await getSubscription(userId);
  if (sub?.tier !== 'pro') {
    return []; // Only Pro users get real-time signals
  }
  
  try {
    const tweets = await fetchNetworkActivity(userId);
    
    // Find tweets with unusually high engagement velocity
    const breakingThreshold = 100; // Engagement velocity threshold
    const breaking = tweets.filter(t => t.engagementVelocity > breakingThreshold);
    
    if (breaking.length === 0) return [];
    
    // Group by topic
    const signals: Signal[] = [];
    const seen = new Set<string>();
    
    for (const tweet of breaking.slice(0, 3)) {
      const key = tweet.text.slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      
      signals.push({
        id: `signal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'breaking',
        title: extractTitle(tweet),
        preview: tweet.text.slice(0, 100) + '...',
        source_count: 1,
        detected_at: new Date().toISOString(),
      });
    }
    
    return signals;
    
  } catch (error) {
    console.error('[Signals] Detection error:', error);
    return [];
  }
}

function extractTitle(tweet: RankedTweet): string {
  // Extract a title from the tweet
  const text = tweet.text;
  
  // If it's a quote, use the first sentence
  const firstSentence = text.split(/[.!?]/)[0];
  if (firstSentence.length < 60) return firstSentence;
  
  // Otherwise truncate
  return text.slice(0, 50) + '...';
}

// ============================================
// SEND BREAKING NOTIFICATION
// ============================================

export async function sendBreakingNotification(
  userId: string,
  signal: Signal
): Promise<void> {
  const tokens = await getDeviceTokens(userId);
  
  for (const token of tokens) {
    await sendPushNotification(token.token, {
      title: '🔥 Breaking from your network',
      body: signal.title,
      data: {
        type: 'breaking_signal',
        signal_id: signal.id,
      },
    });
  }
}

// ============================================
// GENERATE ON-DEMAND CLUE FROM SIGNAL
// ============================================

export async function generateClueFromSignal(
  userId: string,
  signal: Signal
): Promise<any> {
  const sub = await getSubscription(userId);
  if (sub?.tier !== 'pro') {
    throw new Error('On-demand clues require Pro subscription');
  }
  
  // Fetch fresh tweets and generate a clue
  const tweets = await fetchNetworkActivity(userId);
  
  if (tweets.length === 0) {
    throw new Error('No content available');
  }
  
  const clues = await generateDailyClues(userId, tweets, 1);
  
  if (clues.length === 0) {
    throw new Error('Could not generate clue');
  }
  
  return clues[0];
}

// ============================================
// CHECK FOR PENDING SIGNALS
// ============================================

export async function getPendingSignals(userId: string): Promise<Signal[]> {
  const db = getSupabase();
  
  // Get signals detected in the last hour that user hasn't seen
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { data } = await db
    .from('signals')
    .select('*')
    .eq('user_id', userId)
    .eq('seen', false)
    .gte('detected_at', hourAgo)
    .order('detected_at', { ascending: false })
    .limit(5);
  
  return data || [];
}

// ============================================
// MARK SIGNAL AS SEEN
// ============================================

export async function markSignalSeen(
  userId: string,
  signalId: string
): Promise<void> {
  const db = getSupabase();
  
  await db
    .from('signals')
    .update({ seen: true })
    .eq('user_id', userId)
    .eq('id', signalId);
}

// ============================================
// BACKGROUND SIGNAL DETECTION JOB
// Runs periodically for Pro users
// ============================================

export async function runSignalDetection(): Promise<void> {
  const db = getSupabase();
  
  // Get all Pro users with push notifications enabled
  const { data: proUsers } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('tier', 'pro');
  
  if (!proUsers || proUsers.length === 0) return;
  
  console.log(`[Signals] Running detection for ${proUsers.length} Pro users`);
  
  for (const { user_id } of proUsers) {
    try {
      const signals = await detectBreakingSignals(user_id);
      
      if (signals.length > 0) {
        // Save signals
        await db.from('signals').insert(
          signals.map(s => ({
            ...s,
            user_id,
            seen: false,
          }))
        );
        
        // Send notification for first signal
        await sendBreakingNotification(user_id, signals[0]);
      }
    } catch (error) {
      console.error(`[Signals] Error for user ${user_id}:`, error);
    }
  }
}
