/**
 * Additional tests for GigaChat.node.ts — covering message conversion helpers,
 * tool schema building, and executeTool branches not reached by the primary test.
 */

jest.mock('../shared/client/gigaChatClient', () => ({
  createGigaChatClient: jest.fn(),
}));

jest.mock('../shared/modelLoader', () => ({
  loadChatModels: jest.fn(),
  buildCredentials: jest.fn((raw: unknown) => raw),
}));

jest.mock('../shared/certs/index', () => ({ certBuffer: undefined }));

import { GigaChat } from './GigaChat.node';
import { createGigaChatClient } from '../shared/client/gigaChatClient';
import { AIMessage, ToolMessage } from '@langchain/core/messages';

const mockCreate = createGigaChatClient as jest.Mock;

const defaultResponse = {
  id: 'r1',
  choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function makeCtx(overrides: {
  params?: Record<string, unknown>;
  memory?: object | null;
  tools?: unknown[] | null;
  chatMock?: jest.Mock;
  items?: unknown[];
} = {}) {
  const params: Record<string, unknown> = {
    modelId: 'GigaChat',
    prompt: 'hello',
    options: {},
    simplifyOutput: false,
    ...overrides.params,
  };

  const chatMock = overrides.chatMock ?? jest.fn().mockResolvedValue(defaultResponse);
  mockCreate.mockReturnValue({ chat: chatMock, getModels: jest.fn() });

  return {
    ctx: {
      getCredentials: jest.fn().mockResolvedValue({
        authorizationKey: 'key',
        scope: 'GIGACHAT_API_PERS',
        base_url: 'https://ngw.example.com:9443',
        base_back_url: 'https://api.example.com',
      }),
      getInputData: jest.fn().mockReturnValue(overrides.items ?? [{ json: {} }]),
      getNodeParameter: jest.fn((name: string, _i: number, def?: unknown) =>
        name in params ? params[name] : def,
      ),
      getInputConnectionData: jest.fn().mockImplementation((type: string) => {
        if (type === 'ai_memory') return Promise.resolve(overrides.memory ?? null);
        if (type === 'ai_tool') return Promise.resolve(overrides.tools ?? null);
        return Promise.resolve(null);
      }),
      helpers: {
        returnJsonArray: jest.fn((d: unknown) => [{ json: d }]),
        constructExecutionMetaData: jest.fn((arr: unknown[]) => arr),
      },
    },
    chatMock,
  };
}

// ---------------------------------------------------------------------------
// langchainMessagesToGigaChat — AIMessage with tool_calls
// ---------------------------------------------------------------------------

describe('GigaChat — memory with AIMessage tool_calls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('converts AIMessage with tool_calls to assistant + function_call', async () => {
    const toolCallMsg = new AIMessage({
      content: '',
      additional_kwargs: {
        tool_calls: [
          { id: 'tc1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } },
        ],
      },
    });

    const memory = {
      loadMemoryVariables: jest.fn().mockResolvedValue({ chat_history: [toolCallMsg] }),
      saveContext: jest.fn().mockResolvedValue(undefined),
    };

    const { ctx, chatMock } = makeCtx({ memory });
    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const req = chatMock.mock.calls[0][0];
    const funcMsg = req.messages.find(
      (m: { role: string; function_call?: { name: string } }) =>
        m.role === 'assistant' && m.function_call?.name === 'search',
    );
    expect(funcMsg).toBeDefined();
    expect(funcMsg.function_call.arguments).toEqual({ q: 'test' });
  });

  it('handles AIMessage tool_calls with invalid JSON in arguments', async () => {
    const badJsonMsg = new AIMessage({
      content: '',
      additional_kwargs: {
        tool_calls: [
          { id: 'tc2', type: 'function', function: { name: 'calc', arguments: 'NOT_JSON' } },
        ],
      },
    });

    const memory = {
      loadMemoryVariables: jest.fn().mockResolvedValue({ chat_history: [badJsonMsg] }),
      saveContext: jest.fn().mockResolvedValue(undefined),
    };

    const { ctx, chatMock } = makeCtx({ memory });
    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const req = chatMock.mock.calls[0][0];
    const funcMsg = req.messages.find(
      (m: { role: string; function_call?: { name: string } }) =>
        m.role === 'assistant' && m.function_call?.name === 'calc',
    );
    expect(funcMsg).toBeDefined();
    expect(funcMsg.function_call.arguments).toEqual({ raw: 'NOT_JSON' });
  });

  it('converts ToolMessage to function role', async () => {
    const toolMsg = new ToolMessage({ content: 'result text', tool_call_id: 'search' });

    const memory = {
      loadMemoryVariables: jest.fn().mockResolvedValue({ chat_history: [toolMsg] }),
      saveContext: jest.fn().mockResolvedValue(undefined),
    };

    const { ctx, chatMock } = makeCtx({ memory });
    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const req = chatMock.mock.calls[0][0];
    const funcMsg = req.messages.find(
      (m: { role: string; name?: string }) => m.role === 'function' && m.name === 'search',
    );
    expect(funcMsg).toBeDefined();
    expect(funcMsg.content).toBe('result text');
  });
});

// ---------------------------------------------------------------------------
// buildFunctionDefinitions — schema branches
// ---------------------------------------------------------------------------

