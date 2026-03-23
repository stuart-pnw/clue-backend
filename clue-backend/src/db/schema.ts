// ============================================
// CLUE DATABASE SCHEMA
// ============================================

// ============================================
// 1. USERS & AUTH
// ============================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  auth_provider: 'google' | 'x' | 'linkedin' | 'email';
  created_at: string;
  last_active_at: string;
  timezone: string;
  delivery_time: '6am' | '7am' | '8am' | '9am';
  onboarding_complete: boolean;
}

export interface UserPreferences {
  user_id: string;
  goal: 'ahead' | 'scroll' | 'ideas' | 'network' | null;
  professions: string[]; // ['marketing', 'product', 'engineering', etc.]
  push_notifications: boolean;
  network_scanning: boolean;
  personalized_insights: boolean;
  usage_analytics: boolean;
  // Privacy settings
  store_source_snapshots: boolean; // Opt-in: store raw tweet text in clues
  updated_at: string;
}

export interface ConnectedAccount {
  id: string;
  user_id: string;
  platform: 'x' | 'linkedin';
  platform_user_id: string;
  platform_username: string;
  access_token: string; // encrypted
  refresh_token: string | null; // encrypted
  token_expires_at: string | null;
  scopes: string[];
  connected_at: string;
}

// ============================================
// 2. CLUES
// ============================================

export interface ClueSource {
  handle: string;
  platform: 'x' | 'linkedin';
  post_id: string | null;
  post_url: string | null;
  note: string;
}

export interface Clue {
  id: string;
  type: 'network' | 'quote' | 'stat' | 'tip' | 'insight';
  badge: string;
  title: string | null;
  subtitle: string | null;
  quote: string | null;
  author: string | null;
  stat: string | null;
  stat_label: string | null;
  detail: string;
  handles: string[];
  platform: 'x' | 'linkedin';
  sources: ClueSource[];
  prompts: string[];
  topic: string;
  read_time: string;
  time_ago: string;
  color: string;
}

export interface DailyClues {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  clues: Clue[];
  generated_at: string;
  delivered_at: string | null;
}

// ============================================
// 3. USER ACTIONS & LIBRARY
// ============================================

export interface UserAction {
  id: string;
  user_id: string;
  clue_id: string;
  action: 'seen' | 'saved' | 'skipped' | 'shared' | 'expanded';
  created_at: string;
  metadata: Record<string, any> | null;
}

export interface SavedClue {
  id: string;
  user_id: string;
  clue: Clue;
  saved_at: string;
  mastery: 0 | 1 | 2 | 3;
  last_reviewed_at: string | null;
  topic: string;
}

// ============================================
// 4. STREAKS & STATS
// ============================================

export interface UserStats {
  user_id: string;
  streak: number;
  longest_streak: number;
  last_active_date: string | null; // YYYY-MM-DD
  total_clues_seen: number;
  total_saved: number;
  score: number;
  shields: number;
  updated_at: string;
}

// ============================================
// 5. PUSH NOTIFICATIONS
// ============================================

export interface DeviceToken {
  id: string;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  created_at: string;
  last_used_at: string;
}

// ============================================
// 6. LEARN (AI Chat)
// ============================================

export interface LearnConversation {
  id: string;
  user_id: string;
  started_at: string;
  last_message_at: string;
  context_clue_ids: string[];
}

export interface LearnMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  tokens_used?: number;
}

// ============================================
// 7. SUBSCRIPTIONS
// ============================================

export interface Subscription {
  user_id: string;
  tier: 'free' | 'pro';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
}

// ============================================
// 8. REFERRALS
// ============================================

export interface ReferralCode {
  id: string;
  user_id: string;
  code: string;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
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

// ============================================
// 9. ACHIEVEMENTS
// ============================================

export interface Achievement {
  id: string;
  user_id: string;
  achievement_id: string;
  unlocked_at: string;
  progress: number;
}

// ============================================
// 10. SHARES
// ============================================

export interface Share {
  id: string;
  user_id: string;
  clue_id: string;
  share_id: string;
  platform: 'x' | 'linkedin' | 'copy' | 'other';
  share_link: string;
  click_count: number;
  shared_at: string;
}

// ============================================
// 11. SIGNALS (Real-time)
// ============================================

export interface Signal {
  id: string;
  user_id: string;
  type: 'breaking' | 'trending' | 'mention';
  title: string;
  preview: string;
  source_count: number;
  detected_at: string;
  seen: boolean;
  clue_id: string | null;
}

// ============================================
// SQL MIGRATIONS
// ============================================

export const MIGRATIONS = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('google', 'x', 'linkedin', 'email')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  timezone TEXT DEFAULT 'America/Los_Angeles',
  delivery_time TEXT DEFAULT '7am' CHECK (delivery_time IN ('6am', '7am', '8am', '9am')),
  onboarding_complete BOOLEAN DEFAULT FALSE
);

