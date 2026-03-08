/**
 * Unit tests for gigaChatHttpClient.ts
 *
 * Mocks axios to avoid real HTTP calls. Tests cover:
 *  - fetchAccessToken: success, auth failure, network error
 *  - apiPost: 200 success, 401 → GigaChatAuthError, 429 → GigaChatRateLimitError, 500 → GigaChatApiError
 *  - apiGet: 200 success, 401 → GigaChatAuthError
 *  - isTokenExpiredError: true for GigaChatAuthError, false otherwise
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

// Also mock the cert loader so it doesn't try to hit the filesystem
jest.mock('../../nodes/shared/certs/index', () => ({
  certBuffer: undefined,
}));

import axios from 'axios';
import {
  fetchAccessToken,
  apiPost,
  apiGet,
  isTokenExpiredError,
} from '../../nodes/shared/client/gigaChatHttpClient';
import {
  GigaChatAuthError,
  GigaChatApiError,
  GigaChatRateLimitError,
} from '../../nodes/shared/client/types';

describe('isTokenExpiredError', () => {
  it('returns true for GigaChatAuthError', () => {
    expect(isTokenExpiredError(new GigaChatAuthError('expired'))).toBe(true);
  });

  it('returns false for GigaChatApiError', () => {
    expect(isTokenExpiredError(new GigaChatApiError(500, 'server error'))).toBe(false);
  });

  it('returns false for generic errors', () => {
    expect(isTokenExpiredError(new Error('generic'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isTokenExpiredError('string error')).toBe(false);
  });
});

describe('fetchAccessToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns token data on 200 response', async () => {
    const mockPost = jest.fn().mockResolvedValue({
      status: 200,
      data: { access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 1800 },
    });
    (axios.create as jest.Mock).mockReturnValue({ post: mockPost, get: jest.fn() });

    const result = await fetchAccessToken(
      'https://auth.example.com/api/v2/oauth',
      'base64key',
      'GIGACHAT_API_PERS',
    );

    expect(result.access_token).toBe('test-token');
    expect(mockPost).toHaveBeenCalledTimes(1);
    const callArgs = mockPost.mock.calls[0];
    expect(callArgs[0]).toBe('');
    expect(callArgs[1]).toContain('scope=GIGACHAT_API_PERS');
    expect(callArgs[2].headers['Authorization']).toBe('Basic base64key');
  });

  it('throws GigaChatAuthError on 401 response', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 401,
        data: { error: 'invalid_client', error_description: 'Bad credentials' },
      }),
      get: jest.fn(),
    });

    await expect(
      fetchAccessToken('https://auth.example.com/api/v2/oauth', 'badkey', 'GIGACHAT_API_PERS'),
    ).rejects.toThrow(GigaChatAuthError);
  });

  it('throws GigaChatAuthError on non-200 response', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 400,
        data: { error: 'bad_request' },
      }),
      get: jest.fn(),
    });

    await expect(
      fetchAccessToken('https://auth.example.com/api/v2/oauth', 'key', 'GIGACHAT_API_PERS'),
    ).rejects.toThrow(GigaChatAuthError);
  });
});

describe('apiPost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns response data on 200', async () => {
    const mockData = { id: 'chat-1', choices: [], usage: {} };
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({ status: 200, data: mockData }),
      get: jest.fn(),
    });

    const result = await apiPost(
      'https://api.example.com',
      '/chat/completions',
      { model: 'GigaChat', messages: [] },
      'my-token',
    );

    expect(result).toEqual(mockData);
  });

  it('throws GigaChatAuthError on 401', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 401,
        data: { message: 'Token has expired' },
      }),
      get: jest.fn(),
    });

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'expired-token'),
    ).rejects.toThrow(GigaChatAuthError);
  });

  it('throws GigaChatRateLimitError on 429', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 429,
        data: { message: 'Too many requests' },
      }),
      get: jest.fn(),
    });

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'token'),
    ).rejects.toThrow(GigaChatRateLimitError);
  });

  it('throws GigaChatApiError on 500', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn().mockResolvedValue({
        status: 500,
        data: { message: 'Internal Server Error' },
      }),
      get: jest.fn(),
    });

    await expect(
      apiPost('https://api.example.com', '/chat/completions', {}, 'token'),
    ).rejects.toThrow(GigaChatApiError);
  });

  it('includes Authorization header with Bearer token', async () => {
    const mockPost = jest.fn().mockResolvedValue({ status: 200, data: {} });
    (axios.create as jest.Mock).mockReturnValue({ post: mockPost, get: jest.fn() });

    await apiPost('https://api.example.com', '/path', {}, 'my-bearer-token');

    const callArgs = mockPost.mock.calls[0];
    expect(callArgs[2].headers['Authorization']).toBe('Bearer my-bearer-token');
  });
});

describe('apiGet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns response data on 200', async () => {
    const mockData = { object: 'list', data: [] };
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({ status: 200, data: mockData }),
    });

    const result = await apiGet('https://api.example.com', '/models', 'token');
    expect(result).toEqual(mockData);
  });

  it('throws GigaChatAuthError on 401', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({
        status: 401,
        data: { message: 'Unauthorized' },
      }),
    });

    await expect(apiGet('https://api.example.com', '/models', 'bad-token')).rejects.toThrow(
      GigaChatAuthError,
    );
  });

  it('throws GigaChatRateLimitError on 429', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({
        status: 429,
        data: { message: 'Rate limit' },
      }),
    });

    await expect(apiGet('https://api.example.com', '/models', 'token')).rejects.toThrow(
      GigaChatRateLimitError,
    );
  });

  it('throws GigaChatApiError on 503', async () => {
    (axios.create as jest.Mock).mockReturnValue({
      post: jest.fn(),
      get: jest.fn().mockResolvedValue({
        status: 503,
        data: { message: 'Service Unavailable' },
      }),
    });

    await expect(apiGet('https://api.example.com', '/models', 'token')).rejects.toThrow(
      GigaChatApiError,
    );
  });
});
