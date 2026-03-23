-- Clue Database Schema
-- Run with: supabase db push

-- Enable pgvector for embeddings
create extension if not exists vector;

-- ============================================
-- USERS
-- ============================================
create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_id text unique not null,
  email text,
  goal text,
  professions text[] default '{}',
  daily_clues int default 3 check (daily_clues in (3, 5, 10)),
  timezone text default 'America/New_York',
  push_enabled boolean default true,
  push_time time default '07:00',
  streak int default 0,
  longest_streak int default 0,
  shields int default 0,
  score int default 0,
  last_completed_at date,
  subscription_tier text default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index users_clerk_id_idx on users(clerk_id);

-- ============================================
-- SOCIAL ACCOUNTS
-- ============================================
create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  platform text not null,
  platform_user_id text not null,
  username text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  sync_cursor text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, platform)
);

-- ============================================
-- FOLLOWS
-- ============================================
create table follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  platform text not null,
  account_id text not null,
  username text,
  display_name text,
  influence_score float default 0.5,
  relevance_score float default 0.5,
  follower_count int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, platform, account_id)
);

create index follows_user_platform_idx on follows(user_id, platform);

-- ============================================
-- RAW CONTENT
-- ============================================
create table raw_content (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  platform_content_id text not null unique,
  author_id text not null,
  author_username text,
  content_type text default 'post',
  content text not null,
  likes int default 0,
  reposts int default 0,
  replies int default 0,
  views int default 0,
  embedding vector(1536),
  topics text[],
  signal_score float,
  posted_at timestamptz not null,
  fetched_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '48 hours')
);

create index raw_content_author_idx on raw_content(author_id);
create index raw_content_signal_idx on raw_content(signal_score desc);

-- ============================================
-- CLUES
-- ============================================
create table clues (
  id uuid primary key default gen_random_uuid(),
  clue_type text not null,
  title text,
  content text,
  stat text,
  stat_label text,
  quote text,
  author text,
  source_handles text[],
  source_notes jsonb,
  topics text[],
  professions text[],
  read_time text,
  key_points int,
  signal_score float not null,
  prompts text[],
  generated_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '7 days')
);

create index clues_score_idx on clues(signal_score desc);

-- ============================================
-- USER CLUES
-- ============================================
create table user_clues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  clue_id uuid references clues(id) on delete cascade,
  batch_date date not null,
  position int not null,
  action text,
  action_at timestamptz,
  shared_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, clue_id, batch_date)
);

create index user_clues_user_date_idx on user_clues(user_id, batch_date);

-- ============================================
-- ACHIEVEMENTS
-- ============================================
create table achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  achievement_type text not null,
  unlocked_at timestamptz default now(),
  unique(user_id, achievement_type)
);

-- ============================================
-- LEARN CONVERSATIONS
-- ============================================
create table learn_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  messages jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at before update on users
  for each row execute function update_updated_at();

create trigger social_accounts_updated_at before update on social_accounts
  for each row execute function update_updated_at();
