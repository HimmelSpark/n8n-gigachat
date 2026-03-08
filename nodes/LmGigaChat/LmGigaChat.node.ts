/**
 * GigaChat LangChain LLM supply node.
 *
 * Exposes a LangChain-compatible chat model via the AiLanguageModel output so
 * it can be connected to any n8n AI chain node (e.g. AI Agent, Summarize Chain).
 *
 * The node wraps our custom GigaChat client in a LangChain BaseChatModel so the
 * rest of the n8n AI ecosystem can use it without knowing anything about the
 * GigaChat-specific auth flow.
 */

import {
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  NodeConnectionTypes,
  SupplyData,
} from 'n8n-workflow';

import {
  BaseChatModel,
  BaseChatModelParams,
} from '@langchain/core/language_models/chat_models';
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { ChatResult, ChatGeneration } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';

import { createGigaChatClient, GigaChatClient } from '../shared/client/gigaChatClient';
import { buildCredentials, loadChatModels, RawCredentials } from '../shared/modelLoader';
import { ChatMessage, ChatRequest } from '../shared/client/types';
import { disclaimerNotice } from '../shared/descriptions';

// ---------------------------------------------------------------------------
// LangChain adapter
// ---------------------------------------------------------------------------

interface GigaChatLangChainParams extends BaseChatModelParams {
  client: GigaChatClient;
  modelName: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  repetitionPenalty?: number;
}

function baseMessageToGigaChat(msg: BaseMessage): ChatMessage {
  if (msg instanceof SystemMessage) {
    return { role: 'system', content: String(msg.content) };
  }
  if (msg instanceof HumanMessage) {
    return { role: 'user', content: String(msg.content) };
  }
  if (msg instanceof ToolMessage) {
    return {
      role: 'function',
      name: msg.tool_call_id ?? 'tool',
      content: String(msg.content),
    };
  }
  if (msg instanceof AIMessage) {
    const toolCalls = msg.additional_kwargs?.tool_calls as
      | Array<{ function: { name: string; arguments: string } }>
      | undefined;

    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0];
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        args = { raw: tc.function.arguments };
      }
      return { role: 'assistant', function_call: { name: tc.function.name, arguments: args } };
    }
    return { role: 'assistant', content: String(msg.content) };
  }
  // Fallback
  return { role: 'user', content: String(msg.content) };
}

class GigaChatLangChainModel extends BaseChatModel {
  private readonly gcClient: GigaChatClient;
  readonly modelName: string;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly repetitionPenalty?: number;

  constructor(params: GigaChatLangChainParams) {
    super(params);
    this.gcClient = params.client;
    this.modelName = params.modelName;
    this.temperature = params.temperature;
    this.topP = params.topP;
    this.maxTokens = params.maxTokens;
    this.repetitionPenalty = params.repetitionPenalty;
  }

  _llmType(): string {
    return 'gigachat';
  }

  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    const gigaMessages: ChatMessage[] = messages.map(baseMessageToGigaChat);

    const request: ChatRequest = {
      model: this.modelName,
      messages: gigaMessages,
      stream: false,
    };

    if (this.temperature !== undefined) request.temperature = this.temperature;
    if (this.topP !== undefined) request.top_p = this.topP;
    if (this.maxTokens !== undefined) request.max_tokens = this.maxTokens;
    if (this.repetitionPenalty !== undefined)
      request.repetition_penalty = this.repetitionPenalty;

    const response = await this.gcClient.chat(request);

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';
    const generation: ChatGeneration = {
      text,
      message: new AIMessage({ content: text }),
    };

    return {
      generations: [generation],
      llmOutput: { tokenUsage: response.usage },
    };
  }
}

// ---------------------------------------------------------------------------
// n8n node class
// ---------------------------------------------------------------------------

export class LmGigaChat implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GigaChat Model',
    name: 'lmGigaChat',
    icon: 'file:gigachat.svg',
    group: ['transform'],
    version: 1,
    description: 'GigaChat language models from Sber — connects to AI chain nodes',
    defaults: { name: 'GigaChat Model' },
    codex: {
      categories: ['AI'],
      subcategories: {
        AI: ['Language Models'],
        'Language Models': ['Text Completion Models'],
      },
    },
    // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
    inputs: [],
    // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
    outputs: [NodeConnectionTypes.AiLanguageModel],
    outputNames: ['Model'],
    credentials: [{ name: 'gigaChatApi', required: true }],
    properties: [
      disclaimerNotice,
      {
        displayName: 'Model',
        name: 'model',
        type: 'options',
        description: 'The GigaChat model to use',
        default: 'GigaChat',
        typeOptions: { loadOptionsMethod: 'getChatModels' },
      },
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        default: {},
        placeholder: 'Add option',
        options: [
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
            name: 'maxTokens',
            type: 'number',
            default: 1000,
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
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      getChatModels: loadChatModels,
    },
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
    const modelName = this.getNodeParameter('model', itemIndex) as string;
    const options = this.getNodeParameter('options', itemIndex, {}) as {
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      repetitionPenalty?: number;
    };

    const gcClient = createGigaChatClient(buildCredentials(raw));

    const langChainModel = new GigaChatLangChainModel({
      client: gcClient,
      modelName,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
      repetitionPenalty: options.repetitionPenalty,
    });

    return { response: langChainModel };
  }
}
