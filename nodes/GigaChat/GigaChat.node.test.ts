/**
 * Unit tests for GigaChat.node.ts (the main chat node).
 *
 * Tests cover:
 *  - execute() happy path: single item, no memory, no tools
 *  - execute() simplified output
 *  - execute() with memory (BaseMessage[] history)
 *  - execute() with a connected tool (function-calling loop)
 *  - execute() error propagation
 */

jest.mock('../shared/client/gigaChatClient', () => ({
  createGigaChatClient: jest.fn(),
}));

jest.mock('../shared/modelLoader', () => ({
  loadChatModels: jest.fn(),
  buildCredentials: jest.fn((raw: unknown) => raw),
}));

// Silence the cert loader warning
jest.mock('../shared/certs/index', () => ({ certBuffer: undefined }));

import { GigaChat } from './GigaChat.node';
import { createGigaChatClient } from '../shared/client/gigaChatClient';

const mockCreate = createGigaChatClient as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers to build mock IExecuteFunctions
// ---------------------------------------------------------------------------

const defaultChatResponse = {
  id: 'resp-1',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello there!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
};

function makeExecuteFunctions(overrides: {
  params?: Record<string, unknown>;
  credOverrides?: Record<string, unknown>;
  memory?: object | null;
  tools?: unknown[] | null;
  chatResponse?: unknown;
  items?: unknown[];
} = {}) {
  const params: Record<string, unknown> = {
    modelId: 'GigaChat',
    prompt: 'Test prompt',
    options: {},
    simplifyOutput: false,
    ...overrides.params,
  };

  const credentials = {
    authorizationKey: 'dGVzdDp0ZXN0',
    scope: 'GIGACHAT_API_PERS',
    base_url: 'https://ngw.example.com:9443',
    base_back_url: 'https://gigachat.example.com/api/v1',
    ...(overrides.credOverrides ?? {}),
  };

  const mockChat = jest.fn().mockResolvedValue(overrides.chatResponse ?? defaultChatResponse);

  mockCreate.mockReturnValue({
    chat: mockChat,
    getModels: jest.fn(),
    embeddings: jest.fn(),
    countTokens: jest.fn(),
  });

  const items = overrides.items ?? [{ json: {} }];

  return {
    ctx: {
      getCredentials: jest.fn().mockResolvedValue(credentials),
      getInputData: jest.fn().mockReturnValue(items),
      getNodeParameter: jest.fn((name: string, _index: number, defaultVal?: unknown) => {
        return name in params ? params[name] : defaultVal;
      }),
      getInputConnectionData: jest.fn().mockImplementation((type: string) => {
        if (type === 'ai_memory') return Promise.resolve(overrides.memory ?? null);
        if (type === 'ai_tool') return Promise.resolve(overrides.tools ?? null);
        return Promise.resolve(null);
      }),
      helpers: {
        returnJsonArray: jest.fn((data: unknown) => [{ json: data }]),
        constructExecutionMetaData: jest.fn((arr: unknown[], _meta: unknown) => arr),
      },
    },
    mockChat,
  };
}

