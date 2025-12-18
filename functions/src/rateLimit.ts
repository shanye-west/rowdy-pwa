/**
 * Simple in-memory rate limiter for admin functions.
 * Tracks call counts per user per function within a time window.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  maxCalls: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a user has exceeded rate limit for a function.
 * @param uid - User ID
 * @param functionName - Name of the function being rate-limited
 * @param config - Rate limit configuration
 * @returns Result indicating if call is allowed
 */
export function checkRateLimit(
  uid: string,
  functionName: string,
  config: RateLimitConfig
): RateLimitResult {
  const key = `${uid}:${functionName}`;
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  
  const entry = rateLimitStore.get(key);
  
  if (!entry || now - entry.windowStart > windowMs) {
    // New window - allow and set count to 1
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: config.maxCalls - 1,
      resetAt: now + windowMs,
    };
  }
  
  // Within existing window
  if (entry.count >= config.maxCalls) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + windowMs,
    };
  }
  
  // Increment and allow
  entry.count++;
  rateLimitStore.set(key, entry);
  
  return {
    allowed: true,
    remaining: config.maxCalls - entry.count,
    resetAt: entry.windowStart + windowMs,
  };
}

/**
 * Periodically clean up old rate limit entries to prevent memory leaks.
 * Call this in a scheduled function (e.g., every hour).
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  const maxAge = 3600 * 1000; // 1 hour
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > maxAge) {
      rateLimitStore.delete(key);
    }
  }
}
