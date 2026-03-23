import { z } from 'zod';

// ============================================
// AUTH SCHEMAS
// ============================================

export const DeviceTokenSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']),
});

// ============================================
// USER SCHEMAS
// ============================================

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().max(50).optional(),
  delivery_time: z.enum(['6am', '7am', '8am', '9am']).optional(),
  onboarding_complete: z.boolean().optional(),
});

export const UpdatePreferencesSchema = z.object({
  goal: z.enum(['ahead', 'scroll', 'ideas', 'network']).optional(),
  professions: z.array(z.string().max(50)).max(10).optional(),
  push_notifications: z.boolean().optional(),
  network_scanning: z.boolean().optional(),
  personalized_insights: z.boolean().optional(),
  usage_analytics: z.boolean().optional(),
  store_source_snapshots: z.boolean().optional(), // Opt-in for richer clues
});

// ============================================
// CLUE SCHEMAS
// ============================================

export const ClueActionSchema = z.object({
  action: z.enum(['seen', 'saved', 'skipped', 'shared', 'expanded']),
  clue: z.any().optional(), // Full clue object for saving
});

export const MasteryUpdateSchema = z.object({
  mastery: z.number().int().min(0).max(3),
});

// ============================================
// LEARN SCHEMAS
// ============================================

export const LearnAskSchema = z.object({
  message: z.string().min(1).max(5000),
  conversation_id: z.string().uuid().optional(),
  clue_ids: z.array(z.string()).max(10).optional(),
});

// ============================================
// SHARE SCHEMAS
// ============================================

export const ShareSchema = z.object({
  platform: z.enum(['x', 'linkedin', 'copy', 'other']).default('other'),
});

// ============================================
// REFERRAL SCHEMAS
// ============================================

export const InviteSchema = z.object({
  method: z.enum(['sms', 'email', 'share']),
  recipient: z.string().max(200).optional(),
});

// ============================================
// SUBSCRIPTION SCHEMAS
// ============================================

export const WebhookSchema = z.object({
  type: z.string(),
  data: z.object({
    object: z.any(),
  }),
});

// ============================================
// VALIDATION HELPER
// ============================================

export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.errors.map(e => 
    `${e.path.join('.')}: ${e.message}`
  ).join(', ');
  
  return { success: false, error: errors };
}

// ============================================
// COMMON VALIDATORS
// ============================================

export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email().max(255);
export const urlSchema = z.string().url().max(2000);

export function isValidUUID(id: string): boolean {
  return uuidSchema.safeParse(id).success;
}

export function isValidEmail(email: string): boolean {
  return emailSchema.safeParse(email).success;
}
