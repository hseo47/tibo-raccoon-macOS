import { FEED_URL, type FeedErrorKind, type Post } from '../domain';
import { normalizeDayclawPayload } from './normalize';

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_FX_PAGES = 20;

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

export async function fetchFxPosts(options: {
  fetchImpl?: FetchLike;
  since?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
} = {}): Promise<Post[]> {
  const maxBytes = resolveMaxBytes(options.maxBytes);
  const since = options.since === undefined || options.since === null ? null : Date.parse(options.since);
  if (since !== null && !Number.isFinite(since)) throw malformedError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const posts: Post[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < MAX_FX_PAGES; page++) {
      const url = cursor === null ? FEED_URL : `${FEED_URL}&cursor=${encodeURIComponent(cursor)}`;
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw httpError(response.status);
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && Number(contentLength) > maxBytes) throw oversizeError();
      const body = await readBody(response, maxBytes);
      let normalized: ReturnType<typeof normalizeFxPage>;
      try {
        normalized = normalizeFxPage(JSON.parse(body) as unknown);
      } catch (error) {
        if (error instanceof FeedError) throw error;
        throw malformedError();
      }
      if (page === 0 && normalized.posts.length === 0) throw malformedError();
      posts.push(...normalized.posts);
      if (posts.length > 500) throw malformedError();
      if (since === null || normalized.posts.some(({ publishedAt }) => publishedAt !== null && Date.parse(publishedAt) < since) || normalized.cursor === null) {
        return normalizeDayclawPayload({ items: posts });
      }
      cursor = normalized.cursor;
    }
    throw malformedError();
  } catch (error) {
    if (error instanceof FeedError) throw error;
    if (controller.signal.aborted) throw timeoutError();
    throw networkError();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFxPage(value: unknown): { posts: Post[]; cursor: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw malformedError();
  const page = value as Record<string, unknown>;
  if (page.code !== 200 || !Array.isArray(page.results) || page.results.length > 100) throw malformedError();
  const posts: Post[] = [];
  for (const result of page.results) {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) throw malformedError();
    const item = result as Record<string, unknown>;
    if (item.type !== 'status') continue;
    if (typeof item.author !== 'object' || item.author === null || Array.isArray(item.author)) throw malformedError();
    if ((item.author as Record<string, unknown>).screen_name !== 'thsottiaux') continue;
    if (typeof item.id !== 'string' || !/^\d+$/.test(item.id) || typeof item.text !== 'string' ||
      typeof item.created_timestamp !== 'number' || !Number.isInteger(item.created_timestamp) ||
      item.created_timestamp <= 0 || item.url !== `https://x.com/thsottiaux/status/${item.id}`) throw malformedError();
    const publishedAt = new Date(item.created_timestamp * 1000).toISOString();
    posts.push({ id: item.id, text: item.text, publishedAt, url: item.url });
  }
  const cursorValue = page.cursor;
  const bottom = typeof cursorValue === 'object' && cursorValue !== null && !Array.isArray(cursorValue)
    ? (cursorValue as Record<string, unknown>).bottom : undefined;
  if (bottom !== undefined && (typeof bottom !== 'string' || bottom.length > 512)) throw malformedError();
  return { posts, cursor: typeof bottom === 'string' && bottom !== '' ? bottom : null };
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
