import { expect, test } from 'bun:test';
import { FEED_URL } from '../src/domain';
import { FeedError, fetchFxPosts } from '../src/feed/client';

const MAX_BYTES = 2 * 1024 * 1024;

test('Fx timeline backfills to the last cached post and ignores other authors', async () => {
  const urls: string[] = [];
  const fxPost = (id: string, seconds: number, author = 'thsottiaux') => ({
    type: 'status', id, text: `post ${id}`, created_timestamp: seconds,
    url: `https://x.com/${author}/status/${id}`,
    author: { screen_name: author },
  });
  const pages = [
    { code: 200, results: [fxPost('3', 300), fxPost('other', 250, 'someone')], cursor: { bottom: 'next' } },
    { code: 200, results: [fxPost('2', 200), fxPost('1', 90)], cursor: {} },
  ];
  const posts = await fetchFxPosts({
    since: new Date(100_000).toISOString(),
    fetchImpl: async (input) => {
      urls.push(String(input));
      return jsonResponse(pages[urls.length - 1]);
    },
  });

  expect(urls).toHaveLength(2);
  expect(urls[0]).toContain('count=100&with_replies=1');
  expect(urls[1]).toContain('cursor=next');
  expect(posts.map(({ id }) => id)).toEqual(['3', '2', '1']);
  expect(posts[0]).toEqual({ id: '3', text: 'post 3', publishedAt: new Date(300_000).toISOString(), url: 'https://x.com/thsottiaux/status/3' });
});

test('uses the fixed GET URL, rejects redirects, and returns normalized posts', async () => {
  let seen: { input: string; init: RequestInit | undefined } | undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    seen = { input: String(input), init };
    return jsonResponse(fxPage('1'));
  };

  const posts = await fetchFxPosts({ fetchImpl });

  expect(posts).toEqual([{ id: '1', text: 'post 1', publishedAt: new Date(1_000).toISOString(), url: 'https://x.com/thsottiaux/status/1' }]);
  expect(seen?.input).toBe(FEED_URL);
  expect(seen?.init?.method).toBe('GET');
  expect(seen?.init?.redirect).toBe('error');
  expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
});

test('uses a 25-second timeout by default', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let observedDelay: number | undefined;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    observedDelay = args[1] as number | undefined;
    return originalSetTimeout(...args);
  }) as typeof setTimeout;

  try {
    await fetchFxPosts({ fetchImpl: async () => jsonResponse(fxPage('1')) });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  expect(observedDelay).toBe(25_000);
});

test('maps an abort signal firing during a request to a safe timeout error', async () => {
  let seenSignal: AbortSignal | undefined;
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    seenSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('internal timeout detail', 'AbortError')), { once: true });
    });
  };

  const error = await captureError(fetchFxPosts({ fetchImpl, timeoutMs: 1 }));

  expect(seenSignal?.aborted).toBe(true);
  expectFeedError(error, 'timeout');
});

test('maps non-success HTTP responses without exposing response text or request data', async () => {
  const error = await captureError(fetchFxPosts({
    fetchImpl: async () => new Response('secret response https://example.test/?token=abc', { status: 503 }),
  }));

  expectFeedError(error, 'http', 503);
});

test('rejects a declared body larger than two MiB before reading it', async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull() {},
  });
  const response = new Response(stream, { headers: { 'content-length': String(MAX_BYTES + 1) } });
  const error = await captureError(fetchFxPosts({
    fetchImpl: async () => response,
  }));

  expect(response.bodyUsed).toBe(false);
  expectFeedError(error, 'oversize');
});

test('cancels a streamed body immediately after it crosses two MiB', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(MAX_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const error = await captureError(fetchFxPosts({ fetchImpl: async () => new Response(stream) }));

  expect(cancelled).toBe(true);
  expectFeedError(error, 'oversize');
});

test('maps an abort during streamed-body consumption to a safe timeout error', async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => {
      streamController?.error(new DOMException('stream abort detail', 'AbortError'));
    }, { once: true });
    return new Response(stream);
  };

  const error = await captureError(fetchFxPosts({ fetchImpl, timeoutMs: 1 }));

  expectFeedError(error, 'timeout');
});

test('maps a non-abort streamed-body failure to a safe network error', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('stream failed at https://example.test/?token=private'));
    },
  });
  const error = await captureError(fetchFxPosts({ fetchImpl: async () => new Response(stream) }));

  expectFeedError(error, 'network');
});

test('does not let a larger maxBytes override loosen the hard two MiB cap', async () => {
  const response = new Response('', { headers: { 'content-length': String(MAX_BYTES + 1) } });
  const error = await captureError(fetchFxPosts({
    fetchImpl: async () => response,
    maxBytes: MAX_BYTES + 1,
  }));

  expect(response.bodyUsed).toBe(false);
  expectFeedError(error, 'oversize');
});

test('rejects non-finite maxBytes values without making a request', async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return jsonResponse({ items: [] });
  };

  const infinityError = await captureError(fetchFxPosts({ fetchImpl, maxBytes: Infinity }));
  const nanError = await captureError(fetchFxPosts({ fetchImpl, maxBytes: Number.NaN }));

  expect(requests).toBe(0);
  expectFeedError(infinityError, 'malformed');
  expectFeedError(nanError, 'malformed');
});

test('maps invalid UTF-8 response bytes to a safe malformed error', async () => {
  const error = await captureError(fetchFxPosts({
    fetchImpl: async () => new Response(new Uint8Array([0xff])),
  }));

  expectFeedError(error, 'malformed');
});

test('maps invalid JSON to a safe malformed error', async () => {
  const error = await captureError(fetchFxPosts({ fetchImpl: async () => new Response('{not json') }));
  expectFeedError(error, 'malformed');
});

test('maps invalid normalized payloads to a safe malformed error', async () => {
  const error = await captureError(fetchFxPosts({ fetchImpl: async () => jsonResponse({ items: [{}] }) }));
  expectFeedError(error, 'malformed');
});

test('maps network exceptions to a safe network error', async () => {
  const error = await captureError(fetchFxPosts({
    fetchImpl: async () => {
      throw new Error('connection failed at https://example.test/?apiKey=private');
    },
  }));
  expectFeedError(error, 'network');
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}

function fxPage(id: string): unknown {
  return { code: 200, results: [{ type: 'status', id, text: `post ${id}`, created_timestamp: 1,
    url: `https://x.com/thsottiaux/status/${id}`, author: { screen_name: 'thsottiaux' } }] };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject');
}

function expectFeedError(error: unknown, kind: FeedError['kind'], status?: number): void {
  expect(error).toBeInstanceOf(FeedError);
  const feedError = error as FeedError;
  expect(feedError.kind).toBe(kind);
  expect(feedError.status).toBe(status);
  expect(feedError.publicMessage).not.toContain('secret response');
  expect(feedError.publicMessage).not.toContain('internal timeout detail');
  expect(feedError.publicMessage).not.toContain('connection failed');
  expect(feedError.publicMessage).not.toContain('example.test');
  expect(feedError.publicMessage).not.toContain('?');
  expect(feedError.stack).not.toContain('secret response');
  expect(feedError.stack).not.toContain('internal timeout detail');
  expect(feedError.stack).not.toContain('connection failed');
}
