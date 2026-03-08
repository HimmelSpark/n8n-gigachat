/**
 * Shared n8n property descriptions reused across nodes.
 */

import { INodeProperties } from 'n8n-workflow';

/**
 * Disclaimer notice shown at the top of every node and credential form.
 */
export const disclaimerNotice: INodeProperties = {
  displayName:
    '<b>Неофициальный проект</b><br/>На ваш страх и риск. Это не официальный узел от Сбера.<br/>' +
    '<a href="https://github.com/n8n-nodes-gigachat" target="_blank">Подробнее на GitHub</a>',
  name: 'unofficialWarning',
  type: 'notice',
  default: '',
};

/**
 * Common model selection property (loadOptions variant).
 */
export function modelProperty(
  loadOptionsMethod: string,
  defaultValue = 'GigaChat',
): INodeProperties {
  return {
    displayName: 'Model',
    name: 'model',
    type: 'options',
    description: 'The GigaChat model to use',
    default: defaultValue,
    typeOptions: {
      loadOptionsMethod,
    },
  };
}

/**
 * Temperature slider shared across nodes.
 */
export const temperatureProperty: INodeProperties = {
  displayName: 'Temperature',
  name: 'temperature',
  type: 'number',
  default: 0.7,
  description: 'Sampling temperature (0–2). Higher values produce more random output.',
  typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
};

/**
 * Top-P slider shared across nodes.
 */
export const topPProperty: INodeProperties = {
  displayName: 'Top P',
  name: 'topP',
  type: 'number',
  default: 0.9,
  description: 'Nucleus sampling probability mass (0–1).',
  typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
};

/**
 * Repetition penalty shared across nodes.
 */
export const repetitionPenaltyProperty: INodeProperties = {
  displayName: 'Repetition Penalty',
  name: 'repetitionPenalty',
  type: 'number',
  default: 1.0,
  description: 'Penalty for token repetition. 1.0 is neutral.',
  typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 1 },
};

/**
 * Max tokens property shared across nodes.
 */
export const maxTokensProperty: INodeProperties = {
  displayName: 'Max Tokens',
  name: 'maxTokens',
  type: 'number',
  default: 1024,
  description: 'Maximum number of tokens to generate.',
  typeOptions: { minValue: 1 },
};
