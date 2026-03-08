/**
 * Additional tests for LmGigaChat.node.ts — ToolMessage/AIMessage conversion
 * and options forwarding branches.
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
import { AIMessage, ToolMessage, HumanMessage } from '@langchain/core/messages';

const mockCreate = createGigaChatClient as jest.Mock;

function makeMockChat(content = 'ok') {
  return jest.fn().mockResolvedValue({
    id: 'x',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function makeSupplyCtx(params: Record<string, unknown> = {}) {
  return {
    getCredentials: jest.fn().mockResolvedValue({
      authorizationKey: 'key',
      scope: 'GIGACHAT_API_PERS',
      base_url: 'https://ngw.example.com:9443',
      base_back_url: 'https://api.example.com',
    }),
    getNodeParameter: jest.fn((name: string, _i: number, def?: unknown) => {
      const p: Record<string, unknown> = { model: 'GigaChat', options: {}, ...params };
      return name in p ? p[name] : def;
    }),
  };
}

describe('LmGigaChat — baseMessageToGigaChat extra branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('converts ToolMessage to function role', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    const toolMsg = new ToolMessage({ content: 'tool output', tool_call_id: 'my_tool' });
    await model._generate([new HumanMessage('start'), toolMsg], {});

    const req = mockChat.mock.calls[0][0];
    const funcMsg = req.messages.find((m: { role: string }) => m.role === 'function');
    expect(funcMsg).toBeDefined();
    expect(funcMsg.name).toBe('my_tool');
    expect(funcMsg.content).toBe('tool output');
  });

  it('converts AIMessage with tool_calls to function_call format', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    const aiMsg = new AIMessage({
      content: '',
      additional_kwargs: {
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"n8n"}' } }],
      },
    });
    await model._generate([aiMsg], {});

    const req = mockChat.mock.calls[0][0];
    const funcMsg = req.messages.find(
      (m: { role: string; function_call?: { name: string } }) => m.function_call?.name === 'search',
    );
    expect(funcMsg).toBeDefined();
    expect(funcMsg.function_call.arguments).toEqual({ q: 'n8n' });
  });

  it('handles AIMessage tool_calls with invalid JSON in arguments', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    const aiMsg = new AIMessage({
      content: '',
      additional_kwargs: {
        tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'calc', arguments: 'BAD_JSON' } }],
      },
    });
    await model._generate([aiMsg], {});

    const req = mockChat.mock.calls[0][0];
    const funcMsg = req.messages.find(
      (m: { role: string; function_call?: { name: string } }) => m.function_call?.name === 'calc',
    );
    expect(funcMsg.function_call.arguments).toEqual({ raw: 'BAD_JSON' });
  });

  it('falls back to user role for generic AIMessage with no tool_calls and no content', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx();
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    // AIMessage with empty content and no tool_calls → fallback to assistant role with empty string
    const aiMsg = new AIMessage({ content: '' });
    await model._generate([new HumanMessage('hi'), aiMsg], {});

    const req = mockChat.mock.calls[0][0];
    const assistantMsg = req.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBe('');
  });

  it('forwards repetitionPenalty option', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx({ options: { repetitionPenalty: 1.2 } });
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new HumanMessage('test')], {});

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ repetition_penalty: 1.2 }),
    );
  });

  it('forwards maxTokens option', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx({ options: { maxTokens: 512 } });
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new HumanMessage('test')], {});

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 512 }),
    );
  });

  it('forwards topP option', async () => {
    const mockChat = makeMockChat();
    mockCreate.mockReturnValue({ chat: mockChat });

    const node = new LmGigaChat();
    const ctx = makeSupplyCtx({ options: { topP: 0.8 } });
    const { response } = await node.supplyData.call(ctx as never, 0);
    const model = response as { _generate: Function };

    await model._generate([new HumanMessage('test')], {});

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({ top_p: 0.8 }),
    );
  });
});
