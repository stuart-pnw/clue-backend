import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../lib/env.js';
import type { 
  User, 
  UserPreferences, 
  ConnectedAccount, 
  DailyClues, 
  UserAction, 
  SavedClue, 
  UserStats,
  DeviceToken,
  Clue
} from './schema.js';

// Initialize Supabase client
let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

// ============================================
// USER OPERATIONS
// ============================================

export async function createUser(data: {
  email: string;
  name: string;
  avatar_url?: string;
  auth_provider: 'google' | 'x' | 'linkedin' | 'email';
}): Promise<User> {
  const db = getSupabase();
  
  const { data: user, error } = await db
    .from('users')
    .insert(data)
    .select()
    .single();
    
  if (error) throw error;
  
  // Create default preferences and stats
  await db.from('user_preferences').insert({ user_id: user.id });
  await db.from('user_stats').insert({ user_id: user.id });
  
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('users')
    .select()
    .eq('id', id)
    .single();
    
  if (error) return null;
  return data;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('users')
    .select()
    .eq('email', email)
    .single();
    
  if (error) return null;
  return data;
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const db = getSupabase();
  const { data: user, error } = await db
    .from('users')
    .update({ ...data, last_active_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
    
  if (error) throw error;
  return user;
}

// ============================================
// USER PREFERENCES
// ============================================

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('user_preferences')
    .select()
    .eq('user_id', userId)
    .single();
    
  if (error) return null;
  return data;
}

export async function updateUserPreferences(
  userId: string, 
  data: Partial<UserPreferences>
): Promise<UserPreferences> {
  const db = getSupabase();
  const { data: prefs, error } = await db
    .from('user_preferences')
    .update(data)
    .eq('user_id', userId)
    .select()
    .single();
    
  if (error) throw error;
  return prefs;
}

// ============================================
// CONNECTED ACCOUNTS
// ============================================

export async function getConnectedAccounts(userId: string): Promise<ConnectedAccount[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('connected_accounts')
    .select()
    .eq('user_id', userId);
    
  if (error) throw error;
  return data || [];
}

export async function getConnectedAccount(
  userId: string, 
  platform: 'x' | 'linkedin'
): Promise<ConnectedAccount | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('connected_accounts')
    .select()
    .eq('user_id', userId)
    .eq('platform', platform)
    .single();
    
  if (error) return null;
  return data;
}

export async function upsertConnectedAccount(data: Omit<ConnectedAccount, 'id' | 'connected_at'>): Promise<ConnectedAccount> {
  const db = getSupabase();
  const { data: account, error } = await db
    .from('connected_accounts')
    .upsert(data, { onConflict: 'user_id,platform' })
    .select()
    .single();
    
  if (error) throw error;
  return account;
}

export async function deleteConnectedAccount(userId: string, platform: 'x' | 'linkedin'): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('connected_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform);
    
  if (error) throw error;
}

// ============================================
// DAILY CLUES
// ============================================

export async function getDailyClues(userId: string, date: string): Promise<DailyClues | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('daily_clues')
    .select()
    .eq('user_id', userId)
    .eq('date', date)
    .single();
    
  if (error) return null;
  return data;
}