describe('GigaChat — tool schema building', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses tool.schema when parameters has no properties', async () => {
    const toolWithSchema = {
      name: 'schema_tool',
      description: 'Uses schema',
      schema: { properties: { q: { type: 'string' } }, required: ['q'] },
      execute: jest.fn().mockResolvedValue('ok'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'schema_tool', arguments: { q: 'test' } } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [toolWithSchema] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    // Verify the function def used the schema
    const firstReq = chatMock.mock.calls[0][0];
    const funcDef = firstReq.functions?.find((f: { name: string }) => f.name === 'schema_tool');
    expect(funcDef).toBeDefined();
    expect(funcDef.parameters.properties).toHaveProperty('q');
  });

  it('falls back to generic input property when no schema available', async () => {
    const noSchemaTool = {
      name: 'bare_tool',
      description: 'No schema',
      execute: jest.fn().mockResolvedValue('bare result'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'bare_tool', arguments: { input: 'hi' } } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [noSchemaTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const firstReq = chatMock.mock.calls[0][0];
    const funcDef = firstReq.functions?.find((f: { name: string }) => f.name === 'bare_tool');
    expect(funcDef.parameters.properties).toHaveProperty('input');
    expect(funcDef.parameters.required).toContain('input');
  });

  it('parses string-serialized tool parameters', async () => {
    const stringParamsTool = {
      name: 'str_tool',
      description: 'String params',
      parameters: '{"properties":{"city":{"type":"string"}},"required":["city"]}',
      execute: jest.fn().mockResolvedValue('weather: sunny'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'str_tool', arguments: { city: 'Moscow' } } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [stringParamsTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const firstReq = chatMock.mock.calls[0][0];
    const funcDef = firstReq.functions?.find((f: { name: string }) => f.name === 'str_tool');
    expect(funcDef.parameters.properties).toHaveProperty('city');
  });
});

// ---------------------------------------------------------------------------
// executeTool — call/func/no-executor branches
// ---------------------------------------------------------------------------

describe('GigaChat — executeTool branch coverage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses tool.call when execute is absent', async () => {
    const callTool = {
      name: 'call_tool',
      description: 'Uses call',
      call: jest.fn().mockResolvedValue('call result'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'call_tool', arguments: { input: 'data' } } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [callTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    expect(callTool.call).toHaveBeenCalledWith('data');
  });

  it('uses tool.func when execute and call are absent', async () => {
    const funcTool = {
      name: 'func_tool',
      description: 'Uses func',
      func: jest.fn().mockResolvedValue({ computed: 42 }),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'func_tool', arguments: { input: 'x' } } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [funcTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    // result was an object → JSON.stringify path
    expect(funcTool.func).toHaveBeenCalledTimes(1);
    const funcMsg = chatMock.mock.calls[1][0].messages.find(
      (m: { role: string; name?: string }) => m.role === 'function' && m.name === 'func_tool',
    );
    expect(funcMsg.content).toContain('"computed":42');
  });

  it('returns error message when no executor is present', async () => {
    const emptyTool = { name: 'empty_tool', description: 'No executor' };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'empty_tool', arguments: {} } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [emptyTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const funcMsg = chatMock.mock.calls[1][0].messages.find(
      (m: { role: string; name?: string }) => m.role === 'function' && m.name === 'empty_tool',
    );
    expect(funcMsg.content).toContain('not found');
  });

  it('handles tool throwing an error gracefully', async () => {
    const errorTool = {
      name: 'error_tool',
      description: 'Throws',
      execute: jest.fn().mockRejectedValue(new Error('tool crashed')),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'error_tool', arguments: {} } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [errorTool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    // Should NOT throw — error is captured and sent back to model
    await expect(node.execute.call(ctx as never)).resolves.not.toThrow();

    const funcMsg = chatMock.mock.calls[1][0].messages.find(
      (m: { role: string; name?: string }) => m.role === 'function' && m.name === 'error_tool',
    );
    expect(funcMsg.content).toContain('tool crashed');
  });

  it('parses string funcArgsRaw before passing to executeTool', async () => {
    const tool = {
      name: 'parse_tool',
      description: 'Parses args',
      execute: jest.fn().mockResolvedValue('ok'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'parse_tool', arguments: '{"key":"val"}' } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [tool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    expect(tool.execute).toHaveBeenCalledWith({ key: 'val' });
  });

  it('handles unparseable string funcArgsRaw as { raw: ... }', async () => {
    const tool = {
      name: 'raw_tool',
      description: 'Raw args',
      execute: jest.fn().mockResolvedValue('ok'),
    };

    const toolCallResp = {
      id: 'r1',
      choices: [{ index: 0, message: { role: 'assistant', function_call: { name: 'raw_tool', arguments: 'NOT_JSON' } }, finish_reason: 'function_call' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const { ctx, chatMock } = makeCtx({ tools: [tool] });
    chatMock.mockResolvedValueOnce(toolCallResp).mockResolvedValueOnce(defaultResponse);

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    expect(tool.execute).toHaveBeenCalledWith({ raw: 'NOT_JSON' });
  });
});

// ---------------------------------------------------------------------------
// Options — systemMessage and function_call=none branch
// ---------------------------------------------------------------------------

describe('GigaChat — options branches', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prepends system message when provided in options', async () => {
    const { ctx, chatMock } = makeCtx({
      params: { options: { systemMessage: 'You are a helpful assistant' } },
    });

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const req = chatMock.mock.calls[0][0];
    const sysMsg = req.messages.find((m: { role: string }) => m.role === 'system');
    expect(sysMsg).toBeDefined();
    expect(sysMsg.content).toBe('You are a helpful assistant');
  });

  it('sets function_call=none when functionCall option is "none"', async () => {
    const tool = {
      name: 'a_tool',
      description: 'test',
      parameters: { properties: { x: { type: 'string' } }, required: ['x'] },
      execute: jest.fn().mockResolvedValue('result'),
    };

    const { ctx, chatMock } = makeCtx({
      params: { options: { functionCall: 'none' } },
      tools: [tool],
    });

    const node = new GigaChat();
    await node.execute.call(ctx as never);

    const req = chatMock.mock.calls[0][0];
    expect(req.function_call).toBe('none');
  });
});
