/**
 * Minimal mock for n8n-workflow used in Jest tests.
 * Re-exports only what is needed so TypeScript doesn't complain.
 */

export enum NodeConnectionType {
  Main = 'main',
  AiMemory = 'ai_memory',
  AiTool = 'ai_tool',
  AiLanguageModel = 'ai_languageModel',
  AiEmbedding = 'ai_embedding',
}

// Stub interfaces — real types come from n8n-workflow at runtime
export type INodeProperties = Record<string, unknown>;
export type INodeType = Record<string, unknown>;
export type INodeTypeDescription = Record<string, unknown>;
export type IExecuteFunctions = Record<string, unknown>;
export type ISupplyDataFunctions = Record<string, unknown>;
export type ILoadOptionsFunctions = Record<string, unknown>;
export type INodePropertyOptions = { name: string; value: string };
export type IDataObject = Record<string, unknown>;
export type INodeExecutionData = Record<string, unknown>;
export type SupplyData = { response: unknown };
export type Icon = string | { light: string; dark: string };
export type ICredentialType = Record<string, unknown>;
