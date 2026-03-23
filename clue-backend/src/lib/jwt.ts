import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';
import type { User } from '../db/schema.js';

const secret = new TextEncoder().encode(env.JWT_SECRET || 'dev-secret-key-change-in-production');

export interface JWTPayload {
  sub: string; // user id
  email: string;
  name: string;
  iat: number;
  exp: number;
}

export async function signToken(user: User): Promise<string> {
  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
    
  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}
