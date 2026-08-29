import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLiveCheck } from '../scripts/live-check';
import { runLiveCheckCli } from '../scripts/live-check';
import { normalizeDayclawPayload } from '../src/feed/normalize';

test('runs the injected normalized feed check exactly once without state or file access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tibo-raccoon-live-check-'));
  let calls = 0;
  const posts = normalizeDayclawPayload({ items: [
    { id: 'a', content: 'same time, lower ID', published_at: '2026-08-30T00:00:00Z' },
    { id: 'old', content: 'older', published_at: '2026-08-29T00:00:00Z' },
    { id: 'z', content: 'same time, higher ID', published_at: '2026-08-30T00:00:00Z' },
  ] });
  try {
    const before = await readdir(root);
    const result = await runLiveCheck({
      fetchPosts: async () => {
        calls += 1;
        return posts;
      },
    });
    expect(result).toEqual({ count: 3, newestId: 'z' });
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

test('live-check CLI escapes a malicious newest remote ID', async () => {
  let stdout = '';
  let stderr = '';
  const process = { exitCode: null as number | null };
  await runLiveCheckCli({
    run: async () => ({ count: 1, newestId: 'remote\n\u001b[2J\u2028' }),
    writer: { stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } }, process },
  });
  expect(stdout).toBe('Dayclaw schema valid: 1 posts; newest ID: remote\\n\\u001b[2J\\u2028\n');
  expect(stderr).toBe('');
  expect(process.exitCode).toBe(0);
});
