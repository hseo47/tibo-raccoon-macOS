import { FEED_URL, type FeedErrorKind, type Post } from '../domain';
import { normalizeDayclawPayload } from './normalize';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class FeedError extends Error {
  constructor(
    readonly kind: FeedErrorKind,
    readonly publicMessage: string,
    readonly status?: number,
  ) {
    super(publicMessage);
    this.name = 'FeedError';
  }
}

export async function fetchDayclawPosts(options: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
} = {}): Promise<Post[]> {
  const maxBytes = resolveMaxBytes(options.maxBytes);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(FEED_URL, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw httpError(response.status);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      throw oversizeError();
    }

    let text: string;
    try {
      text = await readBody(response, maxBytes);
    } catch (error) {
      if (error instanceof FeedError) {
        throw error;
      }
      throw networkError();
    }

    try {
      return normalizeDayclawPayload(JSON.parse(text) as unknown);
    } catch {
      throw malformedError();
    }
  } catch (error) {
    if (error instanceof FeedError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw timeoutError();
    }
    throw networkError();
  } finally {
    clearTimeout(timer);
  }
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    throw malformedError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw oversizeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw malformedError();
  }
}

function resolveMaxBytes(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_BYTES;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw malformedError();
  }
  return Math.min(value, DEFAULT_MAX_BYTES);
}

function timeoutError(): FeedError {
  return new FeedError('timeout', 'Feed request timed out');
}

function httpError(status: number): FeedError {
  return new FeedError('http', `Feed request failed (HTTP ${status})`, status);
}

function oversizeError(): FeedError {
  return new FeedError('oversize', 'Feed response is too large');
}

function malformedError(): FeedError {
  return new FeedError('malformed', 'Feed response is malformed');
}

function networkError(): FeedError {
  return new FeedError('network', 'Feed request failed');
}
