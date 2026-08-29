import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLiveCheck } from '../scripts/live-check';
import type { Post } from '../src/domain';

test('runs the injected normalized feed check exactly once without state or file access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tibo-raccoon-live-check-'));
  let calls = 0;
  const posts: Post[] = [
    { id: 'newest', text: 'new', publishedAt: '2026-08-30T00:00:00.000Z', url: null },
    { id: 'older', text: 'old', publishedAt: '2026-08-29T00:00:00.000Z', url: null },
  ];
  try {
    const before = await readdir(root);
    const result = await runLiveCheck({
      fetchPosts: async () => {
        calls += 1;
        return posts;
      },
    });
    expect(result).toEqual({ count: 2, newestId: 'newest' });
    expect(calls).toBe(1);
    expect(await readdir(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports an empty normalized feed without making a second request', async () => {
  let calls = 0;
  const result = await runLiveCheck({ fetchPosts: async () => { calls += 1; return []; } });
  expect(result).toEqual({ count: 0, newestId: null });
  expect(calls).toBe(1);
});

test('live-check import has no side effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tibo-raccoon-live-check-import-'));
  try {
    const before = await readdir(root);
    await import('../scripts/live-check');
    expect(await readdir(root)).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
