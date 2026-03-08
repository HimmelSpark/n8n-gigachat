/**
 * Unit tests for modelLoader.ts
 *
 * Tests cover:
 *  - loadChatModels: filters to type === 'chat', maps id→name/value
 *  - loadEmbeddingModels: filters to type === 'embedder'
 *  - loadAllModels: returns all models
 *  - buildCredentials: correctly maps raw credential fields to GigaChatCredentials
 */

jest.mock('../../nodes/shared/client/gigaChatClient', () => ({
  createGigaChatClient: jest.fn(),
}));

import { createGigaChatClient } from '../../nodes/shared/client/gigaChatClient';
import { buildCredentials } from '../../nodes/shared/modelLoader';

// We need to test the load* functions, but they use `this` (ILoadOptionsFunctions).
// We test buildCredentials directly and the loader logic by calling it with a mock `this`.
import { loadChatModels, loadEmbeddingModels, loadAllModels } from '../../nodes/shared/modelLoader';

const mockCreate = createGigaChatClient as jest.Mock;

const allModels = {
  object: 'list',
  data: [
    { id: 'GigaChat', type: 'chat', object: 'model', owned_by: 'sber' },
    { id: 'GigaChat-Pro', type: 'chat', object: 'model', owned_by: 'sber' },
    { id: 'Embeddings', type: 'embedder', object: 'model', owned_by: 'sber' },
    { id: 'Embeddings-gigachat', type: 'embedder', object: 'model', owned_by: 'sber' },
  ],
};

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    getCredentials: jest.fn().mockResolvedValue({
      authorizationKey: 'dGVzdDp0ZXN0',
      scope: 'GIGACHAT_API_PERS',
      base_url: 'https://ngw.example.com:9443',
      base_back_url: 'https://gigachat.example.com/api/v1',
      ...overrides,
    }),
  };
}

describe('buildCredentials', () => {
  it('maps raw credentials to GigaChatCredentials correctly', () => {
    const result = buildCredentials({
      authorizationKey: 'mykey',
      scope: 'GIGACHAT_API_B2B',
      base_url: 'https://auth.example.com',
      base_back_url: 'https://api.example.com/v1',
    });

    expect(result).toEqual({
      authorizationKey: 'mykey',
      scope: 'GIGACHAT_API_B2B',
      authUrl: 'https://auth.example.com/api/v2/oauth',
      apiUrl: 'https://api.example.com/v1',
    });
  });

  it('uses default URLs when base_url and base_back_url are missing', () => {
    const result = buildCredentials({ authorizationKey: 'k' });

    expect(result.authUrl).toBe('https://ngw.devices.sberbank.ru:9443/api/v2/oauth');
    expect(result.apiUrl).toBe('https://gigachat.devices.sberbank.ru/api/v1');
  });

  it('defaults scope to GIGACHAT_API_PERS when not provided', () => {
    const result = buildCredentials({ authorizationKey: 'k' });
    expect(result.scope).toBe('GIGACHAT_API_PERS');
  });
});

describe('loadChatModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReturnValue({ getModels: jest.fn().mockResolvedValue(allModels) });
  });

  it('returns only chat models', async () => {
    const ctx = makeCtx();
    const result = await loadChatModels.call(ctx as never);

    expect(result).toHaveLength(2);
    expect(result.every((m: { name: string; value: string }) => ['GigaChat', 'GigaChat-Pro'].includes(m.value))).toBe(true);
  });

  it('maps models to { name, value } pairs', async () => {
    const ctx = makeCtx();
    const result = await loadChatModels.call(ctx as never);

    for (const item of result) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('value');
      expect(item.name).toBe(item.value); // name and value are both the model id
    }
  });

  it('calls createGigaChatClient with correct credentials', async () => {
    const ctx = makeCtx();
    await loadChatModels.call(ctx as never);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationKey: 'dGVzdDp0ZXN0',
        scope: 'GIGACHAT_API_PERS',
        authUrl: 'https://ngw.example.com:9443/api/v2/oauth',
        apiUrl: 'https://gigachat.example.com/api/v1',
      }),
    );
  });
});

describe('loadEmbeddingModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReturnValue({ getModels: jest.fn().mockResolvedValue(allModels) });
  });

  it('returns only embedding models', async () => {
    const ctx = makeCtx();
    const result = await loadEmbeddingModels.call(ctx as never);

    expect(result).toHaveLength(2);
    expect(result.every((m: { name: string; value: string }) => m.value.startsWith('Embeddings'))).toBe(true);
  });
});

describe('loadAllModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockReturnValue({ getModels: jest.fn().mockResolvedValue(allModels) });
  });

  it('returns all models without filtering', async () => {
    const ctx = makeCtx();
    const result = await loadAllModels.call(ctx as never);
    expect(result).toHaveLength(4);
  });
});
