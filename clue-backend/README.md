# Clue Backend

Production-ready backend API for the Clue app - your daily intelligence layer.

## Tech Stack

- **Runtime**: Node.js 20+ / TypeScript
- **Framework**: Hono (fast, lightweight)
- **Database**: PostgreSQL via Supabase
- **Auth**: Google, X, LinkedIn OAuth 2.0 + JWT
- **AI**: Anthropic Claude (clue generation)
- **Payments**: Stripe (subscriptions)
- **Push**: Firebase Cloud Messaging

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Run database migrations (in Supabase SQL Editor)
# Copy MIGRATIONS constant from src/db/schema.ts

# Start development server
npm run dev
```

## API Endpoints (50+)

### Auth
- `GET /auth/google` - Google OAuth
- `GET /auth/x` - X OAuth  
- `GET /auth/linkedin` - LinkedIn OAuth
- `GET /auth/me` - Current user
- `POST /auth/refresh` - Refresh JWT

### Clues
- `GET /clues/today` - Daily clues
- `POST /clues/:id/action` - Track action
- `GET /clues/library` - Saved clues

### Learn
- `POST /learn/ask` - AI chat
- `GET /learn/suggestions` - Smart prompts

### Subscription
- `GET /subscription` - Status
- `POST /subscription/checkout` - Stripe checkout

### Growth
- `GET /referrals` - Referral stats
- `GET /leaderboard` - Rankings
- `GET /achievements` - Badges

### Compliance
- `GET /gdpr/export` - Export data
- `DELETE /gdpr/account` - Delete account

## Database (19 tables)

users, user_preferences, connected_accounts, daily_clues, user_actions, saved_clues, user_stats, device_tokens, learn_conversations, learn_messages, subscriptions, referral_codes, referrals, referral_rewards, achievements, shares, signals, analytics_events, analytics_user_properties

## Security

- Rate limiting (per-IP, per-user)
- Token encryption (AES-256-GCM)
- JWT auth with refresh
- Input validation (Zod)
- Structured error handling
- GDPR compliance

## License

Proprietary
