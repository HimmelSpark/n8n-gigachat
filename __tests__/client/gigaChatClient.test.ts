/**
 * Unit tests for gigaChatClient.ts (the factory function / high-level client).
 *
 * Tests cover:
 *  - chat(): successful call, token refresh on 401
 *  - getModels(): successful call
 *  - embeddings(): successful call
 *  - countTokens(): successful call
 *  - Token is fetched once and reused across multiple calls
 *  - On GigaChatAuthError, token is invalidated and a fresh one is fetched
 */

// Mock the HTTP client so no real network calls are made
jest.mock('../../nodes/shared/client/gigaChatHttpClient', () => ({
  httpClient: {
    fetchAccessToken: jest.fn(),
    chat: jest.fn(),
    getModels: jest.fn(),
    embeddings: jest.fn(),
    countTokens: jest.fn(),
  },
  isTokenExpiredError: (err: unknown) =>
    err instanceof (require('../../nodes/shared/client/types').GigaChatAuthError),
}));

import { createGigaChatClient } from '../../nodes/shared/client/gigaChatClient';
import { tokenStore } from '../../nodes/shared/client/tokenStore';
import { httpClient } from '../../nodes/shared/client/gigaChatHttpClient';
import { GigaChatAuthError, GigaChatCredentials } from '../../nodes/shared/client/types';

const mockFetch = httpClient.fetchAccessToken as jest.Mock;
const mockChat = httpClient.chat as jest.Mock;
const mockGetModels = httpClient.getModels as jest.Mock;
const mockEmbeddings = httpClient.embeddings as jest.Mock;
const mockCountTokens = httpClient.countTokens as jest.Mock;

const NOW_SECONDS = Math.floor(Date.now() / 1000);

const testCreds: GigaChatCredentials = {
  authorizationKey: 'dGVzdDp0ZXN0', // base64("test:test")
  scope: 'GIGACHAT_API_PERS',
  authUrl: 'https://ngw.example.com/api/v2/oauth',
  apiUrl: 'https://gigachat.example.com/api/v1',
};

const credKey = `${testCreds.authorizationKey}:${testCreds.scope}`;

function setupFreshToken(token = 'fresh-token', expiresInFromNow = 1800) {
  mockFetch.mockResolvedValue({
    access_token: token,
    expires_at: NOW_SECONDS + expiresInFromNow,
  });
}

