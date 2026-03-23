// Environment configuration
export const env = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Database (Supabase)
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
  
  // Auth
  JWT_SECRET: process.env.JWT_SECRET!,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
  
  // X (Twitter)
  X_CLIENT_ID: process.env.X_CLIENT_ID!,
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET!,
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN!,
  
  // LinkedIn
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID!,
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET!,
  
  // LLM
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  
  // Push Notifications
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET!,
  STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID!,
  
  // App
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  CALLBACK_URL: process.env.CALLBACK_URL || 'http://localhost:3000/auth/callback',
};

// Validate required env vars in production
export function validateEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY', 
    'JWT_SECRET',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
