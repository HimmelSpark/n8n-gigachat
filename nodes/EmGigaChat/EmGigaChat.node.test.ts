/**
 * Unit tests for EmGigaChat.node.ts
 *
 * Tests cover:
 *  - supplyData() returns a LangChain Embeddings-compatible object
 *  - embedDocuments() calls gigaClient.embeddings with correct input
 *  - embedQuery() returns a flat number[] for a single string
 *  - Results are sorted by index
 */

jest.mock('../shared/client/gigaChatClient', () => ({
  createGigaChatClient: jest.fn(),
}));

jest.mock('../shared/modelLoader', () => ({
  loadEmbeddingModels: jest.fn(),
  buildCredentials: jest.fn((raw: unknown) => raw),
}));

jest.mock('../shared/certs/index', () => ({ certBuffer: undefined }));

import { EmGigaChat } from './EmGigaChat.node';
import { createGigaChatClient } from '../shared/client/gigaChatClient';

const mockCreate = createGigaChatClient as jest.Mock;

function makeEmbeddingsResponse(texts: string[]) {
  return {
    object: 'list',
    data: texts.map((_, i) => ({
      object: 'embedding',
      embedding: [0.1 * (i + 1), 0.2 * (i + 1)],
      index: i,
    })),
    model: 'Embeddings',
    usage: { prompt_tokens: texts.length * 3, total_tokens: texts.length * 3 },
  };
}

function makeSupplyCtx(model = 'Embeddings') {
  return {
    getCredentials: jest.fn().mockResolvedValue({
      authorizationKey: 'key',
      scope: 'GIGACHAT_API_PERS',
      base_url: 'https://ngw.example.com:9443',
      base_back_url: 'https://gigachat.example.com/api/v1',
    }),
    getNodeParameter: jest.fn(() => model),
  };
}

describe('EmGigaChat node — supplyData()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a response object with embedDocuments and embedQuery methods', async () => {
    const mockEmbeddings = jest.fn().mockResolvedValue(makeEmbeddingsResponse(['hello']));
    mockCreate.mockReturnValue({ embeddings: mockEmbeddings });

    const node = new EmGigaChat();
    const ctx = makeSupplyCtx();

    const result = await node.supplyData.call(ctx as never, 0);

    expect(result).toHaveProperty('response');
    const em = result.response as Record<string, unknown>;
    expect(typeof em.embedDocuments).toBe('function');
    expect(typeof em.embedQuery).toBe('function');
  });

  it('embedDocuments() calls gigaClient.embeddings with all texts', async () => {
    const mockEmbeddings = jest.fn().mockResolvedValue(makeEmbeddingsResponse(['a', 'b', 'c']));
    mockCreate.mockReturnValue({ embeddings: mockEmbeddings });

    const node = new EmGigaChat();
    const ctx = makeSupplyCtx('Embeddings');

    const { response } = await node.supplyData.call(ctx as never, 0);
    const em = response as { embedDocuments: (texts: string[]) => Promise<number[][]> };

    await em.embedDocuments(['a', 'b', 'c']);

    expect(mockEmbeddings).toHaveBeenCalledWith({
      model: 'Embeddings',
      input: ['a', 'b', 'c'],
    });
  });

  it('embedDocuments() returns vectors in input order regardless of API index order', async () => {
    // Simulate API returning results out-of-order
    const outOfOrderResponse = {
      object: 'list',
      data: [
        { object: 'embedding', embedding: [0.3, 0.6], index: 2 },
        { object: 'embedding', embedding: [0.1, 0.2], index: 0 },
        { object: 'embedding', embedding: [0.2, 0.4], index: 1 },
      ],
      model: 'Embeddings',
      usage: { prompt_tokens: 9, total_tokens: 9 },
    };
    const mockEmbeddings = jest.fn().mockResolvedValue(outOfOrderResponse);
    mockCreate.mockReturnValue({ embeddings: mockEmbeddings });

    const node = new EmGigaChat();
    const ctx = makeSupplyCtx();

    const { response } = await node.supplyData.call(ctx as never, 0);
    const em = response as { embedDocuments: (texts: string[]) => Promise<number[][]> };

    const vectors = await em.embedDocuments(['x', 'y', 'z']);

    // Should be sorted by index: 0, 1, 2
    expect(vectors[0]).toEqual([0.1, 0.2]);
    expect(vectors[1]).toEqual([0.2, 0.4]);
    expect(vectors[2]).toEqual([0.3, 0.6]);
  });

  it('embedQuery() returns a flat number[] for a single text', async () => {
    const mockEmbeddings = jest.fn().mockResolvedValue(makeEmbeddingsResponse(['query text']));
    mockCreate.mockReturnValue({ embeddings: mockEmbeddings });

    const node = new EmGigaChat();
    const ctx = makeSupplyCtx();

    const { response } = await node.supplyData.call(ctx as never, 0);
    const em = response as { embedQuery: (text: string) => Promise<number[]> };

    const vector = await em.embedQuery('query text');

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(2);
    expect(vector[0]).toBeCloseTo(0.1);
  });

  it('uses the model name from node parameters', async () => {
    const mockEmbeddings = jest.fn().mockResolvedValue(makeEmbeddingsResponse(['test']));
    mockCreate.mockReturnValue({ embeddings: mockEmbeddings });

    const node = new EmGigaChat();
    const ctx = makeSupplyCtx('Embeddings-gigachat');

    const { response } = await node.supplyData.call(ctx as never, 0);
    const em = response as { embedDocuments: (texts: string[]) => Promise<number[][]> };

    await em.embedDocuments(['test']);

    expect(mockEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'Embeddings-gigachat' }),
    );
  });
});
