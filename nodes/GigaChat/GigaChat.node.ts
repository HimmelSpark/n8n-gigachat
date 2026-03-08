/**
 * GigaChat AI — main chat node.
 *
 * Supports:
 *  - Optional AiMemory connection (LangChain BaseChatMemory)
 *  - Optional AiTool connections (n8n tool nodes)
 *  - Multi-turn function-calling loop with configurable max iterations
 *  - Simplified or full output modes
 */

import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeConnectionTypes,
} from 'n8n-workflow';

import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';

import { createGigaChatClient } from '../shared/client/gigaChatClient';
import { buildCredentials, RawCredentials } from '../shared/modelLoader';
import { loadChatModels } from '../shared/modelLoader';
import {
  ChatMessage,
  ChatRequest,
  UsageStats,
  FunctionDefinition,
} from '../shared/client/types';
import { disclaimerNotice } from '../shared/descriptions';

// ---------------------------------------------------------------------------
// Memory type alias
// ---------------------------------------------------------------------------

interface MemoryLike {
  loadMemoryVariables(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  saveContext(
    inputValues: Record<string, unknown>,
    outputValues: Record<string, unknown>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helper — convert LangChain BaseMessage[] to GigaChat ChatMessage[]
// ---------------------------------------------------------------------------

function langchainMessagesToGigaChat(history: BaseMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of history) {
    if (msg instanceof HumanMessage) {
      result.push({ role: 'user', content: String(msg.content) });
      continue;
    }

    if (msg instanceof AIMessage) {
      // Check for tool_calls in additional_kwargs (OpenAI-style function calls)
      const toolCalls = msg.additional_kwargs?.tool_calls as
        | Array<{ function: { name: string; arguments: string } }>
        | undefined;

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let parsedArgs: Record<string, unknown>;
          try {
            parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          result.push({
            role: 'assistant',
            function_call: { name: tc.function.name, arguments: parsedArgs },
          });
        }
      } else if (msg.content) {
        result.push({ role: 'assistant', content: String(msg.content) });
      }
      continue;
    }

    if (msg instanceof ToolMessage) {
      result.push({
        role: 'function',
        name: msg.tool_call_id ?? 'unknown_tool',
        content: String(msg.content),
      });
      continue;
    }

    // Generic fallback — treat as assistant text
    if (msg.content) {
      result.push({ role: 'assistant', content: String(msg.content) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper — prepare tools from n8n AiTool connections
// ---------------------------------------------------------------------------

interface N8nTool {
  name: string;
  description?: string;
  parameters?: unknown;
  schema?: unknown;
  execute?: (input: unknown) => Promise<unknown>;
  call?: (input: unknown) => Promise<unknown>;
  func?: (input: unknown) => Promise<unknown>;
}

function buildFunctionDefinitions(tools: N8nTool[]): FunctionDefinition[] {
  return tools.map((tool) => {
    let properties: Record<string, unknown> = {};
    let required: string[] = [];

    const params = tool.parameters as Record<string, unknown> | string | undefined;

    if (typeof params === 'object' && params !== null) {
      properties = (params.properties as Record<string, unknown>) ?? {};
      required = (params.required as string[]) ?? [];
    } else if (typeof params === 'string') {
      try {
        const parsed = JSON.parse(params) as Record<string, unknown>;
        properties = (parsed.properties as Record<string, unknown>) ?? {};
        required = (parsed.required as string[]) ?? [];
      } catch {
        // ignore parse error
      }
    }

    // Try tool.schema as fallback
    if (Object.keys(properties).length === 0 && tool.schema) {
      const schema = tool.schema as Record<string, unknown>;
      if (schema.properties) {
        properties = schema.properties as Record<string, unknown>;
        required = (schema.required as string[]) ?? [];
      }
    }

    // Provide a generic fallback parameter if the tool has no schema
    if (Object.keys(properties).length === 0) {
      properties = { input: { type: 'string', description: 'Input for the tool' } };
      required = ['input'];
    }

    return {
      name: tool.name,
      description: tool.description ?? '',
      parameters: { type: 'object', properties, required },
    };
  });
}

async function executeTool(tool: N8nTool, args: Record<string, unknown>): Promise<string> {
  let input: unknown = args;

  // DynamicTool-style tools expect a plain string
  if (!tool.execute && tool.call) {
    const firstVal = Object.values(args)[0];
    input = typeof firstVal === 'string' ? firstVal : JSON.stringify(args);
  }

  let result: unknown;
  if (typeof tool.execute === 'function') {
    result = await tool.execute(input);
  } else if (typeof tool.call === 'function') {
    result = await tool.call(input);
  } else if (typeof tool.func === 'function') {
    result = await tool.func(input);
  } else {
    result = { error: 'Tool execution method not found' };
  }

  if (typeof result === 'string') return result;
  return JSON.stringify(result);
}

// ---------------------------------------------------------------------------
// Node class
// ---------------------------------------------------------------------------

export class GigaChat implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GigaChat AI',
    name: 'gigaChat',
    icon: 'file:gigachat.svg',
    group: ['transform'],
    version: 1,
    description: 'Chat with GigaChat AI models with memory persistence and tool support',
    defaults: { name: 'GigaChat' },
    codex: {
      categories: ['AI', 'Chat'],
      subcategories: {
        AI: ['Chains', 'Root Nodes'],
        Chat: ['Conversational Agents'],
      },
      resources: {
        primaryDocumentation: [
          { url: 'https://developers.sber.ru/docs/ru/gigachat/api/overview' },
        ],
      },
    },
    // eslint-disable-next-line
    inputs: [
      NodeConnectionTypes.Main,
      {
        type: NodeConnectionTypes.AiMemory,
        displayName: 'Memory',
        required: false,
        maxConnections: 1,
      },
      {
        type: NodeConnectionTypes.AiTool,
        displayName: 'Tools',
        required: false,
        maxConnections: Infinity,
      },
    ],
    // eslint-disable-next-line
    outputs: [NodeConnectionTypes.Main],
    outputNames: [''],
    credentials: [{ name: 'gigaChatApi', required: true }],
    properties: [
      disclaimerNotice,
      {
        displayName: 'Model',
        name: 'modelId',
        type: 'options',
        description: 'GigaChat model to use for generation',
        typeOptions: { loadOptionsMethod: 'getChatModels' },
        default: 'GigaChat',
      },
      {
        displayName: 'Prompt',
        name: 'prompt',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'Enter your prompt here…',
        typeOptions: { rows: 3 },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        default: {},
        placeholder: 'Add option',
        options: [
          {
            displayName: 'System Message',
            name: 'systemMessage',
            type: 'string',
            default: '',
            description: 'System prompt that sets the assistant role and instructions.',
            typeOptions: { rows: 3 },
          },
          {
            displayName: 'Temperature',
            name: 'temperature',
            type: 'number',
            default: 0.7,
            description: 'Sampling temperature (0–2).',
            typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
          },
          {
            displayName: 'Top P',
            name: 'topP',
            type: 'number',
            default: 0.9,
            description: 'Nucleus sampling probability mass (0–1).',
            typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
          },
          {
            displayName: 'Max Tokens',
            name: 'maxTokensToSample',
            type: 'number',
            default: 1024,
            description: 'Maximum tokens to generate.',
            typeOptions: { minValue: 1 },
          },
          {
            displayName: 'Repetition Penalty',
            name: 'repetitionPenalty',
            type: 'number',
            default: 1.0,
            description: 'Penalty for repeated tokens (0.1–2, 1.0 = neutral).',
            typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 1 },
          },
          {
            displayName: 'Function Call Mode',
            name: 'functionCall',
            type: 'options',
            default: 'auto',
            description: 'Controls how the model handles function calls.',
            options: [
              { name: 'Auto', value: 'auto', description: 'Model decides when to call functions' },
              { name: 'None', value: 'none', description: 'Model will not call functions' },
            ],
          },
          {
            displayName: 'Max Tool Iterations',
            name: 'maxIterations',
            type: 'number',
            default: 5,
            description: 'Maximum number of tool-call iterations before breaking the loop.',
            typeOptions: { minValue: 1 },
          },
        ],
      },
      {
        displayName: 'Simplify Output',
        name: 'simplifyOutput',
        type: 'boolean',
        default: false,
        description:
          'Whether to return only the text response or include full usage/session metadata.',
      },
    ],
  };

  methods = {
    loadOptions: {
      getChatModels: loadChatModels,
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Obtain credentials once for all items
    const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
    const gigaClient = createGigaChatClient(buildCredentials(raw));

    // Optionally pull connected memory
    const memory = (await this.getInputConnectionData(
      NodeConnectionTypes.AiMemory,
      0,
    )) as MemoryLike | null;

    // Optionally pull connected tools
    const toolsRaw = await this.getInputConnectionData(NodeConnectionTypes.AiTool, 0).catch(
      () => null,
    );
    const tools: N8nTool[] = toolsRaw
      ? Array.isArray(toolsRaw)
        ? (toolsRaw as N8nTool[])
        : [toolsRaw as N8nTool]
      : [];
    const functionDefs = buildFunctionDefinitions(tools);

    for (let i = 0; i < items.length; i++) {
      const modelId = this.getNodeParameter('modelId', i) as string;
      const prompt = this.getNodeParameter('prompt', i) as string;
      const options = this.getNodeParameter('options', i) as IDataObject;
      const simplifyOutput = this.getNodeParameter('simplifyOutput', i) as boolean;

      // Build the base message list from memory
      const baseMessages: ChatMessage[] = [];

      if (options.systemMessage) {
        baseMessages.push({ role: 'system', content: options.systemMessage as string });
      }

      if (memory) {
        const memVars = await memory.loadMemoryVariables({});
        const chatHistory = (memVars['chat_history'] as BaseMessage[]) ?? [];
        baseMessages.push(...langchainMessagesToGigaChat(chatHistory));
      }

      // Messages accumulated during this turn (not persisted to memory mid-loop)
      const turnMessages: ChatMessage[] = [{ role: 'user', content: prompt }];

      const totalUsage: UsageStats = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        precached_prompt_tokens: 0,
      };

      const maxIterations = options.maxIterations ? Number(options.maxIterations) : 5;
      let iteration = 0;
      let lastResponse;

      while (iteration < maxIterations) {
        const chatRequest: ChatRequest = {
          model: modelId,
          messages: [...baseMessages, ...turnMessages],
          stream: false,
        };

        if (options.temperature !== undefined) chatRequest.temperature = options.temperature as number;
        if (options.topP !== undefined) chatRequest.top_p = options.topP as number;
        if (options.maxTokensToSample) chatRequest.max_tokens = options.maxTokensToSample as number;
        if (options.repetitionPenalty !== undefined)
          chatRequest.repetition_penalty = options.repetitionPenalty as number;

        if (functionDefs.length > 0) {
          chatRequest.functions = functionDefs;
          const funcCallMode = options.functionCall as string | undefined;
          if (funcCallMode === 'none') {
            chatRequest.function_call = 'none';
          } else {
            chatRequest.function_call = 'auto';
          }
        }

        lastResponse = await gigaClient.chat(chatRequest);

        if (lastResponse.usage) {
          totalUsage.prompt_tokens += lastResponse.usage.prompt_tokens ?? 0;
          totalUsage.completion_tokens += lastResponse.usage.completion_tokens ?? 0;
          totalUsage.total_tokens += lastResponse.usage.total_tokens ?? 0;
          totalUsage.precached_prompt_tokens =
            (totalUsage.precached_prompt_tokens ?? 0) +
            (lastResponse.usage.precached_prompt_tokens ?? 0);
        }

        const responseMessage = lastResponse.choices[0]?.message;
        if (!responseMessage) break;

        // No function call — we are done
        if (!responseMessage.function_call) {
          if (responseMessage.content) {
            turnMessages.push({ role: 'assistant', content: responseMessage.content });
          }
          break;
        }

        // Model wants to call a function
        turnMessages.push({
          role: 'assistant',
          function_call: responseMessage.function_call,
        });

        const fc = responseMessage.function_call;
        const funcName = typeof fc === 'object' ? fc.name : '';
        const funcArgsRaw = typeof fc === 'object' ? fc.arguments : {};
        let funcArgs: Record<string, unknown>;
        if (typeof funcArgsRaw === 'string') {
          try {
            funcArgs = JSON.parse(funcArgsRaw) as Record<string, unknown>;
          } catch {
            funcArgs = { raw: funcArgsRaw };
          }
        } else {
          funcArgs = funcArgsRaw as Record<string, unknown>;
        }

        const matchingTool = tools.find((t) => t.name === funcName);
        if (!matchingTool) {
          turnMessages.push({
            role: 'function',
            name: funcName,
            content: JSON.stringify({ error: `Tool "${funcName}" not found` }),
          });
          iteration++;
          continue;
        }

        try {
          const toolResult = await executeTool(matchingTool, funcArgs);
          turnMessages.push({ role: 'function', name: funcName, content: toolResult });
        } catch (toolErr) {
          const errMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          turnMessages.push({
            role: 'function',
            name: funcName,
            content: JSON.stringify({ error: errMsg }),
          });
        }

        iteration++;
      }

      // Extract the final assistant text
      const finalContent =
        [...turnMessages]
          .reverse()
          .find((m) => m.role === 'assistant' && m.content)?.content ?? '';

      // Persist to memory
      if (memory && prompt && finalContent) {
        await memory.saveContext({ input: prompt }, { output: finalContent });
      }

      // Build output
      const outputData: IDataObject = simplifyOutput
        ? { response: finalContent }
        : {
            response: finalContent,
            model: modelId,
            usage: totalUsage,
            iterations: iteration,
          };

      const executionData = this.helpers.constructExecutionMetaData(
        this.helpers.returnJsonArray(outputData),
        { itemData: { item: i } },
      );

      returnData.push(...executionData);
    }

    return [returnData];
  }
}
