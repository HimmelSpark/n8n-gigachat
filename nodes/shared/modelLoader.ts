/**
 * Shared model-list loader for n8n `loadOptions` methods.
 *
 * Each node type (Chat, LM, Embeddings) calls the appropriate exported function
 * so the n8n dropdown is populated dynamically from the GigaChat /models endpoint.
 */

import { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { createGigaChatClient } from './client/gigaChatClient';
import { GigaChatCredentials } from './client/types';

// ---------------------------------------------------------------------------
// Internal credential builder
// ---------------------------------------------------------------------------

interface RawCredentials {
  authorizationKey: string;
  scope?: string;
  base_url?: string;
  base_back_url?: string;
}

function buildCredentials(raw: RawCredentials): GigaChatCredentials {
  const scope = (raw.scope as GigaChatCredentials['scope']) ?? 'GIGACHAT_API_PERS';
  const authBase = raw.base_url ?? 'https://ngw.devices.sberbank.ru:9443';
  const apiUrl = raw.base_back_url ?? 'https://gigachat.devices.sberbank.ru/api/v1';

  return {
    authorizationKey: raw.authorizationKey,
    scope,
    authUrl: `${authBase}/api/v2/oauth`,
    apiUrl,
  };
}

// ---------------------------------------------------------------------------
// Chat models (type === 'chat')
// ---------------------------------------------------------------------------

export async function loadChatModels(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
  const client = createGigaChatClient(buildCredentials(raw));
  const modelsResponse = await client.getModels();

  return modelsResponse.data
    .filter((m) => m.type === 'chat' || !m.type)
    .map((m) => ({ name: m.id, value: m.id }));
}

// ---------------------------------------------------------------------------
// Embedding models (type === 'embedder')
// ---------------------------------------------------------------------------

export async function loadEmbeddingModels(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
  const client = createGigaChatClient(buildCredentials(raw));
  const modelsResponse = await client.getModels();

  return modelsResponse.data
    .filter((m) => m.type === 'embedder')
    .map((m) => ({ name: m.id, value: m.id }));
}

// ---------------------------------------------------------------------------
// All models (no type filter) — used by generic dropdowns
// ---------------------------------------------------------------------------

export async function loadAllModels(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
  const client = createGigaChatClient(buildCredentials(raw));
  const modelsResponse = await client.getModels();

  return modelsResponse.data.map((m) => ({ name: m.id, value: m.id }));
}

// Re-export buildCredentials so nodes can use it without duplicating logic.
export { buildCredentials };
export type { RawCredentials };
