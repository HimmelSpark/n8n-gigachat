/**
 * All TypeScript interfaces for the GigaChat API client layer.
 */

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface GigaChatCredentials {
  /** Base64-encoded "ClientId:ClientSecret" authorization key */
  authorizationKey: string;
  scope: 'GIGACHAT_API_PERS' | 'GIGACHAT_API_CORP' | 'GIGACHAT_API_B2B';
  /** Full URL to the OAuth token endpoint, e.g. https://ngw.devices.sberbank.ru:9443/api/v2/oauth */
  authUrl: string;
  /** Base URL for the GigaChat REST API, e.g. https://gigachat.devices.sberbank.ru/api/v1 */
  apiUrl: string;
}

// ---------------------------------------------------------------------------
// OAuth token response
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  /** Seconds until expiry */
  expires_at: number;
}

// ---------------------------------------------------------------------------
// Chat API
// ---------------------------------------------------------------------------

export type MessageRole = 'system' | 'user' | 'assistant' | 'function';

export interface FunctionCall {
  name: string;
  arguments: Record<string, unknown> | string;
}

export interface ChatMessage {
  role: MessageRole;
  content?: string;
  /** Present on assistant messages that invoke a function */
  function_call?: FunctionCall;
  /** Present on function-result messages */
  name?: string;
}

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  repetition_penalty?: number;
  functions?: FunctionDefinition[];
  function_call?: 'auto' | 'none' | { name: string };
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  precached_prompt_tokens?: number;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: UsageStats;
}

// ---------------------------------------------------------------------------
// Models API
// ---------------------------------------------------------------------------

export interface GigaChatModel {
  id: string;
  object: string;
  owned_by: string;
  /** 'chat' | 'embedder' */
  type?: string;
}

export interface ModelsResponse {
  object: string;
  data: GigaChatModel[];
}

// ---------------------------------------------------------------------------
// Embeddings API
// ---------------------------------------------------------------------------

export interface EmbeddingsRequest {
  model: string;
  input: string[];
}

export interface EmbeddingObject {
  object: 'embedding';
  embedding: number[];
  index: number;
}

export interface EmbeddingsResponse {
  object: string;
  data: EmbeddingObject[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Token count API
// ---------------------------------------------------------------------------

export interface CountTokensRequest {
  model: string;
  input: string[];
}

export interface TokenCountEntry {
  object: string;
  tokens: number;
}

export interface CountTokensResponse {
  object: string;
  data: TokenCountEntry[];
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class GigaChatAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GigaChatAuthError';
    // Fix prototype chain for proper instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GigaChatApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GigaChatApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class GigaChatRateLimitError extends GigaChatApiError {
  constructor(message: string) {
    super(429, message);
    this.name = 'GigaChatRateLimitError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
