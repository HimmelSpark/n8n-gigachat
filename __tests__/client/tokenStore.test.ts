/**
 * Unit tests for tokenStore.ts
 *
 * Tests cover:
 *  - get() returns null when empty
 *  - set() + get() returns the stored token
 *  - get() returns null after expiry
 *  - invalidate() removes the token
 *  - Expiry buffer is applied (60 s subtracted)
 */

import { TokenStore } from '../../nodes/shared/client/tokenStore';

describe('TokenStore', () => {
  let store: TokenStore;

  beforeEach(() => {
    store = new TokenStore();
  });

  it('returns null for an unknown key', () => {
    expect(store.get('missing')).toBeNull();
  });

  it('stores and retrieves a valid token', () => {
    store.set('key1', 'token-abc', 3600);
    expect(store.get('key1')).toBe('token-abc');
  });

  it('returns null for an expired token', () => {
    // Set with 1 second TTL — but buffer is 60 s, so 1 - 60 = -59 s → instantly expired
    store.set('key1', 'expired-token', 1);
    expect(store.get('key1')).toBeNull();
  });

  it('removes expired entry from internal map on get()', () => {
    store.set('key1', 'expired-token', 1);
    store.get('key1'); // should remove it
    expect(store.size).toBe(0);
  });

  it('invalidate() removes a cached token', () => {
    store.set('key1', 'token-abc', 3600);
    store.invalidate('key1');
    expect(store.get('key1')).toBeNull();
  });

  it('invalidate() is a no-op for unknown keys', () => {
    expect(() => store.invalidate('nonexistent')).not.toThrow();
  });

  it('correctly applies 60-second expiry buffer', () => {
    const nowMs = Date.now();
    const expiresInSeconds = 120; // 2 minutes

    store.set('key1', 'token-abc', expiresInSeconds);

    // Manually inspect by checking that the token is still valid now
    expect(store.get('key1')).toBe('token-abc');

    // Fast-forward time by mocking Date.now to be (now + 61 seconds)
    const realNow = Date.now;
    Date.now = () => nowMs + 61_000; // 61 seconds later
    // expiresAt = nowMs + (120 - 60) * 1000 = nowMs + 60_000
    // Date.now() = nowMs + 61_000 >= expiresAt → expired
    expect(store.get('key1')).toBeNull();

    Date.now = realNow;
  });

  it('does not expire a token with a large TTL', () => {
    const nowMs = Date.now();
    store.set('key1', 'long-token', 7200); // 2 hours

    const realNow = Date.now;
    Date.now = () => nowMs + 3_000_000; // 50 minutes later (well within 7200 - 60 = 7140 s)
    expect(store.get('key1')).toBe('long-token');
    Date.now = realNow;
  });

  it('tracks size correctly', () => {
    expect(store.size).toBe(0);
    store.set('a', 'tok-a', 3600);
    store.set('b', 'tok-b', 3600);
    expect(store.size).toBe(2);
    store.invalidate('a');
    expect(store.size).toBe(1);
  });

  it('different credential keys are stored independently', () => {
    store.set('cred1:scope1', 'token-1', 3600);
    store.set('cred2:scope2', 'token-2', 3600);
    expect(store.get('cred1:scope1')).toBe('token-1');
    expect(store.get('cred2:scope2')).toBe('token-2');
    store.invalidate('cred1:scope1');
    expect(store.get('cred1:scope1')).toBeNull();
    expect(store.get('cred2:scope2')).toBe('token-2');
  });
});
