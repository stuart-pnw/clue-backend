import Anthropic from '@anthropic-ai/sdk';
import { env } from '../lib/env.js';
import { RankedTweet } from './x-api.js';
import { Clue, ClueSource } from '../db/schema.js';
import { getUserPreferences } from '../db/client.js';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ============================================
// CARD COLORS
// ============================================

const CARD_COLORS = {
  network: '#2E8B57',   // Green
  quote: '#FF6347',     // Coral
  tip: '#2D3748',       // Dark slate
  stat: '#00CED1',      // Cyan
  insight: '#8B5CF6',   // Purple
  trending: '#1a1a1a',  // Black
};

// ============================================
// BUILD SOURCES (respects privacy preference)
// ============================================

function buildSources(
  tweets: RankedTweet[],
  storeSnapshots: boolean
): ClueSource[] {
  return tweets.slice(0, 3).map(t => ({
    handle: `@${t.author.username}`,
    platform: 'x' as const,
    post_id: storeSnapshots ? t.id : null,
    post_url: `https://x.com/${t.author.username}/status/${t.id}`,
    // Only store tweet text if user opted in
    note: storeSnapshots 
      ? (t.text.slice(0, 100) + (t.text.length > 100 ? '...' : ''))
      : '',
  }));
}

// ============================================
// CLUSTER TWEETS BY TOPIC
// ============================================

interface TweetCluster {
  topic: string;
  tweets: RankedTweet[];
  totalScore: number;
}

function clusterTweets(tweets: RankedTweet[], maxClusters = 10): TweetCluster[] {
  // Simple keyword-based clustering (in production, use embeddings)
  const clusters = new Map<string, RankedTweet[]>();
  
  const topicKeywords: Record<string, string[]> = {
    'AI Agents': ['agent', 'agentic', 'autonomous', 'mcp', 'tool use', 'function calling'],
    'AI Models': ['gpt', 'claude', 'llm', 'model', 'benchmark', 'anthropic', 'openai'],
    'Startups': ['startup', 'founder', 'yc', 'raised', 'seed', 'series', 'vc', 'investor'],
    'Engineering': ['code', 'coding', 'programming', 'developer', 'engineer', 'rust', 'typescript'],
    'Product': ['product', 'feature', 'launch', 'ship', 'users', 'growth', 'retention'],
    'Marketing': ['marketing', 'brand', 'campaign', 'ads', 'content', 'social'],
    'Design': ['design', 'ui', 'ux', 'figma', 'prototype', 'visual'],
    'Careers': ['hiring', 'job', 'career', 'interview', 'salary', 'remote'],
    'Security': ['security', 'vulnerability', 'hack', 'breach', 'privacy', 'encrypt'],
    'Crypto': ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'web3', 'defi'],
  };
  
  for (const tweet of tweets) {
    const text = tweet.text.toLowerCase();
    let assigned = false;
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        if (!clusters.has(topic)) clusters.set(topic, []);
        clusters.get(topic)!.push(tweet);
        assigned = true;
        break;
      }
    }
    
    if (!assigned) {
      if (!clusters.has('General')) clusters.set('General', []);
      clusters.get('General')!.push(tweet);
    }
  }
  
  // Convert to array and sort by total engagement
  return Array.from(clusters.entries())
    .map(([topic, tweets]) => ({
      topic,
      tweets,
      totalScore: tweets.reduce((sum, t) => sum + t.score, 0),
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, maxClusters);
}

// ============================================
// GENERATE CLUE VIA LLM
// ============================================

async function generateClueFromCluster(
  cluster: TweetCluster,
  userProfessions: string[],
  storeSnapshots: boolean
): Promise<Clue | null> {
  const topTweets = cluster.tweets.slice(0, 5);
  
  const prompt = `You are a curator for a professional intelligence app called Clue. Generate a clue card based on these tweets about "${cluster.topic}".

TWEETS:
${topTweets.map((t, i) => `${i + 1}. @${t.author.username} (${t.author.public_metrics?.followers_count || 0} followers):
"${t.text}"
Engagement: ${t.public_metrics?.like_count || 0} likes, ${t.public_metrics?.retweet_count || 0} retweets
Posted: ${t.created_at}`).join('\n\n')}

USER'S PROFESSIONS: ${userProfessions.join(', ') || 'General professional'}

Generate a clue card. Choose the best type:
- "network": When multiple people are discussing the same thing (use for 3+ tweets on same topic)
- "quote": When there's one standout quote worth highlighting
- "stat": When there's a compelling number/statistic
- "tip": When there's actionable advice or a tactic

Respond with JSON only:
{
  "type": "network" | "quote" | "stat" | "tip",
  "badge": "emoji + short label like '👥 your network' or '📊 data' or '💬 quote' or '🧠 tactic'",
  "title": "compelling headline (for network/stat/tip types)",
  "subtitle": "context line for network cards like '8 people you follow discussed this'",
  "quote": "the exact quote text (for quote type only)",
  "author": "@handle (for quote type only)",
  "stat": "the number like '200K+' or '73%' (for stat type only)",
  "stat_label": "what the stat measures (for stat type only)", 
  "detail": "2-3 sentence summary of why this matters and what's happening",
  "handles": ["@user1", "@user2", "@user3"],
  "prompts": ["follow-up question 1?", "follow-up question 2?"],
  "read_time": "30 sec"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });
    
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const clueData = JSON.parse(jsonMatch[0]);
    
    // Build sources respecting user's privacy preference
    const sources = buildSources(topTweets, storeSnapshots);
    
    // Calculate time ago from most recent tweet
    const mostRecent = topTweets[0];
    const hoursAgo = Math.round((Date.now() - new Date(mostRecent.created_at).getTime()) / (1000 * 60 * 60));
    const timeAgo = hoursAgo < 1 ? 'just now' : hoursAgo === 1 ? '1 hour ago' : `${hoursAgo} hours ago`;
    
    // Determine color based on type
    let color = CARD_COLORS.network;
    if (clueData.type === 'quote') color = CARD_COLORS.quote;
    else if (clueData.type === 'stat') color = CARD_COLORS.stat;
    else if (clueData.type === 'tip') color = CARD_COLORS.tip;
    
    const clue: Clue = {
      id: `clue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: clueData.type,
      badge: clueData.badge,
      title: clueData.title || null,
      subtitle: clueData.subtitle || null,
      quote: clueData.quote || null,
      author: clueData.author || null,
      stat: clueData.stat || null,
      stat_label: clueData.stat_label || null,
      detail: clueData.detail,
      handles: clueData.handles || [],
      platform: 'x',
      sources,
      prompts: clueData.prompts || [],
      topic: cluster.topic,
      read_time: clueData.read_time || '30 sec',
      time_ago: timeAgo,
      color,
    };
    
    return clue;
    
  } catch (error) {
    console.error('Clue generation error:', error);
    return null;
  }
}