-- 2. User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  goal TEXT CHECK (goal IN ('ahead', 'scroll', 'ideas', 'network')),
  professions TEXT[] DEFAULT '{}',
  push_notifications BOOLEAN DEFAULT TRUE,
  network_scanning BOOLEAN DEFAULT TRUE,
  personalized_insights BOOLEAN DEFAULT TRUE,
  usage_analytics BOOLEAN DEFAULT TRUE,
  store_source_snapshots BOOLEAN DEFAULT FALSE, -- Opt-in: store raw content in clues
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Connected accounts
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin')),
  platform_user_id TEXT NOT NULL,
  platform_username TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[] DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

-- 4. Daily clues
CREATE TABLE IF NOT EXISTS daily_clues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  clues JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  UNIQUE(user_id, date)
);

-- 5. User actions
CREATE TABLE IF NOT EXISTS user_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clue_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('seen', 'saved', 'skipped', 'shared', 'expanded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

-- 6. Saved clues (library)
CREATE TABLE IF NOT EXISTS saved_clues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clue JSONB NOT NULL,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  mastery INTEGER DEFAULT 0 CHECK (mastery >= 0 AND mastery <= 3),
  last_reviewed_at TIMESTAMPTZ,
  topic TEXT
);

-- 7. User stats
CREATE TABLE IF NOT EXISTS user_stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_active_date DATE,
  total_clues_seen INTEGER DEFAULT 0,
  total_saved INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  shields INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Device tokens for push notifications
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Learn conversations
CREATE TABLE IF NOT EXISTS learn_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  context_clue_ids TEXT[] DEFAULT '{}'
);

-- 10. Learn messages
CREATE TABLE IF NOT EXISTS learn_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES learn_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tokens_used INTEGER
);

-- 11. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete'))
);

-- 12. Referral codes
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Referrals
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  reward_granted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 14. Referral rewards
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('bonus_clues', 'unlimited_week', 'free_month')),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  used BOOLEAN DEFAULT FALSE
);

-- 15. Achievements
CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  progress INTEGER DEFAULT 0,
  UNIQUE(user_id, achievement_id)
);

-- 16. Shares
CREATE TABLE IF NOT EXISTS shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clue_id TEXT NOT NULL,
  share_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'copy', 'other')),
  share_link TEXT NOT NULL,
  click_count INTEGER DEFAULT 0,
  shared_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. Signals (real-time)
CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('breaking', 'trending', 'mention')),
  title TEXT NOT NULL,
  preview TEXT,
  source_count INTEGER DEFAULT 1,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  seen BOOLEAN DEFAULT FALSE,
  clue_id TEXT
);

-- 18. Analytics events
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  session_id TEXT,
  device_type TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. Analytics user properties
CREATE TABLE IF NOT EXISTS analytics_user_properties (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  properties JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_daily_clues_user_date ON daily_clues(user_id, date);
CREATE INDEX IF NOT EXISTS idx_user_actions_user ON user_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_clues_user ON saved_clues(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_learn_conversations_user ON learn_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_learn_messages_conversation ON learn_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_share_id ON shares(share_id);
CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);

-- Helper functions
CREATE OR REPLACE FUNCTION increment_share_clicks(p_share_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE shares SET click_count = click_count + 1 WHERE share_id = p_share_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_bonus_clues(p_user_id UUID, p_amount INTEGER)
RETURNS VOID AS $$
BEGIN
  -- This would update a bonus_clues field on user_stats
  -- For now, just log
  RAISE NOTICE 'Adding % bonus clues to user %', p_amount, p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS user_preferences_updated_at ON user_preferences;
CREATE TRIGGER user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS user_stats_updated_at ON user_stats;
CREATE TRIGGER user_stats_updated_at
  BEFORE UPDATE ON user_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;
