import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { env } from './env.js';

// ============================================
// ENCRYPTION CONFIG
// Uses AES-256-GCM for authenticated encryption
// ============================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Derive key from secret
function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

// ============================================
// ENCRYPT
// ============================================

export function encrypt(plaintext: string): string {
  const secret = env.JWT_SECRET || 'default-secret-change-me';
  
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  
  // Derive key from secret + salt
  const key = deriveKey(secret, salt);
  
  // Create cipher
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get auth tag
  const authTag = cipher.getAuthTag();
  
  // Combine: salt + iv + authTag + encrypted
  const combined = Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'hex'),
  ]);
  
  return combined.toString('base64');
}

// ============================================
// DECRYPT
// ============================================

export function decrypt(encryptedData: string): string {
  const secret = env.JWT_SECRET || 'default-secret-change-me';
  
  // Decode from base64
  const combined = Buffer.from(encryptedData, 'base64');
  
  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  // Derive key from secret + salt
  const key = deriveKey(secret, salt);
  
  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

// ============================================
// SAFE ENCRYPT/DECRYPT (won't throw)
// ============================================

export function safeEncrypt(plaintext: string): string | null {
  try {
    return encrypt(plaintext);
  } catch (error) {
    console.error('[Crypto] Encryption failed:', error);
    return null;
  }
}

export function safeDecrypt(encryptedData: string): string | null {
  try {
    return decrypt(encryptedData);
  } catch (error) {
    console.error('[Crypto] Decryption failed:', error);
    return null;
  }
}

// ============================================
// TOKEN HELPERS
// ============================================

export interface EncryptedToken {
  access_token: string;
  refresh_token: string | null;
}

export function encryptTokens(
  accessToken: string,
  refreshToken: string | null
): EncryptedToken {
  return {
    access_token: encrypt(accessToken),
    refresh_token: refreshToken ? encrypt(refreshToken) : null,
  };
}

export function decryptTokens(
  encryptedAccess: string,
  encryptedRefresh: string | null
): EncryptedToken {
  return {
    access_token: decrypt(encryptedAccess),
    refresh_token: encryptedRefresh ? decrypt(encryptedRefresh) : null,
  };
}
