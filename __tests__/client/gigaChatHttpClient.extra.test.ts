/**
 * Additional tests for gigaChatHttpClient.ts — covering branches missed by the
 * primary test file: mapAxiosError, network-error paths, and httpClient wrappers.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios') as typeof import('axios');
  const mockAxios = {
    ...actual,
    create: jest.fn(() => ({
      post: jest.fn(),
      get: jest.fn(),
    })),
    isAxiosError: actual.isAxiosError,
  };
  return { __esModule: true, default: mockAxios };
});

jest.mock('../../nodes/shared/certs/index', () => ({
  certBuffer: Buffer.from('fake-cert'),
}));

import axios from 'axios';
import {
  fetchAccessToken,
  apiPost,
  apiGet,
  httpClient,
} from '../../nodes/shared/client/gigaChatHttpClient';
import {
  GigaChatAuthError,
  GigaChatApiError,
  GigaChatRateLimitError,
} from '../../nodes/shared/client/types';

// ---------------------------------------------------------------------------
// mapAxiosError — called when axios throws (network-level failures)
// ---------------------------------------------------------------------------

describe('fetchAccessToken — network error path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-throws non-Axios errors unchanged', async () => {
    const networkError = new Error('ECONNREFUSED');
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(networkError),
      get: jest.fn(),
    });

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('maps Axios 401 error to GigaChatAuthError', async () => {
    const axErr = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: { message: 'bad credentials' } },
    });
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(axErr),
      get: jest.fn(),
    });
    // axios.isAxiosError checks the isAxiosError flag
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toBeInstanceOf(GigaChatAuthError);
  });

  it('maps Axios 429 error to GigaChatRateLimitError', async () => {
    const axErr = Object.assign(new Error('Too Many Requests'), {
      isAxiosError: true,
      response: { status: 429, data: { message: 'rate limit' } },
    });
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(axErr),
      get: jest.fn(),
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toBeInstanceOf(GigaChatRateLimitError);
  });

  it('maps Axios 500 error to GigaChatApiError', async () => {
    const axErr = Object.assign(new Error('Internal Server Error'), {
      isAxiosError: true,
      response: { status: 500, data: { message: 'server fault' } },
    });
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(axErr),
      get: jest.fn(),
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toBeInstanceOf(GigaChatApiError);
  });

  it('uses error.message when response has no data', async () => {
    const axErr = Object.assign(new Error('timeout'), {
      isAxiosError: true,
      response: undefined,
    });
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(axErr),
      get: jest.fn(),
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toThrow('timeout');
  });
});

// ---------------------------------------------------------------------------
// apiPost — network error path
// ---------------------------------------------------------------------------

describe('apiPost — network error path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-throws non-Axios network errors', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
      get: jest.fn(),
    });

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'token'),
    ).rejects.toThrow('ETIMEDOUT');
  });

  it('maps Axios 401 throw to GigaChatAuthError', async () => {
    const axErr = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401, data: { message: 'expired' } },
    });
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockRejectedValue(axErr),
      get: jest.fn(),
    });
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'token'),
    ).rejects.toBeInstanceOf(GigaChatAuthError);
  });

  it('throws GigaChatApiError when response is null', async () => {
    // validateStatus returns true for all codes, so if something forces response to be null
    // we can simulate the guard at line 155 by mocking post to resolve(undefined)
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue(undefined as never),
      get: jest.fn(),
    });

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'token'),
    ).rejects.toBeInstanceOf(GigaChatApiError);
  });
});

// ---------------------------------------------------------------------------
// apiGet — network error path
// ---------------------------------------------------------------------------

describe('apiGet — network error path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('re-throws non-Axios network errors', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockRejectedValue(new Error('ENETUNREACH')),
    });

    await expect(apiGet('https://api.example.com', '/models', 'token')).rejects.toThrow(
      'ENETUNREACH',
    );
  });

  it('throws GigaChatApiError when response is null', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockResolvedValue(undefined as never),
    });

    await expect(apiGet('https://api.example.com', '/models', 'token')).rejects.toBeInstanceOf(
      GigaChatApiError,
    );
  });
});

// ---------------------------------------------------------------------------
// httpClient convenience wrappers
// ---------------------------------------------------------------------------

describe('httpClient convenience object', () => {
  beforeEach(() => jest.clearAllMocks());

  it('httpClient.chat posts to /chat/completions', async () => {
    const mockData = { id: 'c1', choices: [], usage: {} };
    const mockPost = jest.fn().mockResolvedValue({ status: 200, data: mockData });
    (axios.create as jest.Mock).mockReturnValue({ post: mockPost, get: jest.fn() });

    const req = { model: 'GigaChat', messages: [], stream: false as const };
    const result = await httpClient.chat('https://api.example.com', req, 'tok');

    expect(result).toEqual(mockData);
    expect(mockPost).toHaveBeenCalledWith(
      '/chat/completions',
      req,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }),
    );
  });

  it('httpClient.getModels gets /models', async () => {
    const mockData = { object: 'list', data: [{ id: 'GigaChat' }] };
    const mockGet = jest.fn().mockResolvedValue({ status: 200, data: mockData });
    (axios.create as jest.Mock).mockReturnValue({ post: jest.fn(), get: mockGet });

    const result = await httpClient.getModels('https://api.example.com', 'tok');

    expect(result).toEqual(mockData);
    expect(mockGet).toHaveBeenCalledWith('/models', expect.anything());
  });

  it('httpClient.embeddings posts to /embeddings', async () => {
    const mockData = { object: 'list', data: [{ index: 0, embedding: [0.1, 0.2] }] };
    const mockPost = jest.fn().mockResolvedValue({ status: 200, data: mockData });
    (axios.create as jest.Mock).mockReturnValue({ post: mockPost, get: jest.fn() });

    const req = { model: 'Embeddings', input: ['text'] };
    const result = await httpClient.embeddings('https://api.example.com', req, 'tok');

    expect(result).toEqual(mockData);
    expect(mockPost).toHaveBeenCalledWith('/embeddings', req, expect.anything());
  });

  it('httpClient.countTokens posts to /tokens/count', async () => {
    const mockData = { tokens: 5 };
    const mockPost = jest.fn().mockResolvedValue({ status: 200, data: mockData });
    (axios.create as jest.Mock).mockReturnValue({ post: mockPost, get: jest.fn() });

    const req = { model: 'GigaChat', input: ['hello'] };
    const result = await httpClient.countTokens('https://api.example.com', req, 'tok');

    expect(result).toEqual(mockData);
    expect(mockPost).toHaveBeenCalledWith('/tokens/count', req, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// fetchAccessToken — error_description message extraction
// ---------------------------------------------------------------------------

describe('fetchAccessToken — error message extraction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses error_description from response body on 403', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 403,
        data: { error_description: 'Access denied to scope' },
      }),
      get: jest.fn(),
    });

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_CORP'),
    ).rejects.toThrow('Access denied to scope');
  });

  it('uses generic message when response body is empty on failure', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 503,
        data: {},
      }),
      get: jest.fn(),
    });

    await expect(
      fetchAccessToken('https://auth.example.com', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toThrow('Auth request failed with status 503');
  });
});
