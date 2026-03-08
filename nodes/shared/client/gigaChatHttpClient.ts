/**
 * Low-level Axios-based HTTP client for the GigaChat API.
 *
 * Responsibilities:
 *  - Build an https.Agent that uses the bundled Russian MinTsifry CA cert
 *    (falls back to system CAs if the cert file is unavailable).
 *  - Wrap all HTTP calls with typed error mapping (GigaChatApiError /
 *    GigaChatRateLimitError / GigaChatAuthError).
 *  - Never perform token management — that is the responsibility of gigaChatClient.ts.
 */

import * as https from 'https';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { certBuffer } from '../certs/index';
import {
  GigaChatApiError,
  GigaChatAuthError,
  GigaChatRateLimitError,
  TokenResponse,
  ChatRequest,
  ChatResponse,
  ModelsResponse,
  EmbeddingsRequest,
  EmbeddingsResponse,
  CountTokensRequest,
  CountTokensResponse,
} from './types';

// ---------------------------------------------------------------------------
// Build the shared HTTPS agent once per process
// ---------------------------------------------------------------------------

function buildHttpsAgent(): https.Agent {
  if (certBuffer) {
    return new https.Agent({ ca: certBuffer, rejectUnauthorized: true });
  }
  // certBuffer is undefined — cert file missing or is placeholder.
  // Fall back to system CAs but keep rejectUnauthorized: true.
  return new https.Agent({ rejectUnauthorized: true });
}

const httpsAgent = buildHttpsAgent();

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

function mapAxiosError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ message?: string; error?: string }>;
    const status = axErr.response?.status ?? 0;
    const data = axErr.response?.data;
    const msg =
      data?.message ?? data?.error ?? axErr.message ?? 'Unknown GigaChat API error';

    if (status === 401) throw new GigaChatAuthError(msg);
    if (status === 429) throw new GigaChatRateLimitError(msg);
    if (status >= 400) throw new GigaChatApiError(status, msg);
  }
  throw err;
}

/** Returns true when the error signals that the bearer token has expired. */
export function isTokenExpiredError(err: unknown): boolean {
  return err instanceof GigaChatAuthError;
}

// ---------------------------------------------------------------------------
// Factory — creates a configured Axios instance per base URL
// ---------------------------------------------------------------------------

export function createAxiosInstance(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    httpsAgent,
    timeout: 60_000,
    headers: { 'User-Agent': 'n8n-nodes-gigachat/2.0.0' },
  });
}

// ---------------------------------------------------------------------------
// Auth client — used only for token exchange
// ---------------------------------------------------------------------------

export async function fetchAccessToken(
  authUrl: string,
  authorizationKey: string,
  scope: string,
): Promise<TokenResponse> {
  const client = createAxiosInstance(authUrl);

  const rqUID = uuidv4();

  let response;
  try {
    response = await client.post<TokenResponse>(
      '',
      new URLSearchParams({ scope }).toString(),
      {
        headers: {
          Authorization: `Basic ${authorizationKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: rqUID,
        },
        validateStatus: (s) => s < 500,
      },
    );
  } catch (err) {
    mapAxiosError(err);
  }

  if (!response || response.status !== 200) {
    const status = response?.status ?? 0;
    const data = response?.data as unknown as Record<string, unknown> | undefined;
    const msg =
      (data?.error_description as string) ??
      (data?.error as string) ??
      (data?.message as string) ??
      `Auth request failed with status ${status}`;
    throw new GigaChatAuthError(msg);
  }

  return response.data;
}

// ---------------------------------------------------------------------------
// API helpers — all require a pre-obtained bearer token
// ---------------------------------------------------------------------------

export async function apiPost<TBody, TResponse>(
  apiUrl: string,
  path: string,
  body: TBody,
  token: string,
): Promise<TResponse> {
  const client = createAxiosInstance(apiUrl);

  let response;
  try {
    response = await client.post<TResponse>(path, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-ID': uuidv4(),
      },
      validateStatus: (s) => s < 600,
    });
  } catch (err) {
    mapAxiosError(err);
  }

  if (!response) throw new GigaChatApiError(0, 'No response received');

  if (response.status === 401) {
    const data = response.data as Record<string, unknown>;
    const msg = (data?.message as string) ?? 'Unauthorized';
    throw new GigaChatAuthError(msg);
  }

  if (response.status === 429) {
    const data = response.data as Record<string, unknown>;
    const msg = (data?.message as string) ?? 'Rate limit exceeded';
    throw new GigaChatRateLimitError(msg);
  }

  if (response.status >= 400) {
    const data = response.data as Record<string, unknown>;
    const msg =
      (data?.message as string) ??
      (data?.error as string) ??
      `API error ${response.status}`;
    throw new GigaChatApiError(response.status, msg);
  }

  return response.data;
}

export async function apiGet<TResponse>(
  apiUrl: string,
  path: string,
  token: string,
): Promise<TResponse> {
  const client = createAxiosInstance(apiUrl);

  let response;
  try {
    response = await client.get<TResponse>(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      validateStatus: (s) => s < 600,
    });
  } catch (err) {
    mapAxiosError(err);
  }

  if (!response) throw new GigaChatApiError(0, 'No response received');

  if (response.status === 401) {
    const data = response.data as Record<string, unknown>;
    throw new GigaChatAuthError((data?.message as string) ?? 'Unauthorized');
  }

  if (response.status === 429) {
    const data = response.data as Record<string, unknown>;
    throw new GigaChatRateLimitError((data?.message as string) ?? 'Rate limit exceeded');
  }

  if (response.status >= 400) {
    const data = response.data as Record<string, unknown>;
    const msg =
      (data?.message as string) ??
      (data?.error as string) ??
      `API error ${response.status}`;
    throw new GigaChatApiError(response.status, msg);
  }

  return response.data;
}

// Convenience typed wrappers used by gigaChatClient.ts
export const httpClient = {
  fetchAccessToken,
  chat: (apiUrl: string, req: ChatRequest, token: string) =>
    apiPost<ChatRequest, ChatResponse>(apiUrl, '/chat/completions', req, token),
  getModels: (apiUrl: string, token: string) =>
    apiGet<ModelsResponse>(apiUrl, '/models', token),
  embeddings: (apiUrl: string, req: EmbeddingsRequest, token: string) =>
    apiPost<EmbeddingsRequest, EmbeddingsResponse>(apiUrl, '/embeddings', req, token),
  countTokens: (apiUrl: string, req: CountTokensRequest, token: string) =>
    apiPost<CountTokensRequest, CountTokensResponse>(apiUrl, '/tokens/count', req, token),
};