// ============================================
// GENERATE DAILY CLUES
// ============================================

export async function generateDailyClues(
  userId: string,
  rankedTweets: RankedTweet[],
  count = 3
): Promise<Clue[]> {
  console.log(`[Clue Gen] Generating ${count} clues for user ${userId}`);
  
  // Get user preferences for personalization
  const prefs = await getUserPreferences(userId);
  const professions = prefs?.professions || [];
  const storeSnapshots = prefs?.store_source_snapshots || false;
  
  // Cluster tweets by topic
  const clusters = clusterTweets(rankedTweets, count + 2);
  console.log(`[Clue Gen] Found ${clusters.length} topic clusters`);
  
  if (clusters.length === 0) {
    console.log('[Clue Gen] No clusters found, cannot generate clues');
    return [];
  }
  
  // Generate clues from top clusters
  const clues: Clue[] = [];
  
  for (const cluster of clusters) {
    if (clues.length >= count) break;
    
    console.log(`[Clue Gen] Processing cluster: ${cluster.topic} (${cluster.tweets.length} tweets)`);
    
    const clue = await generateClueFromCluster(cluster, professions, storeSnapshots);
    if (clue) {
      clues.push(clue);
      console.log(`[Clue Gen] Generated ${clue.type} clue: ${clue.title || clue.quote?.slice(0, 50)}`);
    }
  }
  
  return clues;
}

// ============================================
// VALIDATE CLUE OUTPUT
// ============================================

export function validateClue(clue: any): clue is Clue {
  if (!clue || typeof clue !== 'object') return false;
  
  const requiredFields = ['id', 'type', 'badge', 'detail', 'platform', 'topic'];
  for (const field of requiredFields) {
    if (!(field in clue)) return false;
  }
  
  const validTypes = ['network', 'quote', 'stat', 'tip', 'insight'];
  if (!validTypes.includes(clue.type)) return false;
  
  // Type-specific validation
  if (clue.type === 'quote' && !clue.quote) return false;
  if (clue.type === 'stat' && !clue.stat) return false;
  if (clue.type === 'network' && !clue.title) return false;
  
  return true;
}
