import Stripe from 'stripe';
import { env } from '../lib/env.js';
import { getSupabase } from '../db/client.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// ============================================
// TYPES
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
// GET OR CREATE CUSTOMER
// ============================================

export async function getOrCreateCustomer(
  userId: string,
  email: string,
  name: string
): Promise<string> {
  const db = getSupabase();
  
  // Check if user already has a customer ID
  const { data: existing } = await db
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single();
  
  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id;
  }
  
  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { user_id: userId },
  });
  
  // Save to database
  await db.from('subscriptions').upsert({
    user_id: userId,
    tier: 'free',
    stripe_customer_id: customer.id,
    status: 'active',
  }, { onConflict: 'user_id' });
  
  return customer.id;
}

// ============================================
// CREATE CHECKOUT SESSION
// ============================================

export async function createCheckoutSession(
  userId: string,
  email: string,
  name: string
): Promise<string> {
  const customerId = await getOrCreateCustomer(userId, email, name);
  
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${env.APP_URL}/settings?upgraded=true`,
    cancel_url: `${env.APP_URL}/settings?canceled=true`,
    metadata: { user_id: userId },
    subscription_data: {
      metadata: { user_id: userId },
    },
    allow_promotion_codes: true,
  });
  
  return session.url!;
}

// ============================================
// CREATE PORTAL SESSION
// ============================================

export async function createPortalSession(userId: string): Promise<string> {
  const db = getSupabase();
  
  const { data: sub } = await db
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single();
  
  if (!sub?.stripe_customer_id) {
    throw new Error('No subscription found');
  }
  
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${env.APP_URL}/settings`,
  });
  
  return session.url;
}

// ============================================
// GET SUBSCRIPTION
// ============================================

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const db = getSupabase();
  
  const { data, error } = await db
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error || !data) {
    // Return default free tier
    return {
      user_id: userId,
      tier: 'free',
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      status: 'active',
    };
  }
  
  return data;
}

// ============================================
// HANDLE WEBHOOK EVENTS
// ============================================

export async function handleWebhookEvent(
  payload: string,
  signature: string
): Promise<void> {
  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    env.STRIPE_WEBHOOK_SECRET
  );
  
  const db = getSupabase();
  
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      
      if (userId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );
        
        await db.from('subscriptions').upsert({
          user_id: userId,
          tier: 'pro',
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscription.id,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          status: 'active',
        }, { onConflict: 'user_id' });
        
        console.log(`[Stripe] User ${userId} upgraded to Pro`);
      }
      break;
    }
    
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      
      if (userId) {
        await db.from('subscriptions').update({
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          status: subscription.status as any,
        }).eq('user_id', userId);
        
        console.log(`[Stripe] Subscription updated for user ${userId}`);
      }
      break;
    }
    
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      
      if (userId) {
        await db.from('subscriptions').update({
          tier: 'free',
          stripe_subscription_id: null,
          current_period_start: null,
          current_period_end: null,
          cancel_at_period_end: false,
          status: 'canceled',
        }).eq('user_id', userId);
        
        console.log(`[Stripe] Subscription canceled for user ${userId}`);
      }
      break;
    }
    
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      
      // Find user by customer ID
      const { data: sub } = await db
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .single();
      
      if (sub) {
        await db.from('subscriptions').update({
          status: 'past_due',
        }).eq('user_id', sub.user_id);
        
        console.log(`[Stripe] Payment failed for user ${sub.user_id}`);
      }
      break;
    }
    
    default:
      console.log(`[Stripe] Unhandled event type: ${event.type}`);
  }
}

// ============================================
// TIER LIMITS
// ============================================

export const TIER_LIMITS = {
  free: {
    daily_clues: 3,
    library_size: 50,
    learn_messages_per_day: 10,
  },
  pro: {
    daily_clues: 10,
    library_size: 500,
    learn_messages_per_day: 100,
  },
};

export function getClueLimit(tier: 'free' | 'pro'): number {
  return TIER_LIMITS[tier].daily_clues;
}

export function getLibraryLimit(tier: 'free' | 'pro'): number {
  return TIER_LIMITS[tier].library_size;
}
