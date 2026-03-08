/**
 * GigaChat API credential type for n8n.
 *
 * The credential stores the base64-encoded authorization key (ClientId:ClientSecret)
 * that is exchanged for a short-lived OAuth bearer token via the /api/v2/oauth endpoint.
 *
 * Documentation: https://developers.sber.ru/docs/ru/gigachat/quickstart/ind-using-api
 */

import {
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class GigaChatApi implements ICredentialType {
  name = 'gigaChatApi';

  // eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api
  displayName = 'GigaChat';

  documentationUrl =
    'https://developers.sber.ru/docs/ru/gigachat/quickstart/ind-using-api#poluchenie-avtorizatsionnyh-dannyh';

  properties: INodeProperties[] = [
    {
      displayName:
        '<b>Неофициальный проект</b><br/>Это неофициальные узлы для GigaChat. ' +
        'Используйте на свой страх и риск.',
      name: 'unofficialWarning',
      type: 'notice',
      default: '',
    },
    {
      displayName: 'Authorization Key',
      name: 'authorizationKey',
      type: 'string',
      default: '',
      required: true,
      description:
        'Base64-encoded "ClientId:ClientSecret" authorization key obtained from ' +
        'https://developers.sber.ru/studio',
      typeOptions: { password: true },
    },
    {
      displayName: 'Scope',
      name: 'scope',
      type: 'options',
      description: 'Account type / API access scope',
      default: 'GIGACHAT_API_PERS',
      options: [
        {
          name: 'GIGACHAT_API_PERS — Individual',
          value: 'GIGACHAT_API_PERS',
          description: 'Individual (personal) account',
        },
        {
          name: 'GIGACHAT_API_B2B — Business (token packages)',
          value: 'GIGACHAT_API_B2B',
          description: 'Business account with pre-purchased token packages',
        },
        {
          name: 'GIGACHAT_API_CORP — Business (pay-as-you-go)',
          value: 'GIGACHAT_API_CORP',
          description: 'Corporate account with pay-as-you-go billing',
        },
      ],
    },
    {
      type: 'notice',
      name: 'urlNotice',
      default: '',
      displayName:
        '<b>Base URLs</b><br/>Only change these if you know what you are doing.',
    },
    {
      displayName: 'Auth Base URL',
      name: 'base_url',
      type: 'string',
      default: 'https://ngw.devices.sberbank.ru:9443',
      required: true,
      description: 'Base URL for the OAuth token endpoint (without the /api/v2/oauth path)',
    },
    {
      displayName: 'API Base URL',
      name: 'base_back_url',
      type: 'string',
      default: 'https://gigachat.devices.sberbank.ru/api/v1',
      required: true,
      description: 'Base URL for the GigaChat REST API',
    },
    {
      displayName: 'Debug',
      name: 'debug',
      type: 'boolean',
      default: false,
      required: false,
      description:
        'Whether to enable verbose debug logging in the n8n console',
    },
  ];
}
