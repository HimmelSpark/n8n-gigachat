/**
 * GigaChat Embeddings supply node.
 *
 * Exposes a LangChain-compatible Embeddings object via the AiEmbedding output
 * so it can be connected to Vector Store nodes and other embedding consumers.
 */

import {
  INodeType,
  INodeTypeDescription,
  ISupplyDataFunctions,
  NodeConnectionTypes,
  SupplyData,
} from 'n8n-workflow';

import { Embeddings, EmbeddingsParams } from '@langchain/core/embeddings';

import { createGigaChatClient, GigaChatClient } from '../shared/client/gigaChatClient';
import { buildCredentials, loadEmbeddingModels, RawCredentials } from '../shared/modelLoader';
import { disclaimerNotice } from '../shared/descriptions';

// ---------------------------------------------------------------------------
// LangChain Embeddings adapter
// ---------------------------------------------------------------------------

interface GigaChatEmbeddingsParams extends EmbeddingsParams {
  client: GigaChatClient;
  modelName: string;
}

class GigaChatEmbeddingsModel extends Embeddings {
  private readonly gcClient: GigaChatClient;
  readonly modelName: string;

  constructor(params: GigaChatEmbeddingsParams) {
    super(params);
    this.gcClient = params.client;
    this.modelName = params.modelName;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const response = await this.gcClient.embeddings({
      model: this.modelName,
      input: texts,
    });
    // Return in the same order as input
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    return sorted.map((e) => e.embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] ?? [];
  }
}

// ---------------------------------------------------------------------------
// n8n node class
// ---------------------------------------------------------------------------

export class EmGigaChat implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'GigaChat Embeddings',
    name: 'emGigaChat',
    icon: 'file:gigachat.svg',
    group: ['transform'],
    version: 1,
    description: 'GigaChat text embeddings from Sber — connects to Vector Store nodes',
    defaults: { name: 'GigaChat Embeddings' },
    codex: {
      categories: ['AI'],
      subcategories: {
        AI: ['Embeddings'],
      },
    },
    // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node
    inputs: [],
    // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong
    outputs: [NodeConnectionTypes.AiEmbedding],
    outputNames: ['Embeddings'],
    credentials: [{ name: 'gigaChatApi', required: true }],
    properties: [
      disclaimerNotice,
      {
        displayName: 'Model',
        name: 'model',
        type: 'options',
        description: 'GigaChat embedding model to use',
        default: 'Embeddings',
        typeOptions: { loadOptionsMethod: 'getEmbeddingModels' },
      },
    ],
  };

  methods = {
    loadOptions: {
      getEmbeddingModels: loadEmbeddingModels,
    },
  };

  async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
    const raw = await this.getCredentials<RawCredentials>('gigaChatApi');
    const modelName = this.getNodeParameter('model', itemIndex) as string;

    const gcClient = createGigaChatClient(buildCredentials(raw));

    const embeddingsModel = new GigaChatEmbeddingsModel({
      client: gcClient,
      modelName,
    });

    return { response: embeddingsModel };
  }
}