export async function saveDailyClues(
  userId: string, 
  date: string, 
  clues: Clue[]
): Promise<DailyClues> {
  const db = getSupabase();
  const { data, error } = await db
    .from('daily_clues')
    .upsert({
      user_id: userId,
      date,
      clues,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,date' })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

export async function markCluesDelivered(userId: string, date: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('daily_clues')
    .update({ delivered_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('date', date);
    
  if (error) throw error;
}

// ============================================
// USER ACTIONS
// ============================================

export async function recordAction(
  userId: string,
  clueId: string,
  action: 'seen' | 'saved' | 'skipped' | 'shared' | 'expanded',
  metadata?: Record<string, any>
): Promise<UserAction> {
  const db = getSupabase();
  const { data, error } = await db
    .from('user_actions')
    .insert({
      user_id: userId,
      clue_id: clueId,
      action,
      metadata,
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

export async function getUserActionsToday(userId: string): Promise<UserAction[]> {
  const db = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  
  const { data, error } = await db
    .from('user_actions')
    .select()
    .eq('user_id', userId)
    .gte('created_at', `${today}T00:00:00Z`);
    
  if (error) throw error;
  return data || [];
}

// ============================================
// SAVED CLUES (LIBRARY)
// ============================================

export async function saveClue(userId: string, clue: Clue): Promise<SavedClue> {
  const db = getSupabase();
  const { data, error } = await db
    .from('saved_clues')
    .insert({
      user_id: userId,
      clue,
      topic: clue.topic,
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

export async function getSavedClues(userId: string): Promise<SavedClue[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('saved_clues')
    .select()
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });
    
  if (error) throw error;
  return data || [];
}

export async function deleteSavedClue(userId: string, clueId: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('saved_clues')
    .delete()
    .eq('user_id', userId)
    .eq('id', clueId);
    
  if (error) throw error;
}

export async function updateClueMastery(
  userId: string, 
  clueId: string, 
  mastery: 0 | 1 | 2 | 3
): Promise<SavedClue> {
  const db = getSupabase();
  const { data, error } = await db
    .from('saved_clues')
    .update({ 
      mastery, 
      last_reviewed_at: new Date().toISOString() 
    })
    .eq('user_id', userId)
    .eq('id', clueId)
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

// ============================================
// USER STATS
// ============================================

export async function getUserStats(userId: string): Promise<UserStats | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from('user_stats')
    .select()
    .eq('user_id', userId)
    .single();
    
  if (error) return null;
  return data;
}

export async function updateUserStats(
  userId: string, 
  data: Partial<UserStats>
): Promise<UserStats> {
  const db = getSupabase();
  const { data: stats, error } = await db
    .from('user_stats')
    .update(data)
    .eq('user_id', userId)
    .select()
    .single();
    
  if (error) throw error;
  return stats;
}

export async function incrementStats(
  userId: string,
  increments: { 
    total_clues_seen?: number; 
    total_saved?: number; 
    score?: number;
  }
): Promise<UserStats> {
  const db = getSupabase();
  const current = await getUserStats(userId);
  if (!current) throw new Error('User stats not found');
  
  const { data: stats, error } = await db
    .from('user_stats')
    .update({
      total_clues_seen: current.total_clues_seen + (increments.total_clues_seen || 0),
      total_saved: current.total_saved + (increments.total_saved || 0),
      score: current.score + (increments.score || 0),
    })
    .eq('user_id', userId)
    .select()
    .single();
    
  if (error) throw error;
  return stats;
}

// ============================================
// DEVICE TOKENS
// ============================================

export async function saveDeviceToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android' | 'web'
): Promise<DeviceToken> {
  const db = getSupabase();
  const { data, error } = await db
    .from('device_tokens')
    .upsert({
      user_id: userId,
      token,
      platform,
      last_used_at: new Date().toISOString(),
    }, { onConflict: 'token' })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

export async function getDeviceTokens(userId: string): Promise<DeviceToken[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('device_tokens')
    .select()
    .eq('user_id', userId);
    
  if (error) throw error;
  return data || [];
}

export async function deleteDeviceToken(token: string): Promise<void> {
  const db = getSupabase();
  const { error } = await db
    .from('device_tokens')
    .delete()
    .eq('token', token);
    
  if (error) throw error;
}

// ============================================
// USERS BY DELIVERY TIME (for scheduling)
// ============================================

export async function getUsersByDeliveryTime(
  deliveryTime: '6am' | '7am' | '8am' | '9am',
  timezone: string
): Promise<User[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from('users')
    .select()
    .eq('delivery_time', deliveryTime)
    .eq('timezone', timezone)
    .eq('onboarding_complete', true);
    
  if (error) throw error;
  return data || [];
}
