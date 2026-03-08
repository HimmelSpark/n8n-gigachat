/**
 * Unit tests for LmGigaChat.node.ts
 *
 * Tests cover:
 *  - supplyData() returns a BaseChatModel-compatible object
 *  - The model calls gigaClient.chat() with correct parameters
 *  - Temperature and other options are forwarded
 */

jest.mock('../shared/client/gigaChatClient', () => ({
  createGigaChatClient: jest.fn(),
}));

jest.mock('../shared/modelLoader', () => ({
  loadChatModels: jest.fn(),
  buildCredentials: jest.fn((raw: unknown) => raw),
}));

jest.mock('../shared/certs/index', () => ({ certBuffer: undefined }));

import { LmGigaChat } from './LmGigaChat.node';
import { createGigaChatClient } from '../shared/client/gigaChatClient';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const mockCreate = createGigaChatClient as jest.Mock;

function makeMockChat(content = 'LM response') {
  return jest.fn().mockResolvedValue({
    id: 'lm-1',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  });
}

function makeSupplyCtx(params: Record<string, unknown> = {}) {
  return {
    getCredentials: jest.fn().mockResolvedValue({
      authorizationKey: 'key',
      scope: 'GIGACHAT_API_PERS',
      base_url: 'https://ngw.example.com:9443',
      base_back_url: 'https://gigachat.example.com/api/v1',
    }),
    getNodeParameter: jest.fn((name: string, _index: number, def?: unknown) => {
      const p: Record<string, unknown> = {
        model: 'GigaChat',
        options: {},
        ...params,
      };
      return name in p ? p[name] : def;
    }),
  };
}

describe('LmGigaChat node — supplyData()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a response object with a _generate method', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();

    const result = await node.supplyData.call(ctx as never, 0);

    expect(result).toHaveProperty('response');
    expect(typeof (result.response as { _generate: unknown })._generate).toBe('function');
  });

  it('calls gigaClient.chat with correct model name', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx({ model: 'GigaChat-Pro' });

    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new HumanMessage('hello')], {});

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'GigaChat-Pro' }),
    );
  });

  it('forwards temperature option to the request', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx({ options: { temperature: 0.3 } });

    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new HumanMessage('hi')], {});

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.3 }),
    );
  });

  it('converts SystemMessage to system role', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();

    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new SystemMessage('You are a helpful assistant'), new HumanMessage('hello')], {});

    const req = mockChat.mock.calls[0][0];
    const systemMsg = req.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toBe('You are a helpful assistant');
  });

  it('returns ChatResult with text from response', async () => {
    const mockChat = makeMockChat('The answer is 42');
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();

    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    const chatResult = await model._generate([new HumanMessage('what is the answer?')], {});

    expect(chatResult.generations[0].text).toBe('The answer is 42');
  });
});