describe('GigaChat node — execute()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('happy path — single item, returns assistant content', async () => {
    const { ctx } = makeExecuteFunctions();
    const node = new GigaChat();

    const result = await node.execute.call(ctx as never);

    expect(result).toHaveLength(1); // one output connection
    expect(result[0]).toHaveLength(1); // one item

    // returnJsonArray was called with the output data
    expect(ctx.helpers.returnJsonArray).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'Hello there!' }),
    );
  });

  it('simplified output returns only response string', async () => {
    const { ctx } = makeExecuteFunctions({ params: { simplifyOutput: true } });
    const node = new GigaChat();

    await node.execute.call(ctx as never);

    expect(ctx.helpers.returnJsonArray).toHaveBeenCalledWith({ response: 'Hello there!' });
  });

  it('full output includes model, usage, and iterations', async () => {
    const { ctx } = makeExecuteFunctions({ params: { simplifyOutput: false } });
    const node = new GigaChat();

    await node.execute.call(ctx as never);

    expect(ctx.helpers.returnJsonArray).toHaveBeenCalledWith(
      expect.objectContaining({
        response: 'Hello there!',
        model: 'GigaChat',
        usage: expect.objectContaining({ total_tokens: 15 }),
        iterations: 0,
      }),
    );
  });

  it('loads memory and prepends history messages', async () => {
    const langchainMessages = jest.requireActual('@langchain/core/messages') as typeof import('@langchain/core/messages');
    const history = [new langchainMessages.HumanMessage('hi'), new langchainMessages.AIMessage('hello')];

    const memory = {
      loadMemoryVariables: jest.fn().mockResolvedValue({ chat_history: history }),
      saveContext: jest.fn().mockResolvedValue(undefined),
    };

    const { ctx, mockChat } = makeExecuteFunctions({ memory });
    const node = new GigaChat();

    await node.execute.call(ctx as never);

    // The chat call should have included the history messages
    const callArgs = mockChat.mock.calls[0][0];
    const messages = callArgs.messages;
    expect(messages.find((m: { role: string; content?: string }) => m.role === 'user' && m.content === 'hi')).toBeTruthy();
    expect(messages.find((m: { role: string; content?: string }) => m.role === 'assistant' && m.content === 'hello')).toBeTruthy();
  });

  it('saves to memory after response', async () => {
    const memory = {
      loadMemoryVariables: jest.fn().mockResolvedValue({ chat_history: [] }),
      saveContext: jest.fn().mockResolvedValue(undefined),
    };

    const { ctx } = makeExecuteFunctions({ memory });
    const node = new GigaChat();

    await node.execute.call(ctx as never);

    expect(memory.saveContext).toHaveBeenCalledWith(
      { input: 'Test prompt' },
      { output: 'Hello there!' },
    );
  });

  it('handles function-calling loop with a tool', async () => {
    const toolCallResponse = {
      id: 'r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            function_call: { name: 'search', arguments: { query: 'n8n' } },
          },
          finish_reason: 'function_call',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const finalResponse = {
      id: 'r2',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Here is the result.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    };

    const mockTool = {
      name: 'search',
      description: 'Search the web',
      execute: jest.fn().mockResolvedValue(JSON.stringify({ result: 'n8n is an automation tool' })),
    };

    const { ctx, mockChat } = makeExecuteFunctions({
      tools: [mockTool],
      chatResponse: undefined,
    });

    mockChat
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(finalResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockTool.execute).toHaveBeenCalledTimes(1);

    expect(ctx.helpers.returnJsonArray).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'Here is the result.' }),
    );
  });

  it('handles unknown tool gracefully', async () => {
    const toolCallResponse = {
      id: 'r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            function_call: { name: 'nonexistent_tool', arguments: {} },
          },
          finish_reason: 'function_call',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    };

    const finalResponse = {
      id: 'r2',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Could not find tool.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const { ctx, mockChat } = makeExecuteFunctions({ tools: [], chatResponse: undefined });

    mockChat
      .mockResolvedValueOnce(toolCallResponse)
      .mockResolvedValueOnce(finalResponse);

    const node = new GigaChat();

    // Should not throw
    await expect(node.execute.call(ctx as never)).resolves.not.toBeNull();
  });

  it('propagates API errors', async () => {
    const { ctx, mockChat } = makeExecuteFunctions();
    mockChat.mockRejectedValue(new Error('API error'));

    const node = new GigaChat();

    await expect(node.execute.call(ctx as never)).rejects.toThrow('API error');
  });

  it('processes multiple items', async () => {
    const { ctx } = makeExecuteFunctions({
      items: [{ json: {} }, { json: {} }],
    });
    const node = new GigaChat();

    await node.execute.call(ctx as never);

    // constructExecutionMetaData is called once per item
    expect(ctx.helpers.constructExecutionMetaData).toHaveBeenCalledTimes(2);
  });
});
