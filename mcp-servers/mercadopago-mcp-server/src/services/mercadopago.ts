import axios, { AxiosError } from 'axios';
import { MP_API_BASE_URL, DEFAULT_TIMEOUT_MS } from '../constants.js';

type MpErrorBody = {
  error?: string;
  message?: string;
  cause?: Array<{ description?: string; code?: string }>;
};

export function getAccessToken(override?: string): string {
  const token = override || process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'MERCADOPAGO_ACCESS_TOKEN not configured. ' +
      'Set the environment variable or pass access_token in the tool call.'
    );
  }
  return token;
}

export async function mpRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: {
    data?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    accessToken?: string;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const token = getAccessToken(options.accessToken);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (options.idempotencyKey) {
    headers['X-Idempotency-Key'] = options.idempotencyKey;
  }

  const cleanParams: Record<string, string | number | boolean> = {};
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined) cleanParams[k] = v;
    }
  }

  const response = await axios({
    method,
    url: `${MP_API_BASE_URL}${path}`,
    data: options.data,
    params: Object.keys(cleanParams).length > 0 ? cleanParams : undefined,
    headers,
    timeout: DEFAULT_TIMEOUT_MS,
  });

  return response.data as T;
}

export function handleMpError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const data = error.response?.data as MpErrorBody | undefined;

    if (status === 401) {
      return 'Error: Invalid or expired access token. Check MERCADOPAGO_ACCESS_TOKEN or pass a valid access_token parameter.';
    }
    if (status === 403) {
      return 'Error: Permission denied. The access token does not have permission for this operation.';
    }
    if (status === 404) {
      return 'Error: Resource not found. Check if the ID is correct.';
    }
    if (status === 400 || status === 422) {
      const cause = data?.cause?.[0]?.description || data?.message || 'Bad request';
      return `Error: ${status === 422 ? 'Validation failed' : 'Bad request'} — ${cause}. Check parameters and try again.`;
    }
    if (status === 429) {
      return 'Error: Rate limit exceeded. Wait a moment before retrying.';
    }

    const errorCode = data?.error || 'unknown';
    const errorMsg = data?.message || data?.cause?.[0]?.description || '';
    return `Error: API returned status ${status} (${errorCode})${errorMsg ? ': ' + errorMsg : ''}.`;
  }

  if (error instanceof Error) {
    if (error.message.includes('MERCADOPAGO_ACCESS_TOKEN')) return error.message;
    if (error.message.includes('timeout')) {
      return 'Error: Request timed out. Mercado Pago API is slow. Try again.';
    }
  }

  return `Error: Unexpected — ${error instanceof Error ? error.message : String(error)}`;
}
