/**
 * Per-credential token cache with automatic expiry.
 *
 * Design notes:
 * - One module-level singleton instance is exported so the cache is shared
 *   across all call sites within a single n8n worker process.
 * - The cache key is derived from the credential's authorization key and scope,
 *   so different credentials never share a token entry.
 * - A 60-second buffer is subtracted from the server-reported expiry so tokens
 *   are refreshed before they actually expire.
 */

interface TokenEntry {
  accessToken: string;
  /** Unix timestamp (ms) after which the token is considered expired */
  expiresAt: number;
}

export class TokenStore {
  private readonly store = new Map<string, TokenEntry>();

  /**
   * Returns a valid cached access token, or `null` if none exists or it has expired.
   */
  get(credentialKey: string): string | null {
    const entry = this.store.get(credentialKey);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(credentialKey);
      return null;
    }

    return entry.accessToken;
  }

  /**
   * Stores an access token.
   *
   * @param credentialKey - Unique key identifying the credential set.
   * @param accessToken   - The bearer token to cache.
   * @param expiresInSeconds - The server-reported TTL in seconds.
   *                           A 60-second buffer is applied automatically.
   */
  set(credentialKey: string, accessToken: string, expiresInSeconds: number): void {
    this.store.set(credentialKey, {
      accessToken,
      expiresAt: Date.now() + (expiresInSeconds - 60) * 1000,
    });
  }

  /**
   * Removes a cached token so the next request forces a fresh auth round-trip.
   */
  invalidate(credentialKey: string): void {
    this.store.delete(credentialKey);
  }

  /** Returns the number of entries currently held (useful for testing). */
  get size(): number {
    return this.store.size;
  }
}

/** Module-level singleton — shared across all calls within a worker process. */
export const tokenStore = new TokenStore();