describe('createGigaChatClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tokenStore.invalidate(credKey);
  });

  describe('chat()', () => {
    it('fetches a token and calls httpClient.chat', async () => {
      setupFreshToken();
      const chatResponse = {
        id: 'r1',
        choices: [{ message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop', index: 0 }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };
      mockChat.mockResolvedValue(chatResponse);

      const client = createGigaChatClient(testCreds);
      const result = await client.chat({ model: 'GigaChat', messages: [], stream: false });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenCalledWith(
        testCreds.apiUrl,
        { model: 'GigaChat', messages: [], stream: false },
        'fresh-token',
      );
      expect(result).toEqual(chatResponse);
    });

    it('reuses cached token on second call', async () => {
      setupFreshToken();
      mockChat.mockResolvedValue({ choices: [], usage: {} });

      const client = createGigaChatClient(testCreds);
      await client.chat({ model: 'GigaChat', messages: [], stream: false });
      await client.chat({ model: 'GigaChat', messages: [], stream: false });

      expect(mockFetch).toHaveBeenCalledTimes(1); // token fetched only once
      expect(mockChat).toHaveBeenCalledTimes(2);
    });

    it('invalidates token and retries on GigaChatAuthError', async () => {
      setupFreshToken('old-token');
      const authError = new GigaChatAuthError('Token has expired');

      mockChat
        .mockRejectedValueOnce(authError)
        .mockResolvedValueOnce({ choices: [], usage: {} });

      // Second fetchAccessToken call (after invalidation) returns a new token
      mockFetch
        .mockResolvedValueOnce({ access_token: 'old-token', expires_at: NOW_SECONDS + 1800 })
        .mockResolvedValueOnce({ access_token: 'new-token', expires_at: NOW_SECONDS + 1800 });

      const client = createGigaChatClient(testCreds);
      await client.chat({ model: 'GigaChat', messages: [], stream: false });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockChat).toHaveBeenCalledTimes(2);
      // Second chat call used the new token
      expect(mockChat.mock.calls[1][2]).toBe('new-token');
    });

    it('propagates non-auth errors without retry', async () => {
      setupFreshToken();
      const apiErr = new Error('Something went wrong');
      mockChat.mockRejectedValue(apiErr);

      const client = createGigaChatClient(testCreds);
      await expect(
        client.chat({ model: 'GigaChat', messages: [], stream: false }),
      ).rejects.toThrow('Something went wrong');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('getModels()', () => {
    it('fetches a token and calls httpClient.getModels', async () => {
      setupFreshToken();
      const modelsResponse = { object: 'list', data: [{ id: 'GigaChat', type: 'chat' }] };
      mockGetModels.mockResolvedValue(modelsResponse);

      const client = createGigaChatClient(testCreds);
      const result = await client.getModels();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockGetModels).toHaveBeenCalledWith(testCreds.apiUrl, 'fresh-token');
      expect(result).toEqual(modelsResponse);
    });
  });

  describe('embeddings()', () => {
    it('fetches a token and calls httpClient.embeddings', async () => {
      setupFreshToken();
      const embResponse = {
        object: 'list',
        data: [{ object: 'embedding', embedding: [0.1, 0.2], index: 0 }],
        model: 'Embeddings',
        usage: { prompt_tokens: 3, total_tokens: 3 },
      };
      mockEmbeddings.mockResolvedValue(embResponse);

      const client = createGigaChatClient(testCreds);
      const result = await client.embeddings({ model: 'Embeddings', input: ['hello'] });

      expect(mockEmbeddings).toHaveBeenCalledWith(
        testCreds.apiUrl,
        { model: 'Embeddings', input: ['hello'] },
        'fresh-token',
      );
      expect(result).toEqual(embResponse);
    });
  });

  describe('countTokens()', () => {
    it('fetches a token and calls httpClient.countTokens', async () => {
      setupFreshToken();
      const countResponse = { object: 'list', data: [{ object: 'tokens', tokens: 5 }] };
      mockCountTokens.mockResolvedValue(countResponse);

      const client = createGigaChatClient(testCreds);
      const result = await client.countTokens({ model: 'GigaChat', input: ['hello world'] });

      expect(mockCountTokens).toHaveBeenCalledWith(
        testCreds.apiUrl,
        { model: 'GigaChat', input: ['hello world'] },
        'fresh-token',
      );
      expect(result).toEqual(countResponse);
    });
  });

  describe('credential key isolation', () => {
    it('uses separate token cache entries for different scopes', async () => {
      const creds1: GigaChatCredentials = { ...testCreds, scope: 'GIGACHAT_API_PERS' };
      const creds2: GigaChatCredentials = { ...testCreds, scope: 'GIGACHAT_API_B2B' };

      mockFetch
        .mockResolvedValueOnce({ access_token: 'token-pers', expires_at: NOW_SECONDS + 1800 })
        .mockResolvedValueOnce({ access_token: 'token-b2b', expires_at: NOW_SECONDS + 1800 });

      mockChat.mockResolvedValue({ choices: [], usage: {} });

      const client1 = createGigaChatClient(creds1);
      const client2 = createGigaChatClient(creds2);

      await client1.chat({ model: 'GigaChat', messages: [], stream: false });
      await client2.chat({ model: 'GigaChat', messages: [], stream: false });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockChat.mock.calls[0][2]).toBe('token-pers');
      expect(mockChat.mock.calls[1][2]).toBe('token-b2b');
    });
  });
});
