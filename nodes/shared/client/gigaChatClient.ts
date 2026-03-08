/**
 * High-level GigaChat client factory.
 *
 * Each call to `createGigaChatClient()` returns a new client object bound to a
 * specific set of credentials. Tokens are stored in the module-level tokenStore
 * (keyed by credential key) so they are reused across multiple requests that share
 * the same credentials.
 *
 * Token refresh strategy:
 *  1. Before every API call, check the token store.
 *  2. On a 401 / GigaChatAuthError, invalidate the cached token and retry once
 *     with a freshly obtained token.
 */

import { tokenStore } from './tokenStore';
import { httpClient, isTokenExpiredError } from './gigaChatHttpClient';
import {
  GigaChatCredentials,
  ChatRequest,
  ChatResponse,
  ModelsResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  CountTokensRequest,
  CountTokensResponse,
} from './types';

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export interface GigaChatClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  getModels(): Promise<ModelsResponse>;
  embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse>;
  countTokens(request: CountTokensRequest): Promise<CountTokensResponse>;
}

/**
 * Creates a GigaChat API client bound to the supplied credentials.
 *
 * @param credentials - OAuth and API base URLs plus the authorization key and scope.
 * @returns An object with typed methods for every supported API operation.
 */
export function createGigaChatClient(credentials: GigaChatCredentials): GigaChatClient {
  const credentialKey = `${credentials.authorizationKey}:${credentials.scope}`;

  // -------------------------------------------------------------------------
  // Token management
  // -------------------------------------------------------------------------

  async function getAccessToken(): Promise<string> {
    const cached = tokenStore.get(credentialKey);
    if (cached) return cached;

    const tokenResponse = await httpClient.fetchAccessToken(
      credentials.authUrl,
      credentials.authorizationKey,
      credentials.scope,
    );

    // GigaChat returns `expires_at` as a Unix timestamp in seconds.
    // We store it as a TTL from now so TokenStore can apply its 60-second buffer.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresInSeconds = Math.max(tokenResponse.expires_at - nowSeconds, 60);

    tokenStore.set(credentialKey, tokenResponse.access_token, expiresInSeconds);
    return tokenResponse.access_token;
  }

  // -------------------------------------------------------------------------
  // Generic retry-on-401 wrapper
  // -------------------------------------------------------------------------

  async function withTokenRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await getAccessToken();
    try {
      return await fn(token);
    } catch (err) {
      if (isTokenExpiredError(err)) {
        tokenStore.invalidate(credentialKey);
        const freshToken = await getAccessToken();
        return await fn(freshToken);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // API methods
  // -------------------------------------------------------------------------

  async function chat(request: ChatRequest): Promise<ChatResponse> {
    return withTokenRetry((token) => httpClient.chat(credentials.apiUrl, request, token));
  }

  async function getModels(): Promise<ModelsResponse> {
    return withTokenRetry((token) => httpClient.getModels(credentials.apiUrl, token));
  }

  async function embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResponse> {
    return withTokenRetry((token) => httpClient.embeddings(credentials.apiUrl, request, token));
  }

  async function countTokens(request: CountTokensRequest): Promise<CountTokensResponse> {
    return withTokenRetry((token) => httpClient.countTokens(credentials.apiUrl, request, token));
  }

  return { chat, getModels, embeddings, countTokens };
}
